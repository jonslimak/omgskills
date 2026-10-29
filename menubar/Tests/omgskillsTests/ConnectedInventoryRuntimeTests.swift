#if DEBUG
import Foundation
import Testing
@testable import omgskills

@MainActor
struct ConnectedInventoryRuntimeTests {
    @Test func trackingKeepsConnectionAndSyncOutcomesSeparateAndIgnoresUnchangedChecks() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        await api.setFailure(true)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer, automation: true)
        let automation = InventoryAutomationFixture()
        var events: [ConnectedAppEvent] = []
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer,
            automation: automation.configuration, track: { events.append($0) })
        await runtime.start().value
        await runtime.start().value
        #expect(events == [.connection(.restore, .connected), .inventory(.retryable)])
        await api.setFailure(false)
        await automation.clock.advance(5)
        #expect(events == [.connection(.restore, .connected), .inventory(.retryable), .inventory(.reported)])
        let reportedCount = events.count
        automation.wakes[0]()
        await automation.clock.advance(0)
        #expect(await api.checks == 1)
        #expect(events.count == reportedCount)
        await runtime.disconnect().value
        #expect(events.last == .connection(.disconnect, .disconnected))
        await runtime.stop()
        #expect(events.count == reportedCount + 1)
    }

    @Test func trackingRecordsConnectFailureWithoutReportingSuccess() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let authorizer = InventoryAuthorizerFixture()
        authorizer.failure = .unavailable
        let connection = makeConnection(store: InventoryCredentialFixture(record: nil), api: api, authorizer: authorizer)
        var events: [ConnectedAppEvent] = []
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer,
            track: { events.append($0) })
        await runtime.connect(deviceName: "Private Mac name").value
        #expect(events == [.connection(.connect, .authorizationFailed)])
        #expect(await api.uploads == 0)
        await runtime.stop()
    }

    @Test func candidatePairingUsesProductSchemeAndRestartKeepsTheStoredMac() async throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        let candidate = try ConnectedCandidateConfigurationTests.configuration(home: home)
        let config = try #require(candidate.connected)
        let store = InventoryCredentialFixture(record: nil)
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let authorizer = InventoryAuthorizerFixture()
        let keys = InventoryReconnectFixture()
        let runtime = try config.makeRuntime(paths: candidate.paths, authorizer: authorizer,
            coordinator: UpdateInstallCoordinator(), credentialStore: store,
            makeReconnectKeyStore: { _, _ in keys }, api: api)
        let cold = URL(string: "omgskills://pair?state=stale&code=stale")!
        #expect(runtime.receivePairingCallback(cold))
        #expect(authorizer.callbacks == [cold])
        #expect(!runtime.receivePairingCallback(URL(string: "omgskills-f1://pair?state=stale")!))
        #expect(!runtime.receivePairingCallback(URL(string: "omgskills://catalog-install?v=1&id=owner/repo&agent=codex")!))
        #expect(await api.uploads == 0)
        await runtime.start().value
        await runtime.connect(deviceName: "Candidate Mac").value
        #expect(authorizer.scheme == "omgskills")
        #expect(authorizer.authorizationURL?.absoluteString.hasPrefix(config.connectURL.absoluteString + "#") == true)
        #expect(runtime.connection.state == .connected(inventoryCredential.connection))
        #expect(await store.record == inventoryCredential)
        let warm = URL(string: "omgskills://pair?state=late&code=late")!
        #expect(runtime.receivePairingCallback(warm))
        #expect(authorizer.callbacks == [cold, warm])
        await runtime.stop()
        let reopened = try config.makeRuntime(paths: candidate.paths, authorizer: authorizer,
            coordinator: UpdateInstallCoordinator(), credentialStore: store,
            makeReconnectKeyStore: { _, _ in keys }, api: api)
        await reopened.start().value
        #expect(reopened.connection.state == .connected(inventoryCredential.connection))
        #expect(await store.record == inventoryCredential)
        #expect(await api.exchanges == 1)
        #expect(await api.legacyExchanges == 0)
        #expect(await api.bindings == 1)
        #expect(await keys.loads == 2)
        #expect(await api.uploads == 2)
        await reopened.stop()
    }

    @Test(arguments: [SkillInstaller.Target.claude, .codex])
    func candidateReportsSuccessfulInstallsAndRetriesOnlyReporting(_ target: SkillInstaller.Target) async throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        let candidate = try ConnectedCandidateConfigurationTests.configuration(home: home)
        for root in candidate.paths.allSkillsRoots {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        }
        let config = try #require(candidate.connected)
        let store = InventoryCredentialFixture()
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let coordinator = UpdateInstallCoordinator()
        let runtime = try config.makeRuntime(paths: candidate.paths, authorizer: InventoryAuthorizerFixture(),
            coordinator: coordinator, credentialStore: store,
            makeReconnectKeyStore: { _, _ in InventoryReconnectFixture() }, api: api)
        await runtime.start().value
        #expect(await api.lastPayload?.skills.isEmpty == true)
        let service = InventoryInstallFixture(paths: candidate.paths)
        let model = CatalogInstallModel(service: service, coordinator: coordinator, client: .product)
        runtime.observeInstalls(in: model)
        model.receive(URL(string: "omgskills://catalog-install?v=1&id=owner/repo&agent=\(target.rawValue.lowercased())")!)
        await model.operation?.value
        #expect(model.phase == .confirm)
        #expect(await service.installs == 0)
        await api.setFailure(true)
        model.install()
        await model.operation?.value
        await runtime.connection.requestInventoryReport().value
        #expect(model.result == .installed)
        #expect(runtime.connection.state == .connected(inventoryCredential.connection))
        guard case .uncertain = runtime.connection.reportStatus else { Issue.record("Expected report failure, not install failure"); return }
        await api.setFailure(false)
        runtime.resync()
        await runtime.connection.requestInventoryReport().value
        let payload = try #require(await api.lastPayload)
        #expect(payload.skills.count == 1)
        #expect(payload.skills.first?.source == target.rawValue.lowercased())
        #expect(payload.skills.first?.installationPath == "fixture")
        #expect(payload.roots.allSatisfy { $0.state == .complete })
        #expect(await service.installs == 1)
        #expect(model.result == .installed)
        // Closing the install result hides the window; it must not disconnect.
        #expect(await model.close())
        #expect(runtime.connection.state == .connected(inventoryCredential.connection))
        #expect(await store.record == inventoryCredential)
        await runtime.stop()
    }

    @Test func candidateCancelDoesNotInstallOrReportAndStopDoesNotRevoke() async throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        let candidate = try ConnectedCandidateConfigurationTests.configuration(home: home)
        let config = try #require(candidate.connected)
        let store = InventoryCredentialFixture()
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let coordinator = UpdateInstallCoordinator()
        let runtime = try config.makeRuntime(paths: candidate.paths, authorizer: InventoryAuthorizerFixture(),
            coordinator: coordinator, credentialStore: store,
            makeReconnectKeyStore: { _, _ in InventoryReconnectFixture() }, api: api)
        await runtime.start().value
        let service = InventoryInstallFixture(paths: candidate.paths)
        let model = CatalogInstallModel(service: service, coordinator: coordinator, client: .product)
        runtime.observeInstalls(in: model)
        model.receive(URL(string: "omgskills://catalog-install?v=1&id=owner/repo&agent=claude")!)
        await model.operation?.value
        #expect(await model.close())
        #expect(await service.installs == 0)
        #expect(await api.uploads == 1)
        await runtime.stop()
        #expect(await api.revocations == 0)
        #expect(await store.record == inventoryCredential)
        #expect(!coordinator.isBusy)
    }

    @Test func candidateRestoreBlocksAppReplacementUntilReportingDrains() async throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        let candidate = try ConnectedCandidateConfigurationTests.configuration(home: home)
        let config = try #require(candidate.connected)
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let coordinator = UpdateInstallCoordinator()
        let gate = InventoryShutdownGate()
        await api.setReportGate(gate)
        let runtime = try config.makeRuntime(paths: candidate.paths, authorizer: InventoryAuthorizerFixture(),
            coordinator: coordinator, credentialStore: InventoryCredentialFixture(),
            makeReconnectKeyStore: { _, _ in InventoryReconnectFixture() }, api: api)
        let model = CatalogInstallModel(service: InventoryInstallFixture(), coordinator: coordinator, client: .product)
        let startup = runtime.start()
        await gate.waitUntilBlocked()
        #expect(!model.canCheckForAppUpdates)
        var replaced = false
        coordinator.requestInstall { replaced = true }
        #expect(!replaced)
        await gate.open()
        await startup.value
        #expect(replaced)
        await runtime.stop()
        #expect(!coordinator.isBusy)
    }

    @Test func resyncDuringAnActiveCheckQueuesOneFullReportWithoutParallelWork() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer, automation: true)
        let events = InventoryAutomationFixture()
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer, automation: events.configuration)
        await runtime.start().value
        let gate = InventoryShutdownGate()
        await api.setCheckGate(gate)
        runtime.installed()
        await events.clock.advance(0)
        await gate.waitUntilBlocked()
        for _ in 0..<10 { runtime.resync() }
        #expect(await api.uploads == 1)
        #expect(await api.checks == 1)
        await gate.open()
        await events.clock.advance(0)
        #expect(await api.uploads == 2)
        #expect(await api.checks == 1)
        events.wakes[0]()
        await events.clock.advance(0)
        #expect(await api.checks == 2)
        await runtime.stop()
    }

    @Test func automatedStartupIsSingleAndAllTriggersUseTheSameScheduler() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer, automation: true)
        let events = InventoryAutomationFixture()
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer, automation: events.configuration)
        await runtime.start().value
        await runtime.start().value
        #expect(await api.uploads == 1)
        #expect(events.changes.count == 1 && events.wakes.count == 1)
        events.changes[0]()
        events.changes[0]()
        await events.clock.advance(2)
        #expect(await api.checks == 0)
        await events.clock.advance(1)
        #expect(await api.checks == 1)
        runtime.installed()
        events.wakes[0]()
        await events.clock.advance(0)
        #expect(await api.checks == 2)
        runtime.resync()
        await events.clock.advance(0)
        #expect(await api.uploads == 2)
        await events.clock.advance(3_600)
        #expect(await api.checks == 3)
        await events.clock.advance(36_000)
        #expect(await api.checks == 4)
        await runtime.disconnect().value
        #expect(events.watchStops == 1 && events.wakeStops == 1)
        #expect(await api.revocations == 1)
        events.changes[0]()
        events.wakes[0]()
        await events.clock.advance(36_000)
        #expect(await api.checks == 4)
        #expect(events.clock.pendingSleeps == 0)
        await runtime.stop()
    }

    @Test func initialFailureAdoptsBackoffWithoutDuplicateReportOrTriggerBypass() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        await api.setFailure(true)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer, automation: true)
        let events = InventoryAutomationFixture()
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer, automation: events.configuration)
        await runtime.start().value
        #expect(await api.uploads == 1)
        events.changes[0]()
        events.wakes[0]()
        runtime.installed()
        runtime.resync()
        await events.clock.advance(4)
        #expect(await api.uploads == 1)
        await api.setFailure(false)
        await events.clock.advance(1)
        #expect(await api.uploads == 2)
        #expect(await api.checks == 0)
        await runtime.stop()
    }

    @Test func initialReportBuffersFilesystemChangesUntilItsOutcomeIsAdopted() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let gate = InventoryShutdownGate()
        await api.setReportGate(gate)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer, automation: true)
        let events = InventoryAutomationFixture()
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer, automation: events.configuration)
        let startup = runtime.start()
        await gate.waitUntilBlocked()
        for _ in 0..<20 { events.changes[0]() }
        await events.clock.advance(60)
        #expect(await api.uploads == 1)
        #expect(await api.checks == 0)
        await gate.open()
        await startup.value
        await events.clock.advance(3)
        #expect(await api.uploads == 1)
        #expect(await api.checks == 1)
        await runtime.stop()
    }

    @Test func failedWatcherRemainsVisibleAndHourlyFallbackStillWorks() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer, automation: true)
        let events = InventoryAutomationFixture()
        events.failWatch = true
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer, automation: events.configuration)
        await runtime.start().value
        #expect(runtime.watchWarning != nil)
        await events.clock.advance(3_600)
        #expect(await api.checks == 1)
        #expect(runtime.watchWarning != nil)
        runtime.resync()
        await events.clock.advance(0)
        #expect(await api.uploads == 2)
        #expect(runtime.watchWarning != nil)
        await runtime.stop()
        #expect(events.watchStops == 0 && events.wakeStops == 1)
    }

    @Test func stopDrainsAnUncooperativeCheckAndRestartRejectsOldCallbacks() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer, automation: true)
        let events = InventoryAutomationFixture()
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer, automation: events.configuration)
        await runtime.start().value
        let gate = InventoryShutdownGate()
        await api.setCheckGate(gate)
        runtime.installed()
        await events.clock.advance(0)
        await gate.waitUntilBlocked()
        let stopping = runtime.cancel()
        #expect(events.watchStops == 1 && events.wakeStops == 1)
        await gate.open()
        await stopping.value
        #expect(connection.lastInventoryCheckedAt == nil)
        await runtime.start().value
        #expect(await api.uploads == 2)
        events.changes[0]()
        events.wakes[0]()
        await events.clock.advance(3)
        #expect(await api.checks == 1)
        events.changes[1]()
        await events.clock.advance(3)
        #expect(await api.checks == 2)
        await runtime.stop()
        #expect(events.watchStops == 2 && events.wakeStops == 2)
    }

    @Test func replacementDrainsTheOldSessionBeforeStartingNewObservers() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer, automation: true)
        let events = InventoryAutomationFixture()
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer, automation: events.configuration)
        await runtime.start().value
        let gate = InventoryShutdownGate()
        await api.setCheckGate(gate)
        runtime.installed()
        await events.clock.advance(0)
        await gate.waitUntilBlocked()
        let replacement = runtime.connect(deviceName: "Replacement")
        #expect(events.watchStops == 1 && events.wakeStops == 1)
        #expect(events.changes.count == 1)
        await gate.open()
        await replacement.value
        #expect(events.changes.count == 2)
        #expect(await api.uploads == 2)
        events.wakes[0]()
        await events.clock.advance(0)
        #expect(await api.checks == 1)
        events.wakes[1]()
        await events.clock.advance(0)
        #expect(await api.checks == 2)
        await runtime.stop()
    }

    @Test func reconnectRequiredRemovesWatchWakeAndHourlyWork() async {
        let api = InventoryAPIFixture(reportMode: .reconciliation)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer, automation: true)
        let events = InventoryAutomationFixture()
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer, automation: events.configuration)
        await runtime.start().value
        await api.setCheckError(.reconnectRequired)
        events.wakes[0]()
        await events.clock.advance(0)
        #expect(connection.state == .failed(.reconnectRequired))
        #expect(events.watchStops == 1 && events.wakeStops == 1)
        await events.clock.advance(36_000)
        #expect(await api.checks == 1)
        #expect(events.clock.pendingSleeps == 0)
        await runtime.stop()
    }

    @Test func startupRestoresOnceAndUsesTheInjectedFreshInventory() async {
        let store = InventoryCredentialFixture()
        let api = InventoryAPIFixture()
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: store, api: api, authorizer: authorizer)
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer)
        let first = runtime.start()
        await runtime.start().value
        await first.value
        #expect(await store.loads == 1)
        #expect(await api.uploads == 1)
        #expect(connection.state == .connected(inventoryCredential.connection))
        runtime.installed()
        await connection.requestInventoryReport().value
        #expect(await api.uploads == 2)
        await runtime.stop()
        #expect(await store.record == inventoryCredential)
    }

    @Test func pairingCallbacksAreConsumedEvenWithoutAnActiveSessionButInstallLinksAreNot() {
        let authorizer = InventoryAuthorizerFixture()
        let runtime = ConnectedInventoryRuntime(connection: makeConnection(
            store: InventoryCredentialFixture(), api: InventoryAPIFixture(), authorizer: authorizer), authorizer: authorizer)
        let callback = URL(string: "omgskills-f1://pair?state=stale&code=stale")!
        #expect(runtime.receivePairingCallback(callback))
        #expect(authorizer.callbacks == [callback])
        #expect(!runtime.receivePairingCallback(URL(string: "omgskills-f1://catalog-install?v=1&id=owner/repo&agent=codex")!))
        #expect(!runtime.receivePairingCallback(URL(string: "omgskills://pair?state=stale")!))
        #expect(authorizer.callbacks.count == 1)
    }

    @Test func runtimeStopWaitsForInterruptedCredentialCleanupWithoutLaunchingUI() async {
        let gate = InventoryShutdownGate()
        let store = InventoryCredentialFixture(record: nil, saveGate: gate)
        let api = InventoryAPIFixture()
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: store, api: api, authorizer: authorizer)
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer)
        await runtime.start().value
        let connect = connection.connectWithBrowser(deviceName: "Test Mac", installations: [])
        await gate.waitUntilBlocked()
        #expect(await store.record == inventoryCredential)
        var stopped = false
        let stop = Task { await runtime.stop(); stopped = true }
        while connection.state != .disconnected { await Task.yield() }
        #expect(!stopped)
        await gate.open()
        await stop.value
        #expect(stopped)
        #expect(await store.record == nil)
        #expect(await api.revocations == 1)
        #expect(await api.uploads == 0)
        await connect.value
    }

    @Test func browserConnectionUsesF1SchemeAndReturnsToPresenceReporting() async {
        let store = InventoryCredentialFixture(record: nil)
        let api = InventoryAPIFixture()
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: store, api: api, authorizer: authorizer)
        await connection.connectWithBrowser(deviceName: "Test Mac", installations: []).value
        #expect(authorizer.scheme == "omgskills-f1")
        #expect(authorizer.authorizationURL?.host == "127.0.0.1")
        #expect(authorizer.authorizationURL?.path == "/app/connect")
        #expect(await api.uploads == 1)
        #expect(await store.record == inventoryCredential)
        #expect(connection.state == .connected(inventoryCredential.connection))
    }

    @Test(arguments: [DeviceReportMode.presence, .reconciliation])
    func reportFailureDoesNotChangeSuccessfulInstallAndResyncDoesNotInstallAgain(_ mode: DeviceReportMode) async throws {
        let api = InventoryAPIFixture(reportMode: mode)
        let authorizer = InventoryAuthorizerFixture()
        let connection = makeConnection(store: InventoryCredentialFixture(), api: api, authorizer: authorizer)
        let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer)
        await runtime.start().value
        await api.setFailure(true)
        let service = InventoryInstallFixture()
        let model = CatalogInstallModel(service: service, coordinator: UpdateInstallCoordinator(),
            onInstalled: { runtime.installed() })
        model.receive(URL(string: "omgskills-f1://catalog-install?v=1&id=owner/repo&agent=codex")!)
        await model.operation?.value
        model.install()
        await model.operation?.value
        await connection.requestInventoryReport().value
        #expect(model.result == .installed)
        #expect(connection.state == .connected(inventoryCredential.connection))
        if mode == .reconciliation {
            guard case .uncertain = connection.reportStatus else { Issue.record("Expected uncertain submitted report"); return }
        } else {
            guard case .failed = connection.reportStatus else { Issue.record("Expected reporting failure"); return }
        }
        await api.setFailure(false)
        await connection.requestInventoryReport().value
        #expect(await service.installs == 1)
        #expect(model.result == .installed)
        guard case .reported = connection.reportStatus else { Issue.record("Expected retry success"); return }
    }

    @Test func partialReportsNeverClaimACompleteInventory() {
        let result = SkillSyncResult(syncRunId: "run", syncedSkillCount: 2, reportVersion: 2,
            mode: "presence", deviceId: "device", completedAt: "2026-10-16T12:00:00Z")
        let partial = ConnectedInventoryView.reportMessage(.reported(result, scanIssueCount: 1))
        #expect(partial.contains("Partial"))
        #expect(partial.contains("attention"))
        #expect(!ConnectedInventoryView.reportMessage(.reported(result, scanIssueCount: 0)).contains("Partial"))
        #expect(ConnectedInventoryView.reportMessage(.failed("Offline")).contains("attention"))
        let roots: [InventoryRootCoverage] = ["claude", "codex", "agents"].map {
            .init(source: $0, state: $0 == "agents" ? .unavailable : .complete, reason: $0 == "agents" ? .missing : nil)
        }
        let incomplete = SkillSyncResult(syncRunId: UUID().uuidString, syncedSkillCount: 2, reportVersion: 3,
            mode: "reconciled", deviceId: "device", completedAt: "2026-10-16T12:00:00Z",
            missingSkillCount: 0, roots: roots, complete: false)
        #expect(ConnectedInventoryView.reportMessage(.reported(incomplete, scanIssueCount: 0)).contains("Partial"))
        #expect(ConnectedInventoryView.reportMessage(.uncertain("Offline")).contains("Resync"))
    }

    @Test func slimStartupAndWindowUseTheConnectionWithoutTheDiscoveryRuntime() throws {
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/omgskills")
        let app = try String(contentsOf: source.appendingPathComponent("omgskillsApp.swift"), encoding: .utf8)
        let start = try #require(app.range(of: "switch connectedInventoryMode"))
        let end = try #require(app.range(of: "switch catalogCandidateMode"))
        let branch = app[start.lowerBound..<end.lowerBound]
        #expect(branch.contains("connected: configuration"))
        #expect(branch.contains("pendingConnectedURLs.forEach(controller.receive)"))
        for forbidden in ["SkillsStore", "Analytics.start", "setupStatusItem", "setupUpdater", "ContentView"] {
            #expect(!branch.contains(forbidden))
        }
        let view = try String(contentsOf: source.appendingPathComponent("CatalogInstallView.swift"), encoding: .utf8)
        #expect(view.contains("anchorProvider: { [weak self] in self?.browserPresentationAnchor() }"))
        #expect(view.contains("onReturn: { [weak self] in self?.returnFromBrowser() }"))
        #expect(view.contains("connectedRuntime?.receivePairingCallback(url)"))
        #expect(view.contains("Analytics.connectedTracker(profile: candidate.profile)"))
        #expect(view.contains("client: .product, track: track"))
        #expect(view.contains("automation: .live(paths: candidate.paths), track: track"))
        #expect(view.contains("track(.setupFailed)"))
        #expect(view.contains("filesystemPaths: connected.filesystemPaths, pathAnchor: connected.root"))
        #expect(view.contains("await connectedRuntime?.stop()"))
        #expect(view.contains("inventoryAutomationEnabled: connected.inventoryAutomation"))
        #expect(view.contains("connected.inventoryAutomation ? .live(paths: connected.filesystemPaths) : nil"))
        #expect(view.components(separatedBy: "NSStatusBar.system.statusItem").count == 2)
        let termination = try #require(app.range(of: "func applicationShouldTerminate"))
        let stop = try #require(app.range(of: "await catalogInstallController.stopReporting()", range: termination.lowerBound..<app.endIndex))
        let reply = try #require(app.range(of: "sender.reply(toApplicationShouldTerminate: closed)", range: termination.lowerBound..<app.endIndex))
        #expect(stop.lowerBound < reply.lowerBound)
        let auth = try String(contentsOf: source.appendingPathComponent("WebAuthenticationSession.swift"), encoding: .utf8)
        #expect(auth.contains("guard activeAttemptID == attemptID else { return }"))
        #expect(auth.contains("guard self?.activeAttemptID == attemptID else { return }"))
        #expect(auth.contains("BrowserPairing.parseCallback(url, expectedState: expectedState"))
    }

    private func makeConnection(store: InventoryCredentialFixture, api: InventoryAPIFixture,
                                authorizer: InventoryAuthorizerFixture, automation: Bool = false) -> DeviceConnectionModel {
        DeviceConnectionModel(credentialStore: store, api: api, browserAuthorizer: authorizer,
            portalConnectURL: URL(string: "http://127.0.0.1:5201/app/connect")!,
            callbackScheme: BrowserPairing.connectedTestCallbackScheme,
            inventoryScanner: { .init(skills: [], installations: [], summary: .init(),
                roots: ["claude", "codex", "agents"].map { .init(source: $0, state: .complete, reason: nil) }) },
            inventoryAutomationEnabled: automation)
    }
}

