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

    @Test func portalConnectMarksUpdateCoordinatorBusyUntilFinished() async {
        let record = makeCredential()
        let gate = TestGate()
        let coordinator = UpdateInstallCoordinator()
        let model = DeviceConnectionModel(
            credentialStore: MockDeviceCredentialStore(),
            api: MockDeviceSyncAPI(exchangeRecord: record, exchangeGate: gate),
            updateCoordinator: coordinator
        )

        let task = model.connect(
            pairingCode: "pair-code",
            deviceName: "Test Mac",
            installations: []
        )
        await gate.waitUntilBlocked()

        #expect(coordinator.isBusy == true)

        await gate.open()
        await task.value

        #expect(coordinator.isBusy == false)
    }

    @Test func cancelledPortalConnectClearsUpdateCoordinatorBusyState() async {
        let record = makeCredential()
        let gate = TestGate()
        let coordinator = UpdateInstallCoordinator()
        let model = DeviceConnectionModel(
            credentialStore: MockDeviceCredentialStore(),
            api: MockDeviceSyncAPI(exchangeRecord: record, exchangeGate: gate),
            updateCoordinator: coordinator
        )

        let task = model.connect(
            pairingCode: "pair-code",
            deviceName: "Test Mac",
            installations: []
        )
        await gate.waitUntilBlocked()

        #expect(coordinator.isBusy == true)

        model.cancelCurrentOperation()
        await gate.open()
        await task.value

        #expect(coordinator.isBusy == false)
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

    @Test func presenceConnectScansFreshInstallationsInsteadOfPassedDisplayList() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .presence)
        let scan = inventoryScan(["fresh", "other"], issueCount: 1)
        let scanner = MockInventoryScanner(result: scan)
        let model = DeviceConnectionModel(credentialStore: store, api: api, inventoryScanner: { try await scanner.scan() })
        await model.connect(pairingCode: "code", deviceName: "Mac", installations: inventoryScan(["stale"]).skills).value
        #expect(model.state == .connected(record.connection))
        #expect(await api.uploadedNames() == [["fresh", "other"]])
        #expect(await scanner.callCount() == 1)
        guard case .reported(let result, let issues) = model.reportStatus else { Issue.record("Expected a presence report"); return }
        #expect(result.deviceId == record.connection.deviceID)
        #expect(issues == 1)
        #expect(await store.currentRecord() == record)
    }

    @Test func presenceRestoreReportsAndResyncUsesNewScanAfterAnInstallation() async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .presence)
        let scanner = MockInventoryScanner(result: inventoryScan(["before"]))
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { try await scanner.scan() })
        await model.restore().value
        await scanner.setResult(inventoryScan(["before", "new-install"]))
        await model.retrySync(installations: []).value
        #expect(await api.uploadedNames() == [["before"], ["before", "new-install"]])
        #expect(await scanner.callCount() == 2)
        #expect(model.state == .connected(record.connection))
    }

    @Test(arguments: [DeviceReportMode.presence, .reconciliation])
    func presenceTriggersDuringScanCoalesceIntoOneFreshFollowup(_ mode: DeviceReportMode) async {
        let record = makeCredential()
        let gate = TestGate()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: mode)
        let scanner = MockInventoryScanner(result: inventoryScan(["before"]), gate: gate)
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(), api: api,
            inventoryScanner: { try await scanner.scan() })
        let task = model.connect(pairingCode: "code", deviceName: "Mac", installations: [])
        await gate.waitUntilBlocked()
        await scanner.setResult(inventoryScan(["after"]))
        for _ in 0..<20 { model.requestInventoryReport() }
        #expect(model.state == .connected(record.connection))
        await gate.open()
        await task.value
        #expect(await scanner.callCount() == 2)
        #expect(await api.uploadedNames() == [["before"], ["after"]])
    }

    @Test func presenceUploadFailureRetainsConnectionAndManualRetryDoesNotPairAgain() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(exchangeRecord: record, uploadFailure: .server(statusCode: 503), reportMode: .presence)
        let scanner = MockInventoryScanner(result: inventoryScan(["installed"]))
        let model = DeviceConnectionModel(credentialStore: store, api: api, inventoryScanner: { try await scanner.scan() })
        await model.connect(pairingCode: "code", deviceName: "Mac", installations: []).value
        #expect(model.state == .connected(record.connection))
        #expect(await store.currentRecord() == record)
        guard case .failed = model.reportStatus else { Issue.record("Expected reporting failure"); return }
        await api.setUploadFailure(nil)
        await model.requestInventoryReport().value
        #expect(await api.exchangeCallCount() == 1)
        #expect(await api.uploadedCredentials() == [record.credential, record.credential])
        guard case .reported = model.reportStatus else { Issue.record("Expected retry success"); return }
    }

    @Test(arguments: [DeviceReportMode.presence, .reconciliation])
    func presenceDisconnectDuringUncooperativeScanDoesNotUploadOrRestoreConnection(_ mode: DeviceReportMode) async {
        let record = makeCredential()
        let gate = TestGate()
        let store = MockDeviceCredentialStore()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: mode)
        let scanner = MockInventoryScanner(result: inventoryScan(["old-account"]), gate: gate)
        let model = DeviceConnectionModel(credentialStore: store, api: api, inventoryScanner: { try await scanner.scan() })
        let connect = model.connect(pairingCode: "code", deviceName: "Mac", installations: [])
        await gate.waitUntilBlocked()
        let disconnect = model.disconnect()
        await gate.open()
        await connect.value
        await disconnect.value
        #expect(await api.uploadedCredentials().isEmpty)
        #expect(await store.currentRecord() == nil)
        #expect(model.state == .disconnected)
        #expect(model.reportStatus == .idle)
    }

    @Test(arguments: [DeviceReportMode.presence, .reconciliation])
    func presenceReplacementDoesNotSendOldScanWithNewAccountCredential(_ mode: DeviceReportMode) async {
        let first = makeCredential(deviceID: "device-1", credential: "secret-1")
        let second = makeCredential(deviceID: "device-2", credential: "secret-2")
        let gate = TestGate()
        let api = MockDeviceSyncAPI(exchangeRecords: [first, second], reportMode: mode)
        let scanner = MockInventoryScanner(result: inventoryScan(["old-account"]), gate: gate)
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(), api: api,
            inventoryScanner: { try await scanner.scan() })
        let oldTask = model.connect(pairingCode: "old", deviceName: "Mac", installations: [])
        await gate.waitUntilBlocked()
        let newTask = model.connect(pairingCode: "new", deviceName: "Mac", installations: [], replacingExisting: true)
        await scanner.setResult(inventoryScan(["new-account"]))
        await gate.open()
        await oldTask.value
        await newTask.value
        #expect(await api.uploadedCredentials() == [second.credential])
        #expect(await api.uploadedNames() == [["new-account"]])
        #expect(model.state == .connected(second.connection))
    }

    @Test(arguments: [DeviceReportMode.presence, .reconciliation])
    func presenceLateUploadCompletionCannotOverwriteReplacementStatus(_ mode: DeviceReportMode) async {
        let first = makeCredential(deviceID: "device-1", credential: "secret-1")
        let second = makeCredential(deviceID: "device-2", credential: "secret-2")
        let gate = TestGate()
        let api = MockDeviceSyncAPI(exchangeRecords: [first, second], uploadGate: gate, reportMode: mode)
        let scanner = MockInventoryScanner(result: inventoryScan(["first"]))
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(), api: api,
            inventoryScanner: { try await scanner.scan() })
        let oldTask = model.connect(pairingCode: "old", deviceName: "Mac", installations: [])
        await gate.waitUntilBlocked()
        let newTask = model.connect(pairingCode: "new", deviceName: "Mac", installations: [], replacingExisting: true)
        await scanner.setResult(inventoryScan(["second"]))
        await gate.open()
        await oldTask.value
        await newTask.value
        #expect(await api.uploadedCredentials() == [first.credential, second.credential])
        #expect(model.state == .connected(second.connection))
        guard case .reported(let result, _) = model.reportStatus else { Issue.record("Expected new report"); return }
        #expect(result.deviceId == second.connection.deviceID)
    }

    @Test func presenceReportTriggersDoNotCancelAnActiveBrowserConnection() async {
        let record = makeCredential()
        let gate = TestGate()
        let request = makeBrowserRequest()
        let api = MockDeviceSyncAPI(exchangeRecord: record, exchangeGate: gate, reportMode: .presence)
        let authorizer = MockBrowserPairingAuthorizer(result: .success(approvedCallback(for: request)))
        let scanner = MockInventoryScanner(result: inventoryScan(["installed"]))
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(), api: api,
            browserAuthorizer: authorizer, pairingRequestGenerator: FixedBrowserPairingRequestGenerator(request: request),
            inventoryScanner: { try await scanner.scan() })
        let task = model.connectWithBrowser(deviceName: "Mac", installations: [])
        await gate.waitUntilBlocked()
        model.requestInventoryReport()
        await gate.open()
        await task.value
        #expect(model.state == .connected(record.connection))
        #expect(authorizer.authorizationCount == 1)
        #expect(await api.exchangeCallCount() == 1)
        #expect(await api.uploadedCredentials() == [record.credential])
    }

    @Test func presenceUnauthorizedRequiresReconnectAndMissingScannerNeverUploads() async {
        let record = makeCredential()
        let store = MockDeviceCredentialStore(record: record)
        let api = MockDeviceSyncAPI(exchangeRecord: record, uploadFailure: .reconnectRequired, reportMode: .presence)
        let scanner = MockInventoryScanner(result: inventoryScan([]))
        let model = DeviceConnectionModel(credentialStore: store, api: api, inventoryScanner: { try await scanner.scan() })
        await model.restore().value
        #expect(model.state == .failed(.reconnectRequired))
        #expect(await store.currentRecord() == nil)
        await model.requestInventoryReport().value
        #expect(await api.uploadedCredentials().count == 1)
        let secondAPI = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .presence)
        let missing = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: secondAPI)
        await missing.restore().value
        #expect(missing.state == .connected(record.connection))
        #expect(missing.reportStatus == .failed(PresenceSyncError.missingScanner.localizedDescription))
        #expect(await secondAPI.uploadedCredentials().isEmpty)
    }

    @Test func presenceQueuedReportIsClearedWhenBrowserApprovalIsCancelled() async {
        let record = makeCredential()
        let gate = TestGate()
        let request = makeBrowserRequest()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .presence)
        let authorizer = MockBrowserPairingAuthorizer(result: .success(cancelledCallback(for: request)), gate: gate)
        let scanner = MockInventoryScanner(result: inventoryScan([]))
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(), api: api,
            browserAuthorizer: authorizer, pairingRequestGenerator: FixedBrowserPairingRequestGenerator(request: request),
            inventoryScanner: { try await scanner.scan() })
        let task = model.connectWithBrowser(deviceName: "Mac", installations: [])
        await gate.waitUntilBlocked()
        model.requestInventoryReport()
        #expect(model.reportStatus == .pending)
        await gate.open()
        await task.value
        #expect(model.state == .disconnected)
        #expect(model.reportStatus == .idle)
        #expect(await scanner.callCount() == 0)
    }

    @Test func presenceRestoreCannotReviveADeletedCredential() async throws {
        let record = makeCredential()
        let store = MockDeviceCredentialStore(record: record)
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .presence)
        let scanner = MockInventoryScanner(result: inventoryScan([]))
        let model = DeviceConnectionModel(credentialStore: store, api: api, inventoryScanner: { try await scanner.scan() })
        await model.restore().value
        try await store.delete(deviceID: record.connection.deviceID)
        await model.restore().value
        model.cancelCurrentOperation()
        await model.requestInventoryReport().value
        #expect(model.state == .disconnected)
        #expect(await api.uploadedCredentials().count == 1)
    }

    @Test func cancellingPresenceUploadKeepsConnectionAndAllowsAnotherFreshReport() async {
        let record = makeCredential()
        let gate = TestGate()
        let store = MockDeviceCredentialStore(record: record)
        let api = MockDeviceSyncAPI(exchangeRecord: record, uploadGate: gate, reportMode: .presence)
        let scanner = MockInventoryScanner(result: inventoryScan(["first"]))
        let model = DeviceConnectionModel(credentialStore: store, api: api, inventoryScanner: { try await scanner.scan() })
        let task = model.restore()
        await gate.waitUntilBlocked()
        model.cancelCurrentOperation()
        await gate.open()
        await task.value
        #expect(await store.currentRecord() == record)
        #expect(model.state == .connected(record.connection))
        await scanner.setResult(inventoryScan(["after-cancel"]))
        await model.requestInventoryReport().value
        #expect(await api.uploadedNames() == [["first"], ["after-cancel"]])
        guard case .reported = model.reportStatus else { Issue.record("Expected retry success"); return }
    }

    @Test func cancelAndAwaitCleansPersistedInterruptedCredentialBeforeReturning() async {
        let record = makeCredential()
        let saveGate = TestGate()
        let store = MockDeviceCredentialStore(saveGate: saveGate)
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .presence, revokeChecksCancellation: true)
        let scan = inventoryScan([])
        let model = DeviceConnectionModel(credentialStore: store, api: api,
            inventoryScanner: { scan })
        let connect = model.connect(pairingCode: "fixture", deviceName: "Test Mac", installations: [])
        await saveGate.waitUntilBlocked()
        #expect(await store.currentRecord() == record)
        #expect(model.state == .storingCredential)
        var returned = false
        let stop = Task { await model.cancelAndAwaitCurrentOperation(); returned = true }
        while model.state != .disconnected { await Task.yield() }
        #expect(!returned)
        #expect(await store.currentRecord() == record)
        await saveGate.open()
        await stop.value
        #expect(returned)
        #expect(await store.currentRecord() == nil)
        #expect(await api.revokedCredentials() == [record.credential])
        #expect(await api.uploadedCredentials().isEmpty)
        await connect.value
    }

    @Test func cancelAndAwaitWaitsForUncooperativeScanAndRetainsRestoredCredential() async {
        let record = makeCredential()
        let scanGate = TestGate()
        let store = MockDeviceCredentialStore(record: record)
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .presence)
        let scanner = MockInventoryScanner(result: inventoryScan(["fixture"]), gate: scanGate)
        let model = DeviceConnectionModel(credentialStore: store, api: api, inventoryScanner: { try await scanner.scan() })
        let restore = model.restore()
        await scanGate.waitUntilBlocked()
        var returned = false
        let stop = Task { await model.cancelAndAwaitCurrentOperation(); returned = true }
        while model.reportStatus != .idle { await Task.yield() }
        #expect(!returned)
        await scanGate.open()
        await stop.value
        #expect(returned)
        #expect(await store.currentRecord() == record)
        #expect(model.state == .connected(record.connection))
        #expect(await api.uploadedCredentials().isEmpty)
        #expect(await api.revokedCredentials().isEmpty)
        await restore.value
    }

    @Test(arguments: [DeviceSyncAPIError.inventoryChanged, .server(statusCode: 503), .invalidResponse])
    func reconciliationResyncReadsRevisionBeforeANewScanAndNeverReplays(_ failure: DeviceSyncAPIError) async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record, uploadFailure: failure, reportMode: .reconciliation)
        let scanner = MockInventoryScanner(result: inventoryScan(["before"]))
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { await api.noteScan(); return try await scanner.scan() })
        await model.restore().value
        #expect(model.state == .connected(record.connection))
        if failure == .inventoryChanged {
            #expect(model.reportStatus == .failed(DeviceSyncAPIError.inventoryChanged.localizedDescription))
        } else {
            guard case .uncertain = model.reportStatus else { Issue.record("Submitted report may have committed"); return }
        }
        #expect(await api.reportEvents() == ["revision", "scan", "upload"])
        #expect(await api.uploadedCredentials().count == 1)
        let next = UUID().uuidString.lowercased()
        await api.setRevision(next)
        await api.setUploadFailure(nil)
        await scanner.setResult(inventoryScan(["after"]))
        await model.requestInventoryReport().value
        #expect(await api.reportEvents() == ["revision", "scan", "upload", "revision", "scan", "upload"])
        #expect(await api.uploadedNames() == [["before"], ["after"]])
        #expect(await api.reconciliationBases() == [nil, next])
        #expect(await api.exchangeCallCount() == 0)
        guard case .reported = model.reportStatus else { Issue.record("Expected fresh report success"); return }
    }

    @Test(arguments: ["revision", "scan", "upload"])
    func reconciliationCancellationNeverStartsTheNextStepOrClaimsRollback(_ step: String) async {
        let record = makeCredential()
        let gate = TestGate()
        let api = MockDeviceSyncAPI(exchangeRecord: record, uploadGate: step == "upload" ? gate : nil,
            reportMode: .reconciliation, revisionGate: step == "revision" ? gate : nil)
        let scanner = MockInventoryScanner(result: inventoryScan(["fixture"]), gate: step == "scan" ? gate : nil)
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { try await scanner.scan() })
        let report = model.restore()
        await gate.waitUntilBlocked()
        model.cancelCurrentOperation()
        if step == "upload" {
            guard case .uncertain = model.reportStatus else { Issue.record("Do not claim cancellation rolled back a submitted upload"); await gate.open(); return }
        }
        await gate.open()
        await report.value
        #expect(await scanner.callCount() == (step == "revision" ? 0 : 1))
        #expect(await api.uploadedCredentials().count == (step == "upload" ? 1 : 0))
        #expect(model.state == .connected(record.connection))
        await model.requestInventoryReport().value
        guard case .reported = model.reportStatus else { Issue.record("Expected a fresh Resync"); return }
    }

    @Test func reconciliationWrongDeviceAcknowledgementCannotShowSuccess() async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .reconciliation)
        await api.setAcknowledgementDevice("wrong-device")
        let scan = inventoryScan([])
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { scan })
        await model.restore().value
        guard case .uncertain = model.reportStatus else { Issue.record("Wrong device must never show success"); return }
        #expect(model.state == .connected(record.connection))
    }

    @Test func scheduledReportUsesFreshRevisionAndScanAfterUncertainSubmission() async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record, uploadFailure: .server(statusCode: 503), reportMode: .reconciliation)
        let scanner = MockInventoryScanner(result: inventoryScan(["before"]))
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { await api.noteScan(); return try await scanner.scan() })
        await model.restore().value
        #expect(model.lastReportOutcome == .retryable(retryAfter: nil))
        guard case .uncertain = model.reportStatus else { Issue.record("Submitted failure is uncertain"); return }
        let revision = UUID().uuidString.lowercased()
        await api.setRevision(revision)
        await api.setUploadFailure(nil)
        await scanner.setResult(inventoryScan(["after"]))
        #expect(await model.requestScheduledInventoryReport() == .reported(partial: false))
        #expect(await api.reportEvents() == ["revision", "scan", "upload", "revision", "scan", "upload"])
        #expect(await api.uploadedNames() == [["before"], ["after"]])
        #expect(await api.reconciliationBases() == [nil, revision])
    }

    @Test func scheduledPartialReportDoesNotBecomeRetryableAndDisconnectStopsRequests() async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .reconciliation)
        let scan = inventoryScan(["fixture"], issueCount: 1)
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { scan })
        await model.restore().value
        #expect(await model.requestScheduledInventoryReport() == .reported(partial: true))
        await model.disconnect().value
        #expect(await model.requestScheduledInventoryReport() == .cancelled)
        #expect(await api.uploadedCredentials().count == 2)
    }

    @Test(arguments: [DeviceSyncAPIError.invalidResponse, .reconnectRequired, .inventoryChanged,
                      .retryableServer(statusCode: 429, retryAfter: 80)])
    func scheduledReportReturnsTypedFailureWithoutAutomaticRetry(_ failure: DeviceSyncAPIError) async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .reconciliation)
        let scan = inventoryScan([])
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { scan })
        await model.restore().value
        await api.setUploadFailure(failure)
        #expect(await model.requestScheduledInventoryReport() == InventoryReportOutcome.failure(failure))
        #expect(await api.uploadedCredentials().count == 2)
    }

    @Test func cancelledScheduledWaitCannotReturnASuccessFromAnotherSession() async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .reconciliation)
        let scan = inventoryScan([])
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { scan })
        await model.restore().value
        let task = Task { await model.requestScheduledInventoryReport() }
        task.cancel()
        #expect(await task.value == .cancelled)
        #expect(await api.uploadedCredentials().count == 1)
    }

    @Test func cancellingOwnedScheduledReportStopsBeforeUploadingAndRetainsConnection() async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .reconciliation)
        let gate = TestGate()
        let scanner = MockInventoryScanner(result: inventoryScan([]), gate: gate, gateAtCall: 2)
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { try await scanner.scan() })
        await model.restore().value
        let scheduled = Task { await model.requestScheduledInventoryReport() }
        await gate.waitUntilBlocked()
        scheduled.cancel()
        for _ in 0..<30 { await Task.yield() }
        await gate.open()
        #expect(await scheduled.value == .cancelled)
        #expect(await api.uploadedCredentials().count == 1)
        #expect(model.state == .connected(record.connection))
    }

    @Test func cancellingScheduledWaitDoesNotCancelAnExistingManualReport() async {
        let record = makeCredential()
        let api = MockDeviceSyncAPI(exchangeRecord: record, reportMode: .reconciliation)
        let gate = TestGate()
        let scanner = MockInventoryScanner(result: inventoryScan([]), gate: gate, gateAtCall: 2)
        let model = DeviceConnectionModel(credentialStore: MockDeviceCredentialStore(record: record), api: api,
            inventoryScanner: { try await scanner.scan() })
        await model.restore().value
        let manual = model.requestInventoryReport()
        await gate.waitUntilBlocked()
        let scheduled = Task { await model.requestScheduledInventoryReport() }
        for _ in 0..<30 { await Task.yield() }
        scheduled.cancel()
        for _ in 0..<30 { await Task.yield() }
        #expect(!manual.isCancelled)
        await gate.open()
        await manual.value
        #expect(await scheduled.value == .cancelled)
        #expect(model.lastReportOutcome == .reported(partial: false))
    }

    private func inventoryScan(_ names: [String], issueCount: Int = 0) -> InstalledSkillsScanner.ScanResult {
        let installations = names.map { name in
            Skill(id: "installed:\(name)", name: name, description: "Example", githubUrl: "",
                installCmd: "/tmp/\(name)", authorHandle: "", tags: [], readmeSnippet: nil,
                stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: nil,
                installs: nil, trendingRank: nil, trendingSource: nil,
                origin: "Codex", isSymlink: false, isLocalOnly: true)
        }
        return InstalledSkillsScanner.ScanResult(skills: Array(installations.prefix(1)), installations: installations,
            summary: InstalledSkillSummary(), issues: Array(repeating: .unreadableRoot(source: "Agents"), count: issueCount),
            roots: ["claude", "codex", "agents"].map {
                .init(source: $0, state: $0 == "agents" && issueCount > 0 ? .incomplete : .complete,
                    reason: $0 == "agents" && issueCount > 0 ? .invalidEntry : nil)
            })
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
            codeChallenge: String(repeating: "c", count: 43),
            scopes: DeviceScope.allCases
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
    private let gate: TestGate?
    private(set) var authorizationCount = 0

    init(result: Result<URL, Error>, gate: TestGate? = nil) {
        self.result = result
        self.gate = gate
    }

    func authorize(url: URL, callbackScheme: String) async throws -> URL {
        authorizationCount += 1
        if let gate { await gate.block() }
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
    private let saveGate: TestGate?

    init(
        record: StoredDeviceCredential? = nil,
        saveFailure: MockCredentialStoreFailure? = nil,
        saveGate: TestGate? = nil
    ) {
        self.record = record
        self.saveFailure = saveFailure
        self.saveGate = saveGate
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
        if let saveGate { await saveGate.block() }
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
    let reportMode: DeviceReportMode
    private let exchangeRecords: [StoredDeviceCredential]
    private let exchangeGate: TestGate?
    private let uploadGate: TestGate?
    private var uploadFailure: DeviceSyncAPIError?
    private let revokeFailure: DeviceSyncAPIError?
    private let revokeChecksCancellation: Bool
    private var exchangeCount = 0
    private var codeVerifiers: [String?] = []
    private var uploads: [String] = []
    private var uploadNames: [[String]] = []
    private var revocations: [String] = []
    private var revision: String?
    private let revisionGate: TestGate?
    private var revisionReads = 0
    private var bases: [String?] = []
    private var events: [String] = []
    private var acknowledgementDevice: String?

    init(
        exchangeRecord: StoredDeviceCredential,
        exchangeGate: TestGate? = nil,
        uploadGate: TestGate? = nil,
        uploadFailure: DeviceSyncAPIError? = nil,
        revokeFailure: DeviceSyncAPIError? = nil,
        reportMode: DeviceReportMode = .legacy,
        revokeChecksCancellation: Bool = false,
        revisionGate: TestGate? = nil
    ) {
        self.exchangeRecords = [exchangeRecord]
        self.exchangeGate = exchangeGate
        self.uploadGate = uploadGate
        self.uploadFailure = uploadFailure
        self.revokeFailure = revokeFailure
        self.reportMode = reportMode
        self.revokeChecksCancellation = revokeChecksCancellation
        self.revisionGate = revisionGate
    }

    init(
        exchangeRecords: [StoredDeviceCredential],
        exchangeGate: TestGate? = nil,
        uploadGate: TestGate? = nil,
        uploadFailure: DeviceSyncAPIError? = nil,
        revokeFailure: DeviceSyncAPIError? = nil,
        reportMode: DeviceReportMode = .legacy
    ) {
        self.exchangeRecords = exchangeRecords
        self.exchangeGate = exchangeGate
        self.uploadGate = uploadGate
        self.uploadFailure = uploadFailure
        self.revokeFailure = revokeFailure
        self.reportMode = reportMode
        self.revokeChecksCancellation = false
        self.revisionGate = nil
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
        uploadNames.append(installations.map(\.name))
        if uploads.count == 1, let uploadGate {
            await uploadGate.block()
        }
        if let uploadFailure {
            throw uploadFailure
        }
        let deviceID = exchangeRecords.first(where: { $0.credential == credential })?.connection.deviceID
        return SkillSyncResult(syncRunId: "run-1", syncedSkillCount: installations.count,
            reportVersion: reportMode == .presence ? 2 : nil, mode: reportMode == .presence ? "presence" : nil,
            deviceId: reportMode == .presence ? deviceID : nil,
            completedAt: reportMode == .presence ? "2026-10-16T12:00:00.123Z" : nil)
    }

    func inventoryRevision(credential: String) async throws -> String? {
        events.append("revision")
        revisionReads += 1
        if revisionReads == 1, let revisionGate { await revisionGate.block() }
        return revision
    }

    func reconcile(credential: String, payload: ReconciliationSyncPayload) async throws -> SkillSyncResult {
        events.append("upload")
        bases.append(payload.baseRevision)
        uploads.append(credential)
        uploadNames.append(payload.skills.map(\.name))
        if uploads.count == 1, let uploadGate { await uploadGate.block() }
        if let uploadFailure { throw uploadFailure }
        let next = UUID().uuidString.lowercased()
        revision = next
        return SkillSyncResult(syncRunId: next, syncedSkillCount: payload.skills.count, reportVersion: 3,
            mode: "reconciled", deviceId: acknowledgementDevice ?? exchangeRecords.first(where: { $0.credential == credential })?.connection.deviceID,
            completedAt: "2026-10-16T12:00:00.123Z", revision: next, missingSkillCount: 0,
            roots: payload.roots, complete: payload.roots.allSatisfy { $0.state == .complete })
    }

    func noteScan() { events.append("scan") }
    func reportEvents() -> [String] { events }
    func reconciliationBases() -> [String?] { bases }
    func setRevision(_ value: String) { revision = value }
    func setAcknowledgementDevice(_ value: String) { acknowledgementDevice = value }

    func revoke(credential: String) async throws {
        if revokeChecksCancellation { try Task.checkCancellation() }
        revocations.append(credential)
        if let revokeFailure {
            throw revokeFailure
        }
    }

    func uploadedCredentials() -> [String] {
        uploads
    }

    func uploadedNames() -> [[String]] { uploadNames }
    func setUploadFailure(_ failure: DeviceSyncAPIError?) { uploadFailure = failure }

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

private actor MockInventoryScanner {
    private var result: InstalledSkillsScanner.ScanResult
    private var calls = 0
    private let gate: TestGate?
    private let gateAtCall: Int

    init(result: InstalledSkillsScanner.ScanResult, gate: TestGate? = nil, gateAtCall: Int = 1) {
        self.result = result
        self.gate = gate
        self.gateAtCall = gateAtCall
    }

    func scan() async throws -> InstalledSkillsScanner.ScanResult {
        calls += 1
        let snapshot = result
        if calls == gateAtCall, let gate { await gate.block() }
        return snapshot
    }

    func callCount() -> Int { calls }
    func setResult(_ result: InstalledSkillsScanner.ScanResult) { self.result = result }
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
