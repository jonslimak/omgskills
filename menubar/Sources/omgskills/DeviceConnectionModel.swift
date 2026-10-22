import Foundation
import Observation

enum DeviceConnectionFailure: Equatable, Sendable {
    case authorization(String)
    case exchange(String)
    case replacementRequired
    case credentialStorage
    case sync(String)
    case reconnectRequired
}

@MainActor
@Observable
final class DeviceConnectionModel {
    enum State: Equatable, Sendable {
        case disconnected
        case authorizing
        case exchanging
        case storingCredential
        case syncing
        case connected(DeviceConnectionInfo)
        case failed(DeviceConnectionFailure)
    }

    enum ReportStatus: Equatable, Sendable {
        case idle
        case pending
        case reporting
        case reported(SkillSyncResult, scanIssueCount: Int)
        case failed(String)
        case uncertain(String)
    }

    typealias InventoryScanner = @Sendable () async throws -> InstalledSkillsScanner.ScanResult

    private(set) var state: State = .disconnected
    private(set) var disconnectWarning: String?
    private(set) var continuityWarning: String?
    private(set) var reportStatus: ReportStatus = .idle
    private(set) var lastReportOutcome: InventoryReportOutcome?
    private(set) var lastInventoryCheckedAt: Date?
    @ObservationIgnored var onInventoryConnectionReady: (@MainActor () -> Void)?

    @ObservationIgnored private let credentialStore: any DeviceCredentialStoring
    @ObservationIgnored private let reconnectKeyStore: (any DeviceReconnectKeyStoring)?
    @ObservationIgnored private let api: any DeviceSyncServing
    @ObservationIgnored private let browserAuthorizer: (any BrowserPairingAuthorizing)?
    @ObservationIgnored private let pairingRequestGenerator: any BrowserPairingRequestGenerating
    @ObservationIgnored private let portalConnectURL: URL
    @ObservationIgnored private let callbackScheme: String
    @ObservationIgnored private let updateCoordinator: UpdateInstallCoordinator?
    @ObservationIgnored private var activeTask: Task<Void, Never>?
    @ObservationIgnored private var activeAttemptID: UUID?
    // Cancellation retains state ownership until a newer attempt starts.
    @ObservationIgnored private var stateAttemptID: UUID?
    @ObservationIgnored private var needsReconnect = false
    @ObservationIgnored private var connectedInfo: DeviceConnectionInfo?
    @ObservationIgnored private var connectedCredential: StoredDeviceCredential?
    @ObservationIgnored private let inventoryScanner: InventoryScanner?
    @ObservationIgnored private var reportRequested = false
    @ObservationIgnored private var reconciliationUploadInFlight = false
    @ObservationIgnored private var lastReportAttemptID: UUID?
    @ObservationIgnored private let inventoryAutomationEnabled: Bool
    @ObservationIgnored private var forceFullReportRequested = false
    @ObservationIgnored private var inventoryBaseline: InventoryBaseline?

    private struct InventoryBaseline {
        let payload: ReconciliationSyncPayload
        let result: SkillSyncResult
        let credential: StoredDeviceCredential
    }

    private static let continuityUnavailable = "Reconnect continuity could not be confirmed. Earlier inventory may remain as last known."

    init(
        credentialStore: any DeviceCredentialStoring = DeviceCredentialStore(),
        reconnectKeyStore: (any DeviceReconnectKeyStoring)? = nil,
        api: any DeviceSyncServing = DeviceSyncAPI(),
        browserAuthorizer: (any BrowserPairingAuthorizing)? = nil,
        pairingRequestGenerator: any BrowserPairingRequestGenerating = SystemBrowserPairingRequestGenerator(),
        portalConnectURL: URL = BrowserPairing.configuredConnectURL(),
        callbackScheme: String = BrowserPairing.callbackScheme,
        updateCoordinator: UpdateInstallCoordinator? = nil,
        inventoryScanner: InventoryScanner? = nil,
        inventoryAutomationEnabled: Bool = false
    ) {
        self.credentialStore = credentialStore
        self.reconnectKeyStore = reconnectKeyStore
        self.api = api
        self.browserAuthorizer = browserAuthorizer
        self.pairingRequestGenerator = pairingRequestGenerator
        self.portalConnectURL = portalConnectURL
        self.callbackScheme = callbackScheme
        self.updateCoordinator = updateCoordinator
        self.inventoryScanner = inventoryScanner
        self.inventoryAutomationEnabled = inventoryAutomationEnabled
    }