private let inventoryCredential = StoredDeviceCredential(credential: "test-only-secret", connection: .init(
    deviceID: "inventory-test-device", accountLabel: "Test account", expiresAt: .distantFuture))

private actor InventoryReconnectFixture: DeviceReconnectKeyStoring {
    var loads = 0
    func loadOrCreate() async throws -> String {
        loads += 1
        return String(repeating: "a", count: 64)
    }
}

private actor InventoryCredentialFixture: DeviceCredentialStoring {
    var record: StoredDeviceCredential?
    var loads = 0
    let saveGate: InventoryShutdownGate?
    init(record: StoredDeviceCredential? = inventoryCredential, saveGate: InventoryShutdownGate? = nil) {
        self.record = record
        self.saveGate = saveGate
    }
    func load() async throws -> StoredDeviceCredential? { loads += 1; return record }
    func save(_ record: StoredDeviceCredential, replacingExisting: Bool) async throws {
        self.record = record
        if let saveGate { await saveGate.block() }
    }
    func delete(ifMatching expected: StoredDeviceCredential) async throws -> Bool {
        guard record == expected else { return false }
        record = nil
        return true
    }
}

private actor InventoryAPIFixture: DeviceSyncServing {
    let reportMode: DeviceReportMode
    init(reportMode: DeviceReportMode = .presence) { self.reportMode = reportMode }
    var uploads = 0
    var revocations = 0
    var checks = 0
    var exchanges = 0
    var legacyExchanges = 0
    var bindings = 0
    var lastPayload: ReconciliationSyncPayload?
    private var revision: String?
    private var reportGate: InventoryShutdownGate?
    private var checkGate: InventoryShutdownGate?
    private var checkError: DeviceSyncAPIError?
    func setReportGate(_ gate: InventoryShutdownGate) { reportGate = gate }
    func setCheckGate(_ gate: InventoryShutdownGate) { checkGate = gate }
    func setCheckError(_ error: DeviceSyncAPIError) { checkError = error }
    private var failure = false
    func setFailure(_ value: Bool) { failure = value }
    func exchange(pairingCode: String, deviceName: String, codeVerifier: String?) async throws -> StoredDeviceCredential {
        exchanges += 1
        legacyExchanges += 1
        return inventoryCredential
    }
    func exchangeForReconnect(pairingCode: String, deviceName: String, codeVerifier: String?,
                              reconnectKey: String) async throws -> DeviceReconnectExchange {
        guard DeviceReconnectKeyStore.isValidKey(reconnectKey), codeVerifier?.count == 43 else {
            throw DeviceSyncAPIError.invalidPairingCode
        }
        exchanges += 1
        return .init(record: inventoryCredential, support: .supported)
    }
    func bindReconnectKey(credential: String, reconnectKey: String, expectedDeviceID: String) async throws {
        guard credential == inventoryCredential.credential, DeviceReconnectKeyStore.isValidKey(reconnectKey),
              expectedDeviceID == inventoryCredential.connection.deviceID else { throw DeviceSyncAPIError.invalidResponse }
        bindings += 1
    }
    func revoke(credential: String) async throws {
        try Task.checkCancellation()
        revocations += 1
    }
    func upload(credential: String, installations: [Skill]) async throws -> SkillSyncResult {
        uploads += 1
        if failure { throw DeviceSyncAPIError.server(statusCode: 503) }
        return SkillSyncResult(syncRunId: "test-run", syncedSkillCount: installations.count, reportVersion: 2,
            mode: "presence", deviceId: inventoryCredential.connection.deviceID, completedAt: "2026-10-16T12:00:00Z")
    }
    func inventoryRevision(credential: String) async throws -> String? { revision }
    func reconcile(credential: String, payload: ReconciliationSyncPayload) async throws -> SkillSyncResult {
        uploads += 1
        lastPayload = payload
        if let gate = reportGate { reportGate = nil; await gate.block() }
        if failure { throw DeviceSyncAPIError.server(statusCode: 503) }
        let run = UUID().uuidString
        revision = run.lowercased()
        return SkillSyncResult(syncRunId: run, syncedSkillCount: payload.skills.count, reportVersion: 3,
            mode: "reconciled", deviceId: inventoryCredential.connection.deviceID,
            completedAt: "2026-10-16T12:00:00Z", revision: run, missingSkillCount: 0,
            roots: payload.roots, complete: true)
    }
    func checkInventory(credential: String, payload: InventoryCheckPayload) async throws -> InventoryCheckResult {
        checks += 1
        if let gate = checkGate { checkGate = nil; await gate.block() }
        if let checkError { throw checkError }
        return .init(reportVersion: 3, mode: "checked", deviceId: inventoryCredential.connection.deviceID,
            revision: payload.baseRevision, checkedAt: "2026-10-16T13:00:00Z")
    }
}

