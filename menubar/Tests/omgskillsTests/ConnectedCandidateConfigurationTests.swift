import Foundation
import Testing
@testable import omgskills

struct ConnectedCandidateConfigurationTests {
    static var info: [String: Any] {
        CatalogCandidateRuntimeTests.info.merging([
            ConnectedCandidateConfiguration.enabledKey: true,
            ConnectedCandidateConfiguration.connectKey: ConnectedCandidateConfiguration.connectURL.absoluteString,
            ConnectedCandidateConfiguration.uploadKey: ConnectedCandidateConfiguration.uploadURL.absoluteString,
            ConnectedCandidateConfiguration.credentialKey: ConnectedCandidateConfiguration.credentialService,
        ]) { _, new in new }
    }

    @Test func requiresExplicitConnectedBuildAndCompleteCandidateMetadata() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        guard case .invalid = CatalogCandidateRuntime.mode(info: Self.info, home: home,
            allowed: true, connectedAllowed: false) else { Issue.record("Metadata alone enabled connection"); return }
        let configuration = try Self.configuration(home: home)
        let connected = try #require(configuration.connected)
        #expect(connected.connectURL.absoluteString == CatalogCandidateRuntime.origin.absoluteString + "/app/connect")
        #expect(connected.uploadURL.absoluteString == CatalogCandidateRuntime.origin.absoluteString + "/api/portal/sync-upload")
        #expect(connected.callbackScheme == "omgskills")
        #expect(connected.keychainService != DeviceCredentialStore.defaultService)
        #expect(try FileManager.default.contentsOfDirectory(atPath: home.path).isEmpty)
        for key in Self.info.keys {
            var value = Self.info
            value.removeValue(forKey: key)
            guard case .invalid = CatalogCandidateRuntime.mode(info: value, home: home,
                allowed: true, connectedAllowed: true) else { Issue.record("Accepted missing \(key)"); continue }
        }
        #if OMGSKILLS_CATALOG_CANDIDATE && OMGSKILLS_CONNECTED_CANDIDATE && !OMGSKILLS_SETUP_TEST
        #expect(ConnectedCandidateConfiguration.buildAllowed)
        #else
        #expect(!ConnectedCandidateConfiguration.buildAllowed)
        #endif
        if ConnectedCandidateConfiguration.buildRequested {
            #expect(ConnectedCandidateConfiguration.mode(info: [:], allowed: false) == .invalid)
        } else {
            #expect(ConnectedCandidateConfiguration.mode(info: [:], allowed: false) == .disabled)
        }
    }

    @Test func oldCandidateAndPublicDefaultsStayDisconnected() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        // With no connected build request, the old candidate needs no new metadata.
        if !ConnectedCandidateConfiguration.buildRequested {
            let old = try CatalogCandidateRuntimeTests.configuration(home: home)
            #expect(old.connected == nil)
            #expect(ConnectedCandidateConfiguration.mode(info: [:], allowed: true) == .disabled)
        }
        guard case .invalid = CatalogCandidateRuntime.mode(info: Self.info, home: home,
            allowed: false, connectedAllowed: true) else { Issue.record("Connected flag bypassed candidate identity"); return }
        #expect(AppRuntimeConfiguration.connectedInventoryMode(info: Self.info) == .disabled)
    }

    @Test func rejectsRedirectedEndpointsCredentialsAndMixedTestModes() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        var changes: [[String: Any]] = [
            [ConnectedCandidateConfiguration.enabledKey: 1],
            [ConnectedCandidateConfiguration.enabledKey: false],
            [ConnectedCandidateConfiguration.credentialKey: DeviceCredentialStore.defaultService],
            [ConnectedCandidateConfiguration.credentialKey: "com.jonslimak.omgskills.inventory-test.old"],
            [BrowserPairing.connectURLInfoKey: ConnectedCandidateConfiguration.connectURL.absoluteString],
            ["OMGSkillsSyncEndpoint": ConnectedCandidateConfiguration.uploadURL.absoluteString],
            [DeviceCredentialStore.serviceInfoKey: ConnectedCandidateConfiguration.credentialService],
            [AppRuntimeConfiguration.connectedInventoryKey: false],
            [AppRuntimeConfiguration.inventoryReconciliationKey: true],
            [AppRuntimeConfiguration.inventoryAutomationKey: true],
        ]
        for key in [ConnectedCandidateConfiguration.connectKey, ConnectedCandidateConfiguration.uploadKey] {
            let expected = Self.info[key] as! String
            changes += ["https://omgskills.com/app/connect", "http://127.0.0.1:5203/app/connect",
                expected + "?redirect=1", expected + "#fragment", expected.replacingOccurrences(of: "https:", with: "http:"),
                expected.replacingOccurrences(of: "https://", with: "https://user@")].map { [key: $0] }
        }
        for change in changes {
            guard case .invalid = CatalogCandidateRuntime.mode(info: Self.info.merging(change) { _, new in new },
                home: home, allowed: true, connectedAllowed: true) else {
                Issue.record("Accepted mixed candidate settings: \(change.keys)"); continue
            }
        }
    }

    @Test func startupReplaysColdURLsAndRoutesPairingBeforeInstallsWithoutDiscovery() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/omgskills")
        let app = try String(contentsOf: root.appendingPathComponent("omgskillsApp.swift"), encoding: .utf8)
        let begin = try #require(app.range(of: "switch catalogCandidateMode"))
        let end = try #require(app.range(of: "switch catalogInstallMode"))
        let startup = app[begin.lowerBound..<end.lowerBound]
        #expect(startup.contains("pendingConnectedURLs.forEach(controller.receive)"))
        #expect(startup.contains("pendingConnectedURLs.removeAll()"))
        #expect(!startup.contains("SkillsStore.shared"))
        let controller = try String(contentsOf: root.appendingPathComponent("CatalogInstallView.swift"), encoding: .utf8)
        let receive = try #require(controller.range(of: "func receive(_ url: URL)"))
        let stop = try #require(controller.range(of: "func stopReporting()"))
        let routing = String(controller[receive.lowerBound..<stop.lowerBound])
        let pair = try #require(routing.range(of: "connectedRuntime?.receivePairingCallback(url)"))
        let install = try #require(routing.range(of: "model.receive(url)"))
        #expect(pair.lowerBound < install.lowerBound)
        #expect(!routing.contains("#if DEBUG"))
        #expect(controller.contains("connected.makeRuntime(paths: candidate.paths"))
        #expect(controller.contains("runtime.observeInstalls(in: model)"))
    }

    @Test func candidateSetupFailureAndContinuityWarningsHaveSeparatePresentationPaths() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/omgskills")
        let controller = try String(contentsOf: root.appendingPathComponent("CatalogInstallView.swift"), encoding: .utf8)
        let start = try #require(controller.range(of: "    convenience init(candidate:"))
        let end = try #require(controller.range(of: "    init(model:"))
        let candidate = String(controller[start.lowerBound..<end.lowerBound])
        let failure = try #require(candidate.range(of: "} catch {"))
        let success = String(candidate[..<failure.lowerBound])
        let failed = String(candidate[failure.upperBound...])
        #expect(success.contains("try connected.makeRuntime("))
        #expect(success.contains("runtime.start()"))
        #expect(failed.contains("connectionSetupError: CatalogInstallView.connectionSetupFailureMessage"))
        #expect(!failed.contains("makeRuntime("))
        #expect(!failed.contains("runtime.start()"))
        #expect(!failed.contains("error.localizedDescription"))
        #expect(!failed.contains("connection: runtime.connection"))
        #expect(controller.contains("if let connectionSetupError {"))
        #expect(controller.contains("Text(connectionSetupError)"))
        #expect(controller.contains("if model.phase == .confirm"))
        #expect(controller.contains("Button(action: model.install)"))
        let view = try String(contentsOf: root.appendingPathComponent("ConnectedInventoryView.swift"), encoding: .utf8)
        #expect(view.contains("if let warning = model.continuityWarning {"))
        #expect(view.contains("if let warning = model.disconnectWarning {"))
        #expect(!view.contains("else if let warning = model.disconnectWarning"))
    }

    #if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
    @MainActor
    @Test func factoryScopesReconnectStoreWithoutStartingWork() async throws {
        let fixture = try ReconnectCompositionFixture()
        defer { fixture.removeHome() }
        var scopes: [(URL, String)] = []
        let runtime = try fixture.configuration.makeRuntime(paths: fixture.candidate.paths,
            authorizer: fixture.authorizer, coordinator: UpdateInstallCoordinator(), credentialStore: fixture.credentials,
            makeReconnectKeyStore: { origin, service in scopes.append((origin, service)); return fixture.keys },
            api: fixture.api, automation: fixture.events.configuration)
        #expect(scopes.count == 1)
        #expect(scopes.first?.0 == CatalogCandidateRuntime.origin)
        #expect(scopes.first?.1 == ConnectedCandidateConfiguration.credentialService)
        #expect(await fixture.keys.loads == 0)
        #expect(await fixture.credentials.loads == 0)
        #expect(await fixture.api.events.isEmpty)
        #expect(fixture.authorizer.urls.isEmpty)
        #expect(fixture.events.changes.isEmpty)
        #expect(fixture.events.wakes.isEmpty)
        #expect(runtime.connection.state == .disconnected)
        #expect(CatalogInstallView.connectionSetupFailureMessage ==
            "Account connection is unavailable. Skill installation is still available.")
        await runtime.stop()
    }

    @MainActor
    @Test func factoryRejectsFailedReconnectConstructionBeforeAnyWork() async throws {
        let fixture = try ReconnectCompositionFixture()
        defer { fixture.removeHome() }
        var builds = 0
        #expect(throws: DeviceReconnectKeyStoreError.invalidScope) {
            try fixture.configuration.makeRuntime(paths: fixture.candidate.paths,
                authorizer: fixture.authorizer, coordinator: UpdateInstallCoordinator(), credentialStore: fixture.credentials,
                makeReconnectKeyStore: { _, _ in builds += 1; throw DeviceReconnectKeyStoreError.invalidScope },
                api: fixture.api, automation: fixture.events.configuration)
        }
        #expect(builds == 1)
        #expect(await fixture.keys.loads == 0)
        #expect(await fixture.credentials.loads == 0)
        #expect(await fixture.api.events.isEmpty)
        #expect(fixture.authorizer.urls.isEmpty)
        #expect(fixture.events.changes.isEmpty)
        #expect(fixture.events.wakes.isEmpty)
    }

    @MainActor
    @Test(.timeLimit(.minutes(1)))
    func factoryConnectRestoreDisconnectReconnectUsesSameKeyWithFreshBearer() async throws {
        let fixture = try ReconnectCompositionFixture()
        defer { fixture.removeHome() }
        let first = try fixture.makeRuntime()
        await first.start().value
        #expect(first.connection.state == .disconnected)
        #expect(await fixture.keys.loads == 0)
        #expect(await fixture.api.events.isEmpty)
        await first.connect(deviceName: "Fake candidate Mac").value
        #expect(await fixture.credentials.record == ReconnectCompositionAPI.first)
        #expect(first.connection.state == .connected(ReconnectCompositionAPI.first.connection))
        #expect(fixture.events.changes.count == 1)
        await first.stop()
        #expect(fixture.events.watchStops == 1)
        #expect(await fixture.api.revocations.isEmpty)

        let restored = try fixture.makeRuntime()
        await restored.start().value
        #expect(await fixture.api.events.suffix(3) == ["bind", "revision", "report"])
        #expect(await fixture.api.reports.count == 2)
        #expect(fixture.events.changes.count == 2)
        #expect(fixture.events.wakes.count == 2)
        #expect(await fixture.api.exchangeKeys.count == 1)
        let gate = ReconnectCompositionGate()
        await fixture.api.setBindingGate(gate)
        let disconnect = restored.disconnect()
        #expect(fixture.events.watchStops == 2)
        #expect(fixture.events.wakeStops == 2)
        try await gate.waitUntilBlocked()
        fixture.events.changes.forEach { $0() }
        fixture.events.wakes.forEach { $0() }
        await fixture.events.advance(60)
        #expect(await fixture.api.reports.count == 2)
        #expect(await fixture.api.checks == 0)
        await gate.open()
        await disconnect.value
        #expect(restored.connection.state == .disconnected)
        #expect(await fixture.credentials.record == nil)
        #expect(await fixture.api.revocations == [ReconnectCompositionAPI.first.credential])
        #expect(await fixture.credentials.deletions == [ReconnectCompositionAPI.first])
        let base = await fixture.api.revision
        await restored.connect(deviceName: "Fake candidate Mac").value
        #expect(await fixture.credentials.record == ReconnectCompositionAPI.second)
        #expect(restored.connection.state == .connected(ReconnectCompositionAPI.second.connection))
        #expect(await fixture.api.exchangeKeys == [fixture.keys.key, fixture.keys.key])
        #expect(await fixture.api.verifiers.count == 2)
        #expect(await fixture.api.verifiers.allSatisfy { $0?.count == 43 })
        #expect(await fixture.api.legacyExchanges == 0)
        #expect(await fixture.api.reports.map(\.0) == [ReconnectCompositionAPI.first.credential,
            ReconnectCompositionAPI.first.credential, ReconnectCompositionAPI.second.credential])
        #expect(await fixture.api.reports.last?.1.baseRevision == base)
        #expect(await fixture.api.checks == 0)
        #expect(restored.connection.continuityWarning == nil)
        #expect(ReconnectCompositionAPI.second.connection.grantedScopes == DeviceScope.metadataOnly)
        #expect(fixture.authorizer.urls.count == 2)
        #expect(fixture.authorizer.urls.allSatisfy {
            $0.absoluteString.hasPrefix(ConnectedCandidateConfiguration.connectURL.absoluteString + "#") &&
                !$0.absoluteString.contains(fixture.keys.key)
        })
        #expect(fixture.events.changes.count == 3)
        await restored.stop()
        #expect(fixture.events.watchStops == 3)
        #expect(fixture.events.wakeStops == 3)
    }

    @MainActor
    @Test(.timeLimit(.minutes(1)))
    func factoryHealthyRestoreKeepsAutomationAndContinuityWarningAfterBindingFailure() async throws {
        let fixture = try ReconnectCompositionFixture(record: ReconnectCompositionAPI.first)
        defer { fixture.removeHome() }
        await fixture.api.setBindingFailure(.server(statusCode: 503))
        let runtime = try fixture.makeRuntime()
        await runtime.start().value
        #expect(runtime.connection.state == .connected(ReconnectCompositionAPI.first.connection))
        #expect(runtime.connection.continuityWarning != nil)
        #expect(fixture.events.changes.count == 1)
        #expect(fixture.events.wakes.count == 1)
        #expect(await fixture.api.reports.count == 1)
        fixture.events.changes.first?()
        await fixture.events.advance(3)
        while await fixture.api.checks == 0 {
            try Task.checkCancellation()
            await Task.yield()
        }
        #expect(await fixture.api.checks == 1)
        #expect(runtime.connection.continuityWarning != nil)
        #expect(await fixture.credentials.record == ReconnectCompositionAPI.first)
        await fixture.api.setRevokeFailure(.server(statusCode: 503))
        await runtime.disconnect().value
        #expect(runtime.connection.state == .disconnected)
        #expect(runtime.connection.continuityWarning != nil)
        #expect(runtime.connection.disconnectWarning != nil)
        #expect(await fixture.credentials.record == nil)
        #expect(fixture.events.watchStops == 1)
        #expect(fixture.events.wakeStops == 1)
        await runtime.stop()
    }

    @MainActor
    @Test(arguments: [DeviceReconnectSupport.unsupported, .invalid])
    func factoryUnsupportedExchangeCannotSaveReportOrStartAutomation(_ support: DeviceReconnectSupport) async throws {
        let fixture = try ReconnectCompositionFixture()
        defer { fixture.removeHome() }
        await fixture.api.setSupport(support)
        let runtime = try fixture.makeRuntime()
        await runtime.connect(deviceName: "Fake candidate Mac").value
        #expect(runtime.connection.state == .failed(.reconnectRequired))
        #expect(await fixture.credentials.record == nil)
        #expect(await fixture.api.reports.isEmpty)
        #expect(await fixture.api.revocations == [ReconnectCompositionAPI.first.credential])
        #expect(fixture.events.changes.isEmpty)
        #expect(fixture.events.wakes.isEmpty)
        #expect(fixture.authorizer.urls.count == 1)
        #expect(await fixture.api.legacyExchanges == 0)
        await runtime.stop()
    }
    #endif

    static func configuration(home: URL) throws -> CatalogCandidateRuntime.Configuration {
        let mode = CatalogCandidateRuntime.mode(info: info, home: home, allowed: true, connectedAllowed: true)
        guard case .enabled(let configuration) = mode else { throw InvalidConfiguration() }
        return configuration
    }

    private struct InvalidConfiguration: Error {}
}