    @discardableResult
    func restore() -> Task<Void, Never> {
        resetInventoryBaseline()
        if api.reportMode != .legacy {
            connectedCredential = nil
            connectedInfo = nil
        }
        return startAttempt(initialState: .disconnected,
            trackedActivity: api.reportMode == .legacy ? nil : .portalConnection) { model, attemptID in
            do {
                let stored = try await model.credentialStore.load()
                guard model.isCurrent(attemptID) else { return }
                if let stored, stored.connection.expiresAt > Date() {
                    if let reconnectKeyStore = model.reconnectKeyStore {
                        do {
                            let key = try await reconnectKeyStore.loadOrCreate()
                            guard model.isCurrent(attemptID) else { return }
                            try await model.api.bindReconnectKey(credential: stored.credential,
                                reconnectKey: key, expectedDeviceID: stored.connection.deviceID)
                            guard model.isCurrent(attemptID) else { return }
                            model.continuityWarning = nil
                        } catch is CancellationError {
                            return
                        } catch DeviceSyncAPIError.reconnectRequired {
                            guard model.isCurrent(attemptID) else { return }
                            model.continuityWarning = Self.continuityUnavailable
                            await model.rejectCredential(stored, attemptID: attemptID)
                            return
                        } catch {
                            guard model.isCurrent(attemptID) else { return }
                            model.continuityWarning = Self.continuityUnavailable
                            if model.needsReconnect {
                                model.connectedInfo = nil
                                model.connectedCredential = nil
                                model.state = .failed(.reconnectRequired)
                                return
                            }
                        }
                    }
                    guard model.isCurrent(attemptID) else { return }
                    model.needsReconnect = false
                    model.connectedInfo = stored.connection
                    model.state = .connected(stored.connection)
                    if model.api.reportMode != .legacy {
                        model.connectedCredential = stored
                        model.onInventoryConnectionReady?()
                        await model.performInventoryReports(record: stored, attemptID: attemptID)
                    }
                } else if stored != nil {
                    if model.reconnectKeyStore != nil { model.continuityWarning = Self.continuityUnavailable }
                    model.needsReconnect = true
                    model.state = .failed(.reconnectRequired)
                } else {
                    model.state = .disconnected
                }
            } catch is CancellationError {
                return
            } catch {
                guard model.isCurrent(attemptID) else { return }
                model.state = .failed(.credentialStorage)
            }
        }
    }

    @discardableResult
    func connect(
        pairingCode: String,
        deviceName: String,
        installations: [Skill],
        replacingExisting: Bool = false
    ) -> Task<Void, Never> {
        resetInventoryBaseline()
        return startAttempt(initialState: .exchanging, trackedActivity: .portalConnection) { model, attemptID in
            await model.performConnect(
                pairingCode: pairingCode,
                codeVerifier: nil,
                deviceName: deviceName,
                installations: installations,
                replacingExisting: replacingExisting,
                attemptID: attemptID
            )
        }
    }

    @discardableResult
    func connectWithBrowser(
        deviceName: String,
        installations: [Skill],
        replacingExisting: Bool = false
    ) -> Task<Void, Never> {
        resetInventoryBaseline()
        return startAttempt(initialState: .authorizing, trackedActivity: .portalConnection) { model, attemptID in
            await model.performBrowserConnect(
                deviceName: deviceName,
                installations: installations,
                replacingExisting: replacingExisting,
                attemptID: attemptID
            )
        }
    }