@MainActor
private final class InventoryAutomationFixture {
    let clock = InventoryRuntimeClock()
    var changes: [ConnectedInventoryRuntime.Automation.Event] = []
    var wakes: [ConnectedInventoryRuntime.Automation.Event] = []
    var watchStops = 0
    var wakeStops = 0
    var failWatch = false
    var configuration: ConnectedInventoryRuntime.Automation {
        .init(watch: { callback in
            if self.failWatch { throw InventoryFolderWatcher.Failure.cannotStart }
            self.changes.append(callback)
            return { self.watchStops += 1 }
        }, wake: { callback in
            self.wakes.append(callback)
            return { self.wakeStops += 1 }
        }, now: { self.clock.now }, sleep: clock.sleep, jitter: { 0 })
    }
}

@MainActor
private final class InventoryRuntimeClock {
    var now: TimeInterval = 0
    var pendingSleeps: Int { sleepers.count }
    private var sleepers: [UUID: (TimeInterval, CheckedContinuation<Void, any Error>)] = [:]
    func sleep(_ delay: TimeInterval) async throws {
        try Task.checkCancellation()
        if delay <= 0 { return }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { sleepers[id] = (now + delay, $0) }
        } onCancel: {
            Task { @MainActor [weak self] in self?.sleepers.removeValue(forKey: id)?.1.resume(throwing: CancellationError()) }
        }
    }
    func advance(_ seconds: TimeInterval) async {
        for _ in 0..<100 { await Task.yield() }
        now += seconds
        for (id, entry) in sleepers where entry.0 <= now { sleepers.removeValue(forKey: id)?.1.resume() }
        for _ in 0..<100 { await Task.yield() }
    }
}

