import Foundation
import Testing
@testable import omgskills

@MainActor
struct DeviceConnectionModelTests {
    @Test func browserConnectExchangesWithVerifierAndPerformsFirstSync() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(exchangeRecord: record)
        let request = makeBrowserRequest()
        let authorizer = MockBrowserPairingAuthorizer(
            result: .success(approvedCallback(for: request))
        )
        let model = DeviceConnectionModel(
            credentialStore: store,
            api: api,
            browserAuthorizer: authorizer,
            pairingRequestGenerator: FixedBrowserPairingRequestGenerator(request: request)
        )

        await model.connectWithBrowser(
            deviceName: "Test Mac",
            installations: []
        ).value

        #expect(model.state == .connected(record.connection))
        #expect(await api.exchangedCodeVerifiers() == [request.codeVerifier])
        #expect(await api.uploadedCredentials() == [record.credential])
        #expect(authorizer.authorizationCount == 1)
    }

    @Test func browserCancellationReturnsToDisconnectedWithoutExchange() async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record)
        let request = makeBrowserRequest()
        let authorizer = MockBrowserPairingAuthorizer(
            result: .success(cancelledCallback(for: request))
        )
        let model = DeviceConnectionModel(
            credentialStore: MockDeviceCredentialStore(),
            api: api,
            browserAuthorizer: authorizer,
            pairingRequestGenerator: FixedBrowserPairingRequestGenerator(request: request)
        )

        await model.connectWithBrowser(deviceName: "Test Mac", installations: []).value

        #expect(model.state == .disconnected)
        #expect(await api.exchangeCallCount() == 0)
    }

    @Test func browserStateMismatchFailsBeforeExchange() async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record)
        let request = makeBrowserRequest()
        let authorizer = MockBrowserPairingAuthorizer(result: .success(URL(
            string: "omgskills://pair?code=pair_\(String(repeating: "a", count: 43))&state=wrong"
        )!))
        let model = DeviceConnectionModel(
            credentialStore: MockDeviceCredentialStore(),
            api: api,
            browserAuthorizer: authorizer,
            pairingRequestGenerator: FixedBrowserPairingRequestGenerator(request: request)
        )

        await model.connectWithBrowser(deviceName: "Test Mac", installations: []).value

        guard case .failed(.authorization) = model.state else {
            Issue.record("Expected an authorization failure")
            return
        }
        #expect(await api.exchangeCallCount() == 0)
    }

    @Test func browserReplacementCheckRunsBeforeAuthorization() async {
        let oldRecord = makeCredential(deviceID: "old-device", credential: "old-secret")
        let newRecord = makeCredential(deviceID: "new-device", credential: "new-secret")
        let authorizer = MockBrowserPairingAuthorizer(
            result: .success(approvedCallback(for: makeBrowserRequest()))
        )
        let model = DeviceConnectionModel(
            credentialStore: MockDeviceCredentialStore(record: oldRecord),
            api: MockDeviceSyncAPI(exchangeRecord: newRecord),
            browserAuthorizer: authorizer,
            pairingRequestGenerator: FixedBrowserPairingRequestGenerator(request: makeBrowserRequest())
        )

        await model.connectWithBrowser(deviceName: "Test Mac", installations: []).value

        #expect(model.state == .failed(.replacementRequired))
        #expect(authorizer.authorizationCount == 0)
    }

    @Test func connectsStoresCredentialAndPerformsFirstSync() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(exchangeRecord: record)
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        await model.connect(
            pairingCode: "pair-code",
            deviceName: "Test Mac",
            installations: []
        ).value

        #expect(model.state == .connected(record.connection))
        #expect(await store.currentRecord() == record)
        #expect(await api.uploadedCredentials() == [record.credential])
    }

    @Test func restorePublishesStoredConnectionWithoutSyncing() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore(record: record)
        let api = MockDeviceSyncAPI(exchangeRecord: record)
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        await model.restore().value

        #expect(model.state == .connected(record.connection))
        #expect(await api.uploadedCredentials().isEmpty)
    }

    @Test func keychainFailureRevokesExchangedCredential() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore(saveFailure: .storage)
        let api = MockDeviceSyncAPI(exchangeRecord: record)
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        await model.connect(
            pairingCode: "pair-code",
            deviceName: "Test Mac",
            installations: []
        ).value

        #expect(model.state == .failed(.credentialStorage))
        #expect(await store.currentRecord() == nil)
        #expect(await api.revokedCredentials() == [record.credential])
    }

    @Test func replacementRequiresExplicitConfirmationBeforeExchange() async {
        let oldRecord = makeCredential(deviceID: "old-device", credential: "old-secret")
        let newRecord = makeCredential(deviceID: "new-device", credential: "new-secret")
        let store = MockDeviceCredentialStore(record: oldRecord)
        let api = MockDeviceSyncAPI(exchangeRecord: newRecord)
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        await model.connect(
            pairingCode: "pair-code",
            deviceName: "Test Mac",
            installations: []
        ).value

        #expect(model.state == .failed(.replacementRequired))
        #expect(await store.currentRecord() == oldRecord)
        #expect(await api.exchangeCallCount() == 0)
        #expect(await api.revokedCredentials().isEmpty)
    }

    @Test func confirmedReplacementExchangesAndReplacesCredential() async {
        let oldRecord = makeCredential(deviceID: "old-device", credential: "old-secret")
        let newRecord = makeCredential(deviceID: "new-device", credential: "new-secret")
        let store = MockDeviceCredentialStore(record: oldRecord)
        let api = MockDeviceSyncAPI(exchangeRecord: newRecord)
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        await model.connect(
            pairingCode: "pair-code",
            deviceName: "Test Mac",
            installations: [],
            replacingExisting: true
        ).value

        #expect(model.state == .connected(newRecord.connection))
        #expect(await store.currentRecord() == newRecord)
        #expect(await api.exchangeCallCount() == 1)
    }

    @Test func disconnectDuringExchangeCannotRestoreCredential() async {
        let record = makeCredential()
        let gate = TestGate()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(exchangeRecord: record, exchangeGate: gate)
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        let connectTask = model.connect(
            pairingCode: "pair-code",
            deviceName: "Test Mac",
            installations: []
        )
        await gate.waitUntilBlocked()
        let disconnectTask = model.disconnect()
        await gate.open()
        await connectTask.value
        await disconnectTask.value

        #expect(model.state == .disconnected)
        #expect(await store.currentRecord() == nil)
        #expect(await api.revokedCredentials() == [record.credential])
    }

    @Test func newerConnectAttemptWinsOverSuspendedExchange() async {
        let firstRecord = makeCredential(deviceID: "device-1", credential: "secret-1")
        let secondRecord = makeCredential(deviceID: "device-2", credential: "secret-2")
        let gate = TestGate()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(exchangeRecords: [firstRecord, secondRecord], exchangeGate: gate)
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        let firstTask = model.connect(
            pairingCode: "first-code",
            deviceName: "Test Mac",
            installations: []
        )
        await gate.waitUntilBlocked()
        let secondTask = model.connect(
            pairingCode: "second-code",
            deviceName: "Test Mac",
            installations: []
        )
        await gate.open()
        await firstTask.value
        await secondTask.value

        #expect(model.state == .connected(secondRecord.connection))
        #expect(await store.currentRecord() == secondRecord)
        #expect(await api.revokedCredentials() == [firstRecord.credential])
    }

    @Test func cancellationAfterStorageRemovesCredential() async {
        let record = makeCredential()
        let gate = TestGate()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(exchangeRecord: record, uploadGate: gate)
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        let connectTask = model.connect(
            pairingCode: "pair-code",
            deviceName: "Test Mac",
            installations: []
        )
        await gate.waitUntilBlocked()
        model.cancelCurrentOperation()
        await gate.open()
        await connectTask.value

        #expect(model.state == .disconnected)
        #expect(await store.currentRecord() == nil)
        #expect(await api.revokedCredentials() == [record.credential])
    }

    @Test func rejectedDeviceCredentialRequiresReconnectAndClearsKeychain() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(
            exchangeRecord: record,
            uploadFailure: .reconnectRequired
        )
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        await model.connect(
            pairingCode: "pair-code",
            deviceName: "Test Mac",
            installations: []
        ).value

        #expect(model.state == .failed(.reconnectRequired))
        #expect(await store.currentRecord() == nil)
        #expect(await api.revokedCredentials() == [record.credential])
    }

    @Test func cancellingResyncPreservesExistingConnection() async {
        let record = makeCredential()
        let gate = TestGate()
        let store = MockDeviceCredentialStore(record: record)
        let api = MockDeviceSyncAPI(exchangeRecord: record, uploadGate: gate)
        let model = DeviceConnectionModel(credentialStore: store, api: api)
        await model.restore().value

        let retryTask = model.retrySync(installations: [])
        await gate.waitUntilBlocked()
        model.cancelCurrentOperation()
        await gate.open()
        await retryTask.value

        #expect(model.state == .connected(record.connection))
        #expect(await store.currentRecord() == record)
    }

    @Test func reconnectAfterCancellationWaitsForPriorCleanup() async {
        let firstRecord = makeCredential(deviceID: "device-1", credential: "secret-1")
        let secondRecord = makeCredential(deviceID: "device-2", credential: "secret-2")
        let gate = TestGate()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(exchangeRecords: [firstRecord, secondRecord], exchangeGate: gate)
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        let firstTask = model.connect(
            pairingCode: "first-code",
            deviceName: "Test Mac",
            installations: []
        )
        await gate.waitUntilBlocked()
        model.cancelCurrentOperation()
        let secondTask = model.connect(
            pairingCode: "second-code",
            deviceName: "Test Mac",
            installations: []
        )
        await gate.open()
        await firstTask.value
        await secondTask.value

        #expect(model.state == .connected(secondRecord.connection))
        #expect(await store.currentRecord() == secondRecord)
        #expect(await api.revokedCredentials() == [firstRecord.credential])
    }

    @Test func rejectedResyncClearsCredentialAndRequiresPairing() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore(record: record)
        let api = MockDeviceSyncAPI(
            exchangeRecord: record,
            uploadFailure: .reconnectRequired
        )
        let model = DeviceConnectionModel(credentialStore: store, api: api)
        await model.restore().value

        await model.retrySync(installations: []).value

        #expect(model.state == .failed(.reconnectRequired))
        #expect(await store.currentRecord() == nil)
    }

    @Test func offlineDisconnectClearsLocalCredentialAndShowsWarning() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore(record: record)
        let api = MockDeviceSyncAPI(exchangeRecord: record, revokeFailure: .server(statusCode: 503))
        let model = DeviceConnectionModel(credentialStore: store, api: api)

        await model.disconnect().value

        #expect(model.state == .disconnected)
        #expect(await store.currentRecord() == nil)
        #expect(model.disconnectWarning != nil)
    }

    private func makeCredential(
        deviceID: String = "device-1",
        credential: String = "device-secret"
    ) -> StoredDeviceCredential {
        StoredDeviceCredential(
            credential: credential,
            connection: DeviceConnectionInfo(
                deviceID: deviceID,
                accountLabel: "jon@example.com",
                expiresAt: Date().addingTimeInterval(3_600)
            )
        )
    }

    private func makeBrowserRequest() -> BrowserPairingRequest {
        BrowserPairingRequest(
            state: String(repeating: "s", count: 43),
            codeVerifier: String(repeating: "v", count: 43),
            codeChallenge: String(repeating: "c", count: 43)
        )
    }

    private func approvedCallback(for request: BrowserPairingRequest) -> URL {
        URL(string: "omgskills://pair?code=pair_\(String(repeating: "a", count: 43))&state=\(request.state)")!
    }

    private func cancelledCallback(for request: BrowserPairingRequest) -> URL {
        URL(string: "omgskills://pair?error=access_denied&state=\(request.state)")!
    }
}