    @discardableResult
    func retrySync(installations: [Skill]) -> Task<Void, Never> {
        if api.reportMode != .legacy { return requestInventoryReport() }
        return startAttempt(initialState: .syncing, trackedActivity: .portalConnection) { model, attemptID in
            var attempted: StoredDeviceCredential?
            do {
                guard let stored = try await model.credentialStore.load() else {
                    guard model.isCurrent(attemptID) else { return }
                    model.state = .failed(.reconnectRequired)
                    return
                }
                guard model.isCurrent(attemptID) else { return }
                attempted = stored
                _ = try await model.api.upload(
                    credential: stored.credential,
                    installations: installations
                )
                guard model.isCurrent(attemptID) else { return }
                model.connectedInfo = stored.connection
                model.state = .connected(stored.connection)
            } catch is CancellationError {
                return
            } catch DeviceSyncAPIError.reconnectRequired {
                guard model.isCurrent(attemptID) else { return }
                if let attempted { await model.rejectCredential(attempted, attemptID: attemptID) }
            } catch {
                guard model.isCurrent(attemptID) else { return }
                model.state = .failed(.sync(error.localizedDescription))
            }
        }
    }

    @discardableResult
    func requestInventoryReport() -> Task<Void, Never> {
        requestInventoryReport(forceFull: true)
    }

    func requireFullInventoryReport() {
        guard connectedCredential != nil else { return }
        forceFullReportRequested = true
    }

    private func requestInventoryReport(forceFull: Bool) -> Task<Void, Never> {
        guard api.reportMode != .legacy else { return Task {} }
        if let activeTask, !activeTask.isCancelled {
            if connectedCredential != nil || state == .authorizing || state == .exchanging || state == .storingCredential {
                forceFullReportRequested = forceFullReportRequested || forceFull
                reportRequested = true
                if reportStatus != .reporting { reportStatus = .pending }
            }
            return activeTask
        }
        guard let record = connectedCredential, case .connected = state else { return Task {} }
        forceFullReportRequested = forceFullReportRequested || forceFull
        return startAttempt(initialState: .connected(record.connection), trackedActivity: .portalConnection) { model, attemptID in
            await model.performInventoryReports(record: record, attemptID: attemptID)
        }
    }