#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
@MainActor
private final class ReconnectCompositionFixture {
    let home: URL
    let candidate: CatalogCandidateRuntime.Configuration
    let configuration: ConnectedCandidateConfiguration
    let credentials: ReconnectCompositionCredentials
    let keys = ReconnectCompositionKeys()
    let api = ReconnectCompositionAPI()
    let authorizer = ReconnectCompositionAuthorizer()
    let events = ReconnectCompositionEvents()

    init(record: StoredDeviceCredential? = nil) throws {
        home = try CatalogCandidateRuntimeTests.home()
        let resolved = try ConnectedCandidateConfigurationTests.configuration(home: home)
        candidate = resolved
        configuration = try #require(resolved.connected)
        credentials = ReconnectCompositionCredentials(record: record)
        for root in candidate.paths.allSkillsRoots {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        }
    }

    func makeRuntime() throws -> ConnectedInventoryRuntime {
        try configuration.makeRuntime(paths: candidate.paths, authorizer: authorizer,
            coordinator: UpdateInstallCoordinator(), credentialStore: credentials,
            makeReconnectKeyStore: { _, _ in self.keys }, api: api, automation: events.configuration)
    }

    func removeHome() { try? FileManager.default.removeItem(at: home) }
}

private actor ReconnectCompositionKeys: DeviceReconnectKeyStoring {
    let key = String(repeating: "b", count: 64)
    var loads = 0
    func loadOrCreate() async throws -> String { loads += 1; return key }
}