private struct FixedBrowserPairingRequestGenerator: BrowserPairingRequestGenerating {
    let request: BrowserPairingRequest

    func makeRequest() throws -> BrowserPairingRequest {
        request
    }
}

@MainActor
private final class MockBrowserPairingAuthorizer: BrowserPairingAuthorizing {
    let result: Result<URL, Error>
    private(set) var authorizationCount = 0

    init(result: Result<URL, Error>) {
        self.result = result
    }

    func authorize(url: URL, callbackScheme: String) async throws -> URL {
        authorizationCount += 1
        return try result.get()
    }

    func cancel() {}

    func handleCallback(_ url: URL) -> Bool {
        false
    }
}

private enum MockCredentialStoreFailure: Error, Sendable {
    case storage
}

private actor MockDeviceCredentialStore: DeviceCredentialStoring {
    private var record: StoredDeviceCredential?
    private let saveFailure: MockCredentialStoreFailure?

    init(
        record: StoredDeviceCredential? = nil,
        saveFailure: MockCredentialStoreFailure? = nil
    ) {
        self.record = record
        self.saveFailure = saveFailure
    }

    func load() async throws -> StoredDeviceCredential? {
        record
    }

    func save(_ record: StoredDeviceCredential, replacingExisting: Bool) async throws {
        if let saveFailure {
            throw saveFailure
        }
        if let existing = self.record,
           existing.connection.deviceID != record.connection.deviceID,
           !replacingExisting {
            throw DeviceCredentialStoreError.replacementRequired
        }
        self.record = record
    }

    func delete(deviceID: String) async throws {
        if record?.connection.deviceID == deviceID {
            record = nil
        }
    }

    func currentRecord() -> StoredDeviceCredential? {
        record
    }
}