    // Not wired to app lifecycle yet. Reuse the same fresh, serialized reporting path.
    func requestScheduledInventoryReport() async -> InventoryReportOutcome {
        guard !Task.isCancelled, api.reportMode != .legacy,
              let record = connectedCredential, case .connected = state else { return .cancelled }
        let ownsReport = activeTask == nil || activeTask?.isCancelled == true
        let task = requestInventoryReport(forceFull: false)
        let attemptID = activeAttemptID
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            guard ownsReport else { return }
            Task { @MainActor [weak self] in
                guard let self, let attemptID, activeAttemptID == attemptID,
                      connectedCredential == record else { return }
                cancelCurrentOperation()
            }
        }
        guard !Task.isCancelled, let attemptID, lastReportAttemptID == attemptID else { return .cancelled }
        if lastReportOutcome == .reconnectRequired { return .reconnectRequired }
        guard connectedCredential == record else { return .cancelled }
        return lastReportOutcome ?? .cancelled
    }

    @discardableResult
    func disconnect() -> Task<Void, Never> {
        resetInventoryBaseline()
        lastReportOutcome = .cancelled
        connectedCredential = nil
        connectedInfo = nil
        reportRequested = false
        reportStatus = .idle
        let previousTask = activeTask
        activeAttemptID = nil
        browserAuthorizer?.cancel()
        previousTask?.cancel()
        let attemptID = UUID()
        activeAttemptID = attemptID
        stateAttemptID = attemptID
        disconnectWarning = nil
        let activity = updateCoordinator?.beginActivity(.portalConnection)

        let task = Task { @MainActor [weak self] in
            defer { activity?.finish() }
            guard let self else { return }
            await previousTask?.value
            guard isCurrent(attemptID) else { return }
            var remoteRevocationFailed = false
            var bindingFailed = false
            var localDeletionFailed = false
            var hadCredential = false
            do {
                if let stored = try await credentialStore.load() {
                    guard isCurrent(attemptID) else { return }
                    hadCredential = true
                    // Finish captured-record cleanup even if the caller cancels.
                    let cleanup = Task { [credentialStore, reconnectKeyStore, api] in
                        var bindingFailed = false
                        var revocationFailed = false
                        var deletionFailed = false
                        if let reconnectKeyStore {
                            do {
                                let key = try await reconnectKeyStore.loadOrCreate()
                                guard stored.connection.expiresAt > Date() else {
                                    throw DeviceSyncAPIError.reconnectRequired
                                }
                                try await api.bindReconnectKey(credential: stored.credential,
                                    reconnectKey: key, expectedDeviceID: stored.connection.deviceID)
                            } catch { bindingFailed = true }
                        }
                        do { try await api.revoke(credential: stored.credential) }
                        catch { revocationFailed = true }
                        do { _ = try await credentialStore.delete(ifMatching: stored) }
                        catch { deletionFailed = true }
                        return (bindingFailed, revocationFailed, deletionFailed)
                    }
                    (bindingFailed, remoteRevocationFailed, localDeletionFailed) = await cleanup.value
                }
            } catch {
                if stateAttemptID == attemptID {
                    needsReconnect = true
                    state = .failed(.credentialStorage)
                }
                return
            }
            guard stateAttemptID == attemptID else { return }
            if reconnectKeyStore != nil, hadCredential {
                continuityWarning = bindingFailed ? Self.continuityUnavailable : nil
            }
            disconnectWarning = remoteRevocationFailed
                ? (localDeletionFailed ? "Remote revocation could not be confirmed."
                    : "This Mac was disconnected locally. Revoke it from the web portal when you are online.")
                : nil
            needsReconnect = localDeletionFailed
            state = localDeletionFailed ? .failed(.credentialStorage) : .disconnected
            reportStatus = .idle
            finish(attemptID)
        }
        activeTask = task
        return task
    }

    func cancelCurrentOperation() {
        resetInventoryBaseline()
        lastReportAttemptID = activeAttemptID
        lastReportOutcome = .cancelled
        reportRequested = false
        reportStatus = reconciliationUploadInFlight
            ? .uncertain("The submitted report may have completed.") : .idle
        reconciliationUploadInFlight = false
        activeAttemptID = nil
        browserAuthorizer?.cancel()
        activeTask?.cancel()
        state = neutralState()
    }

    func cancelAndAwaitCurrentOperation() async {
        let pending = activeTask
        cancelCurrentOperation()
        await pending?.value
    }

    private func performConnect(
        pairingCode: String,
        codeVerifier: String?,
        deviceName: String,
        installations: [Skill],
        replacingExisting: Bool,
        attemptID: UUID
    ) async {
        var exchanged: StoredDeviceCredential?
        var credentialStored = false
        var superseded: StoredDeviceCredential?
        var keyedExchangeStarted = false
        do {
            let existing = try await credentialStore.load()
            guard isCurrent(attemptID) else { return }
            if existing != nil, !replacingExisting {
                state = .failed(.replacementRequired)
                finish(attemptID)
                return
            }

            let record: StoredDeviceCredential
            if let reconnectKeyStore {
                let key: String
                do { key = try await reconnectKeyStore.loadOrCreate() }
                catch is CancellationError { throw CancellationError() }
                catch {
                    guard isCurrent(attemptID) else { return }
                    preserveBeforeExchange(existing, failure: .credentialStorage)
                    finish(attemptID)
                    return
                }
                guard isCurrent(attemptID) else { return }
                var bound = false
                if let existing, existing.connection.expiresAt > Date() {
                    do {
                        try await api.bindReconnectKey(credential: existing.credential,
                            reconnectKey: key, expectedDeviceID: existing.connection.deviceID)
                        guard isCurrent(attemptID) else { return }
                        bound = true
                    } catch is CancellationError { throw CancellationError() }
                    catch DeviceSyncAPIError.reconnectRequired {
                        guard isCurrent(attemptID) else { return }
                    } catch {
                        guard isCurrent(attemptID) else { return }
                        preserveBeforeExchange(existing, failure: .exchange(Self.continuityUnavailable))
                        finish(attemptID)
                        return
                    }
                }
                guard isCurrent(attemptID) else { return }
                if existing != nil { continuityWarning = bound ? nil : Self.continuityUnavailable }
                superseded = existing
                keyedExchangeStarted = true
                needsReconnect = true
                connectedInfo = nil
                connectedCredential = nil
                let result = try await api.exchangeForReconnect(pairingCode: pairingCode,
                    deviceName: deviceName, codeVerifier: codeVerifier, reconnectKey: key)
                exchanged = result.record
                guard isCurrent(attemptID) else { throw CancellationError() }
                guard result.support == .supported else { throw DeviceSyncAPIError.unsupportedReconnect }
                record = result.record
                if bound, existing?.connection.deviceID != record.connection.deviceID {
                    continuityWarning = Self.continuityUnavailable
                }
            } else {
                record = try await api.exchange(pairingCode: pairingCode,
                    deviceName: deviceName, codeVerifier: codeVerifier)
            }
            exchanged = record
            guard isCurrent(attemptID) else {
                await cleanup(record, credentialStored: false, attemptID: attemptID)
                return
            }

            state = .storingCredential
            do {
                // Exact cleanup also covers a save that commits before throwing.
                if keyedExchangeStarted { credentialStored = true }
                try await credentialStore.save(record, replacingExisting: replacingExisting)
            } catch DeviceCredentialStoreError.replacementRequired {
                if keyedExchangeStarted { throw DeviceCredentialStoreError.replacementRequired }
                await cleanup(record, credentialStored: false, attemptID: attemptID)
                guard isCurrent(attemptID) else { return }
                state = .failed(.replacementRequired)
                finish(attemptID)
                return
            } catch {
                if keyedExchangeStarted { throw DeviceCredentialStoreError.corruptItem }
                await cleanup(record, credentialStored: false, attemptID: attemptID)
                guard isCurrent(attemptID) else { return }
                state = .failed(.credentialStorage)
                finish(attemptID)
                return
            }
            credentialStored = true
            guard isCurrent(attemptID) else {
                if keyedExchangeStarted { throw CancellationError() }
                await cleanup(record, credentialStored: true, attemptID: attemptID)
                return
            }

            if api.reportMode != .legacy {
                needsReconnect = false
                keyedExchangeStarted = false
                connectedInfo = record.connection
                connectedCredential = record
                state = .connected(record.connection)
                onInventoryConnectionReady?()
                await performInventoryReports(record: record, attemptID: attemptID)
                finish(attemptID)
                return
            }

            state = .syncing
            _ = try await api.upload(
                credential: record.credential,
                installations: installations
            )
            guard isCurrent(attemptID) else {
                if keyedExchangeStarted { throw CancellationError() }
                await cleanup(record, credentialStored: true, attemptID: attemptID)
                return
            }
            connectedInfo = record.connection
            needsReconnect = false
            state = .connected(record.connection)
            finish(attemptID)
        } catch is CancellationError {
            if keyedExchangeStarted {
                await failKeyedExchange(issued: exchanged, stored: credentialStored,
                    superseded: superseded, attemptID: attemptID, storageFailure: false)
                return
            }
            if let exchanged {
                await cleanup(exchanged, credentialStored: credentialStored, attemptID: attemptID)
            }
        } catch DeviceSyncAPIError.reconnectRequired {
            if keyedExchangeStarted {
                await failKeyedExchange(issued: exchanged, stored: credentialStored,
                    superseded: superseded, attemptID: attemptID, storageFailure: false)
                return
            }
            var deleted = true
            if let exchanged {
                deleted = await cleanup(exchanged, credentialStored: credentialStored, attemptID: attemptID)
            }
            guard isCurrent(attemptID) else { return }
            connectedInfo = nil
            needsReconnect = true
            state = .failed(deleted ? .reconnectRequired : .credentialStorage)
            finish(attemptID)
        } catch {
            if keyedExchangeStarted {
                await failKeyedExchange(issued: exchanged, stored: credentialStored,
                    superseded: superseded, attemptID: attemptID,
                    storageFailure: error is DeviceCredentialStoreError)
                return
            }
            guard isCurrent(attemptID) else {
                if let exchanged {
                    await cleanup(exchanged, credentialStored: credentialStored, attemptID: attemptID)
                }
                return
            }
            if exchanged == nil {
                state = .failed(.exchange(error.localizedDescription))
            } else {
                state = .failed(.sync(error.localizedDescription))
            }
            finish(attemptID)
        }
    }

    private func performBrowserConnect(
        deviceName: String,
        installations: [Skill],
        replacingExisting: Bool,
        attemptID: UUID
    ) async {
        do {
            let existing = try await credentialStore.load()
            guard isCurrent(attemptID) else { return }
            if existing != nil, !replacingExisting {
                state = .failed(.replacementRequired)
                finish(attemptID)
                return
            }
            guard let browserAuthorizer else {
                throw BrowserPairingError.unavailable
            }

            let request = try pairingRequestGenerator.makeRequest()
            let authorizationURL = try BrowserPairing.authorizationURL(
                connectURL: portalConnectURL,
                request: request
            )
            let callbackURL = try await browserAuthorizer.authorize(
                url: authorizationURL,
                callbackScheme: callbackScheme
            )
            guard isCurrent(attemptID) else { return }
            switch try BrowserPairing.parseCallback(callbackURL, expectedState: request.state, callbackScheme: callbackScheme) {
            case .cancelled:
                state = neutralState()
                finish(attemptID)
            case .approved(let pairingCode):
                state = .exchanging
                await performConnect(
                    pairingCode: pairingCode,
                    codeVerifier: request.codeVerifier,
                    deviceName: deviceName,
                    installations: installations,
                    replacingExisting: replacingExisting,
                    attemptID: attemptID
                )
            }
        } catch is CancellationError {
            guard isCurrent(attemptID) else { return }
            state = neutralState()
            finish(attemptID)
        } catch {
            guard isCurrent(attemptID) else { return }
            state = .failed(.authorization(error.localizedDescription))
            finish(attemptID)
        }
    }

    @discardableResult
    private func startAttempt(
        initialState: State,
        trackedActivity: UpdateInstallCoordinator.Activity? = nil,
        operation: @escaping @MainActor (DeviceConnectionModel, UUID) async -> Void
    ) -> Task<Void, Never> {
        let previousTask = activeTask
        if previousTask != nil { inventoryBaseline = nil }
        activeAttemptID = nil
        browserAuthorizer?.cancel()
        previousTask?.cancel()
        let attemptID = UUID()
        activeAttemptID = attemptID
        stateAttemptID = attemptID
        reportRequested = false
        reportStatus = .idle
        lastReportOutcome = nil
        lastReportAttemptID = nil
        reconciliationUploadInFlight = false
        state = initialState
        disconnectWarning = nil
        let activity = trackedActivity.flatMap { updateCoordinator?.beginActivity($0) }
        let task = Task { @MainActor [weak self] in
            defer { activity?.finish() }
            guard let self else { return }
            await previousTask?.value
            guard self.isCurrent(attemptID) else { return }
            await operation(self, attemptID)
            if self.isCurrent(attemptID) {
                self.finish(attemptID)
            }
        }
        activeTask = task
        return task
    }

    private func performInventoryReports(record: StoredDeviceCredential, attemptID: UUID) async {
        repeat {
            reportRequested = false
            let forceFull = forceFullReportRequested
            forceFullReportRequested = false
            reportStatus = .reporting
            var submitted = false
            defer { if isCurrent(attemptID) { reconciliationUploadInFlight = false } }
            do {
                guard let inventoryScanner else { throw PresenceSyncError.missingScanner }
                var revision: String?
                if api.reportMode == .reconciliation {
                    revision = try await api.inventoryRevision(credential: record.credential)
                    try Task.checkCancellation()
                    guard isCurrent(attemptID), connectedCredential == record else { return }
                }
                let scan = try await inventoryScanner()
                try Task.checkCancellation()
                guard isCurrent(attemptID), connectedCredential == record else { return }
                let result: SkillSyncResult
                if api.reportMode == .reconciliation {
                    let payload = try SkillSyncService.reconciliationPayload(baseRevision: revision, scan: scan)
                    reconciliationUploadInFlight = true
                    submitted = true
                    if inventoryAutomationEnabled, !forceFull, scan.issues.isEmpty,
                       payload.roots.allSatisfy({ $0.state == .complete }),
                       let baseline = inventoryBaseline, baseline.credential == record,
                       revision == baseline.result.revision?.lowercased(),
                       payload.hasSameInventory(as: baseline.payload), let revision {
                        let check = try InventoryCheckPayload(baseRevision: revision)
                        let checked = try await api.checkInventory(credential: record.credential, payload: check)
                        try Task.checkCancellation()
                        guard isCurrent(attemptID), connectedCredential == record else { return }
                        try checked.validate(check, deviceID: record.connection.deviceID)
                        lastInventoryCheckedAt = checked.checkedDate
                        reportStatus = .reported(baseline.result, scanIssueCount: 0)
                        lastReportOutcome = .checked
                        lastReportAttemptID = attemptID
                        continue
                    }
                    result = try await api.reconcile(credential: record.credential, payload: payload)
                    try Task.checkCancellation()
                    guard isCurrent(attemptID), connectedCredential == record else { return }
                    try result.validateReconciliation(payload, deviceID: record.connection.deviceID)
                    if inventoryAutomationEnabled {
                        lastInventoryCheckedAt = result.reportedAt
                        inventoryBaseline = scan.issues.isEmpty && result.complete == true
                            ? InventoryBaseline(payload: payload, result: result, credential: record) : nil
                    }
                } else {
                    result = try await api.upload(credential: record.credential, installations: scan.installations)
                    try Task.checkCancellation()
                    guard isCurrent(attemptID), connectedCredential == record else { return }
                    guard result.reportVersion == 2, result.mode == "presence",
                          result.deviceId == record.connection.deviceID, result.reportedAt != nil else {
                        throw DeviceSyncAPIError.invalidResponse
                    }
                }
                reportStatus = .reported(result, scanIssueCount: scan.issues.count)
                lastReportOutcome = .reported(partial: !scan.issues.isEmpty || result.complete == false)
                lastReportAttemptID = attemptID
            } catch is CancellationError {
                if activeAttemptID == attemptID, connectedCredential == record {
                    inventoryBaseline = nil
                    lastReportOutcome = .cancelled
                    lastReportAttemptID = attemptID
                    reportStatus = submitted ? .uncertain("The submitted report may have completed.") : .pending
                    reportRequested = false
                }
                return
            } catch DeviceSyncAPIError.reconnectRequired {
                guard isCurrent(attemptID), connectedCredential == record else { return }
                resetInventoryBaseline()
                await rejectCredential(record, attemptID: attemptID)
                guard isCurrent(attemptID) else { return }
                reportStatus = .idle
                lastReportOutcome = .reconnectRequired
                lastReportAttemptID = attemptID
                reportRequested = false
                return
            } catch DeviceSyncAPIError.inventoryChanged {
                guard isCurrent(attemptID), connectedCredential == record else { return }
                inventoryBaseline = nil
                reportStatus = .failed(DeviceSyncAPIError.inventoryChanged.localizedDescription)
                lastReportOutcome = .revisionConflict
                lastReportAttemptID = attemptID
                reportRequested = false
                return
            } catch {
                guard isCurrent(attemptID), connectedCredential == record else { return }
                inventoryBaseline = nil
                reportStatus = submitted ? .uncertain(error.localizedDescription) : .failed(error.localizedDescription)
                lastReportOutcome = InventoryReportOutcome.failure(error)
                lastReportAttemptID = attemptID
                reportRequested = false
                return
            }
        } while reportRequested && isCurrent(attemptID)
    }

    private func resetInventoryBaseline() {
        inventoryBaseline = nil
        lastInventoryCheckedAt = nil
        forceFullReportRequested = false
    }

    @discardableResult
    private func cleanup(
        _ record: StoredDeviceCredential,
        credentialStored: Bool,
        attemptID: UUID
    ) async -> Bool {
        // Cleanup must outlive cancellation; URLSession otherwise cancels the revocation immediately.
        let cleanup = Task { [credentialStore, api] in
            var deleted = true
            if credentialStored {
                do { _ = try await credentialStore.delete(ifMatching: record) }
                catch { deleted = false }
            }
            try? await api.revoke(credential: record.credential)
            return deleted
        }
        let deleted = await cleanup.value
        if !deleted, stateAttemptID == attemptID {
            connectedInfo = nil
            connectedCredential = nil
            resetInventoryBaseline()
            needsReconnect = true
            state = .failed(.credentialStorage)
        }
        return deleted
    }

    private func preserveBeforeExchange(_ existing: StoredDeviceCredential?, failure: DeviceConnectionFailure) {
        continuityWarning = Self.continuityUnavailable
        if let existing, existing.connection.expiresAt > Date(), !needsReconnect {
            needsReconnect = false
            connectedInfo = existing.connection
            connectedCredential = api.reportMode == .legacy ? nil : existing
            state = .connected(existing.connection)
        } else {
            connectedInfo = nil
            connectedCredential = nil
            state = .failed(failure)
        }
    }

    private func failKeyedExchange(issued: StoredDeviceCredential?, stored: Bool,
                                   superseded: StoredDeviceCredential?, attemptID: UUID,
                                   storageFailure: Bool) async {
        var deleted = true
        if let issued { deleted = await cleanup(issued, credentialStored: stored, attemptID: attemptID) }
        if let superseded {
            let oldDeleted = await cleanup(superseded, credentialStored: true, attemptID: attemptID)
            deleted = oldDeleted && deleted
        }
        guard stateAttemptID == attemptID else { return }
        connectedCredential = nil
        connectedInfo = nil
        resetInventoryBaseline()
        needsReconnect = true
        continuityWarning = Self.continuityUnavailable
        state = .failed(storageFailure || !deleted ? .credentialStorage : .reconnectRequired)
        finish(attemptID)
    }

    private func rejectCredential(_ record: StoredDeviceCredential, attemptID: UUID) async {
        resetInventoryBaseline()
        connectedCredential = nil
        connectedInfo = nil
        needsReconnect = true
        var deleted = true
        do { _ = try await credentialStore.delete(ifMatching: record) }
        catch { deleted = false }
        guard stateAttemptID == attemptID else { return }
        state = .failed(deleted ? .reconnectRequired : .credentialStorage)
    }

    private func isCurrent(_ attemptID: UUID) -> Bool {
        activeAttemptID == attemptID && !Task.isCancelled
    }

    private func neutralState() -> State {
        if needsReconnect {
            return state == .failed(.credentialStorage) ? state : .failed(.reconnectRequired)
        }
        if let connectedInfo {
            return .connected(connectedInfo)
        }
        return .disconnected
    }

    private func finish(_ attemptID: UUID) {
        guard activeAttemptID == attemptID else { return }
        reportRequested = false
        if reportStatus == .pending {
            switch state {
            case .connected: break
            default: reportStatus = .idle
            }
        }
        activeAttemptID = nil
        activeTask = nil
    }
}