private actor InventoryShutdownGate {
    private var continuation: CheckedContinuation<Void, Never>?
    func block() async {
        await withCheckedContinuation { continuation = $0 }
    }
    func waitUntilBlocked() async {
        while continuation == nil { await Task.yield() }
    }
    func open() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class InventoryAuthorizerFixture: BrowserPairingAuthorizing {
    var failure: BrowserPairingError?
    var callbacks: [URL] = []
    var scheme: String?
    var authorizationURL: URL?
    func authorize(url: URL, callbackScheme: String) async throws -> URL {
        if let failure { throw failure }
        scheme = callbackScheme
        authorizationURL = url
        let items = URLComponents(string: "?" + (url.fragment ?? ""))?.queryItems
        let state = items?.first(where: { $0.name == "state" })?.value ?? ""
        return URL(string: "\(callbackScheme)://pair?code=pair_\(String(repeating: "a", count: 43))&state=\(state)")!
    }
    func handleCallback(_ url: URL) -> Bool { callbacks.append(url); return false }
    func cancel() {}
}

private actor InventoryInstallFixture: CatalogInstallFlowServing {
    var installs = 0
    let paths: SkillFilesystemPaths?
    init(paths: SkillFilesystemPaths? = nil) { self.paths = paths }
    func fetch(id: String) async throws -> CatalogInstallRecord? {
        try JSONDecoder().decode(CatalogInstallRecord.self, from: Data("""
        {"id":"owner/repo","name":"Fixture","description":"Test","author_handle":"owner",
        "github_url":"https://github.com/owner/repo","install_cmd":"git clone https://github.com/owner/repo ~/.claude/skills/fixture"}
        """.utf8))
    }
    func destination(for record: CatalogInstallRecord, target: SkillInstaller.Target) async throws -> URL {
        paths?.skillsRoot(for: target).appendingPathComponent("fixture") ?? URL(fileURLWithPath: "/private/tmp/inventory-model-test/fixture")
    }
    func install(_ record: CatalogInstallRecord, target: SkillInstaller.Target) async -> CatalogInstallService.Result {
        installs += 1
        if let paths {
            do {
                let folder = paths.skillsRoot(for: target).appendingPathComponent("fixture")
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try "---\nname: Fixture\ndescription: Candidate inventory fixture\n---\nTest instructions.\n"
                    .write(to: folder.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
            } catch { return .failed("Fixture write failed") }
        }
        return .installed
    }
}
#endif