private actor ReconnectCompositionCredentials: DeviceCredentialStoring {
    var record: StoredDeviceCredential?
    var loads = 0
    var deletions: [StoredDeviceCredential] = []
    init(record: StoredDeviceCredential?) { self.record = record }
    func load() async throws -> StoredDeviceCredential? { loads += 1; return record }
    func save(_ record: StoredDeviceCredential, replacingExisting: Bool) async throws { self.record = record }
    func delete(ifMatching expected: StoredDeviceCredential) async throws -> Bool {
        deletions.append(expected)
        guard record == expected else { return false }
        record = nil
        return true
    }
}

private actor ReconnectCompositionAPI: DeviceSyncServing {
    static let first = StoredDeviceCredential(credential: "candidate-first", connection: .init(
        deviceID: "candidate-fake-device", accountLabel: "Fake account", expiresAt: .distantFuture))
    static let second = StoredDeviceCredential(credential: "candidate-second", connection: first.connection)
    let reportMode: DeviceReportMode = .reconciliation
    var events: [String] = []
    var exchangeKeys: [String] = []
    var verifiers: [String?] = []
    var reports: [(String, ReconciliationSyncPayload)] = []
    var revocations: [String] = []
    var checks = 0
    var legacyExchanges = 0
    var revision: String?
    private var revoked: Set<String> = []
    private var support: DeviceReconnectSupport = .supported
    private var bindingFailure: DeviceSyncAPIError?
    private var revokeFailure: DeviceSyncAPIError?
    private var bindingGate: ReconnectCompositionGate?

    func exchange(pairingCode: String, deviceName: String, codeVerifier: String?) async throws -> StoredDeviceCredential {
        legacyExchanges += 1
        throw DeviceSyncAPIError.unsupportedReconnect
    }
    func exchangeForReconnect(pairingCode: String, deviceName: String, codeVerifier: String?,
                              reconnectKey: String) async throws -> DeviceReconnectExchange {
        guard DeviceReconnectKeyStore.isValidKey(reconnectKey), codeVerifier?.count == 43,
              pairingCode.hasPrefix("pair_") else { throw DeviceSyncAPIError.invalidPairingCode }
        events.append("exchange")
        exchangeKeys.append(reconnectKey)
        verifiers.append(codeVerifier)
        let record = exchangeKeys.count == 1 ? Self.first : Self.second
        return .init(record: record, support: support)
    }
    func bindReconnectKey(credential: String, reconnectKey: String, expectedDeviceID: String) async throws {
        try validate(credential)
        guard DeviceReconnectKeyStore.isValidKey(reconnectKey), expectedDeviceID == Self.first.connection.deviceID else {
            throw DeviceSyncAPIError.invalidResponse
        }
        events.append("bind")
        if let gate = bindingGate { bindingGate = nil; await gate.block() }
        if let bindingFailure { throw bindingFailure }
    }
    func inventoryRevision(credential: String) async throws -> String? {
        try validate(credential)
        events.append("revision")
        return revision
    }
    func upload(credential: String, installations: [Skill]) async throws -> SkillSyncResult {
        throw DeviceSyncAPIError.unsupportedReportMode
    }
    func reconcile(credential: String, payload: ReconciliationSyncPayload) async throws -> SkillSyncResult {
        try validate(credential)
        guard payload.baseRevision == revision else { throw DeviceSyncAPIError.inventoryChanged }
        events.append("report")
        reports.append((credential, payload))
        let next = UUID().uuidString.lowercased()
        revision = next
        return .init(syncRunId: next, syncedSkillCount: payload.skills.count, reportVersion: 3,
            mode: "reconciled", deviceId: Self.first.connection.deviceID, completedAt: "2026-10-22T12:00:00Z",
            revision: next, missingSkillCount: 0, roots: payload.roots,
            complete: payload.roots.allSatisfy { $0.state == .complete })
    }
    func checkInventory(credential: String, payload: InventoryCheckPayload) async throws -> InventoryCheckResult {
        try validate(credential)
        guard payload.baseRevision == revision else { throw DeviceSyncAPIError.inventoryChanged }
        checks += 1
        return .init(reportVersion: 3, mode: "checked", deviceId: Self.first.connection.deviceID,
            revision: payload.baseRevision, checkedAt: "2026-10-22T12:01:00Z")
    }
    func revoke(credential: String) async throws {
        revocations.append(credential)
        if let revokeFailure { throw revokeFailure }
        revoked.insert(credential)
    }
    func setBindingGate(_ gate: ReconnectCompositionGate) { bindingGate = gate }
    func setBindingFailure(_ error: DeviceSyncAPIError) { bindingFailure = error }
    func setRevokeFailure(_ error: DeviceSyncAPIError) { revokeFailure = error }
    func setSupport(_ support: DeviceReconnectSupport) { self.support = support }
    private func validate(_ credential: String) throws {
        guard [Self.first.credential, Self.second.credential].contains(credential), !revoked.contains(credential) else {
            throw DeviceSyncAPIError.reconnectRequired
        }
    }
}

