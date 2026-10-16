#if DEBUG
import Foundation
import Testing
@testable import omgskills

@MainActor
struct ConnectedInventoryRuntimeTests {
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
        #expect(view.contains("anchorProvider: { [weak self] in self?.window }"))
        #expect(view.contains("onReturn: { [weak self] in self?.showStatus() }"))
        #expect(view.contains("connectedRuntime?.receivePairingCallback(url)"))
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
    func delete(deviceID: String) async throws { record = nil }
}

private actor InventoryAPIFixture: DeviceSyncServing {
    let reportMode: DeviceReportMode
    init(reportMode: DeviceReportMode = .presence) { self.reportMode = reportMode }
    var uploads = 0
    var revocations = 0
    var checks = 0
    private var revision: String?
    private var reportGate: InventoryShutdownGate?
    private var checkGate: InventoryShutdownGate?
    private var checkError: DeviceSyncAPIError?
    func setReportGate(_ gate: InventoryShutdownGate) { reportGate = gate }
    func setCheckGate(_ gate: InventoryShutdownGate) { checkGate = gate }
    func setCheckError(_ error: DeviceSyncAPIError) { checkError = error }
    private var failure = false
    func setFailure(_ value: Bool) { failure = value }
    func exchange(pairingCode: String, deviceName: String, codeVerifier: String?) async throws -> StoredDeviceCredential { inventoryCredential }
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
    var callbacks: [URL] = []
    var scheme: String?
    var authorizationURL: URL?
    func authorize(url: URL, callbackScheme: String) async throws -> URL {
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
    func fetch(id: String) async throws -> CatalogInstallRecord? {
        try JSONDecoder().decode(CatalogInstallRecord.self, from: Data("""
        {"id":"owner/repo","name":"Fixture","description":"Test","author_handle":"owner",
        "github_url":"https://github.com/owner/repo","install_cmd":"git clone https://github.com/owner/repo ~/.claude/skills/fixture"}
        """.utf8))
    }
    func destination(for record: CatalogInstallRecord, target: SkillInstaller.Target) async throws -> URL { URL(fileURLWithPath: "/private/tmp/inventory-model-test/fixture") }
    func install(_ record: CatalogInstallRecord, target: SkillInstaller.Target) async -> CatalogInstallService.Result { installs += 1; return .installed }
}
#endif