private actor MockDeviceSyncAPI: DeviceSyncServing {
    private let exchangeRecords: [StoredDeviceCredential]
    private let exchangeGate: TestGate?
    private let uploadGate: TestGate?
    private let uploadFailure: DeviceSyncAPIError?
    private let revokeFailure: DeviceSyncAPIError?
    private var exchangeCount = 0
    private var codeVerifiers: [String?] = []
    private var uploads: [String] = []
    private var revocations: [String] = []

    init(
        exchangeRecord: StoredDeviceCredential,
        exchangeGate: TestGate? = nil,
        uploadGate: TestGate? = nil,
        uploadFailure: DeviceSyncAPIError? = nil,
        revokeFailure: DeviceSyncAPIError? = nil
    ) {
        self.exchangeRecords = [exchangeRecord]
        self.exchangeGate = exchangeGate
        self.uploadGate = uploadGate
        self.uploadFailure = uploadFailure
        self.revokeFailure = revokeFailure
    }

    init(
        exchangeRecords: [StoredDeviceCredential],
        exchangeGate: TestGate? = nil,
        uploadGate: TestGate? = nil,
        uploadFailure: DeviceSyncAPIError? = nil,
        revokeFailure: DeviceSyncAPIError? = nil
    ) {
        self.exchangeRecords = exchangeRecords
        self.exchangeGate = exchangeGate
        self.uploadGate = uploadGate
        self.uploadFailure = uploadFailure
        self.revokeFailure = revokeFailure
    }

    func exchange(
        pairingCode: String,
        deviceName: String,
        codeVerifier: String?
    ) async throws -> StoredDeviceCredential {
        codeVerifiers.append(codeVerifier)
        let index = exchangeCount
        exchangeCount += 1
        let record = exchangeRecords[min(index, exchangeRecords.count - 1)]
        if index == 0, let exchangeGate {
            await exchangeGate.block()
        }
        return record
    }

    func upload(credential: String, installations: [Skill]) async throws -> SkillSyncResult {
        uploads.append(credential)
        if let uploadGate {
            await uploadGate.block()
        }
        if let uploadFailure {
            throw uploadFailure
        }
        return SkillSyncResult(syncRunId: "run-1", syncedSkillCount: installations.count)
    }

    func revoke(credential: String) async throws {
        revocations.append(credential)
        if let revokeFailure {
            throw revokeFailure
        }
    }

    func uploadedCredentials() -> [String] {
        uploads
    }

    func revokedCredentials() -> [String] {
        revocations
    }

    func exchangeCallCount() -> Int {
        exchangeCount
    }

    func exchangedCodeVerifiers() -> [String?] {
        codeVerifiers
    }
}

private actor TestGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var isBlocked = false

    func block() async {
        isBlocked = true
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func waitUntilBlocked() async {
        while !isBlocked {
            await Task.yield()
        }
    }

    func open() {
        isBlocked = false
        continuation?.resume()
        continuation = nil
    }
}