@MainActor
private final class ReconnectCompositionAuthorizer: BrowserPairingAuthorizing {
    var urls: [URL] = []
    func authorize(url: URL, callbackScheme: String) async throws -> URL {
        urls.append(url)
        let items = URLComponents(string: "?" + (url.fragment ?? ""))?.queryItems
        let state = items?.first(where: { $0.name == "state" })?.value ?? ""
        return URL(string: "\(callbackScheme)://pair?code=pair_\(String(repeating: "c", count: 43))&state=\(state)")!
    }
    func cancel() {}
    func handleCallback(_ url: URL) -> Bool { false }
}

private actor ReconnectCompositionGate {
    private var blocked: CheckedContinuation<Void, Never>?
    func block() async { await withCheckedContinuation { blocked = $0 } }
    func waitUntilBlocked() async throws {
        while blocked == nil { try Task.checkCancellation(); await Task.yield() }
    }
    func open() { blocked?.resume(); blocked = nil }
}

@MainActor
private final class ReconnectCompositionEvents {
    var changes: [ConnectedInventoryRuntime.Automation.Event] = []
    var wakes: [ConnectedInventoryRuntime.Automation.Event] = []
    var watchStops = 0
    var wakeStops = 0
    private var now: TimeInterval = 0
    private var sleepers: [UUID: (TimeInterval, CheckedContinuation<Void, any Error>)] = [:]

    var configuration: ConnectedInventoryRuntime.Automation {
        .init(watch: { callback in self.changes.append(callback); return { self.watchStops += 1 } },
            wake: { callback in self.wakes.append(callback); return { self.wakeStops += 1 } },
            now: { self.now }, sleep: sleep, jitter: { 0 })
    }
    private func sleep(_ seconds: TimeInterval) async throws {
        try Task.checkCancellation()
        if seconds <= 0 { return }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { sleepers[id] = (now + seconds, $0) }
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
#endif
