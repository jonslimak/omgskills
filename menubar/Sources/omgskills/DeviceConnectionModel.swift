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
    private(set) var reportStatus: ReportStatus = .idle
    private(set) var lastReportOutcome: InventoryReportOutcome?
    private(set) var lastInventoryCheckedAt: Date?

    @ObservationIgnored private let credentialStore: any DeviceCredentialStoring
    @ObservationIgnored private let api: any DeviceSyncServing
    @ObservationIgnored private let browserAuthorizer: (any BrowserPairingAuthorizing)?
    @ObservationIgnored private let pairingRequestGenerator: any BrowserPairingRequestGenerating
    @ObservationIgnored private let portalConnectURL: URL
    @ObservationIgnored private let callbackScheme: String
    @ObservationIgnored private let updateCoordinator: UpdateInstallCoordinator?
    @ObservationIgnored private var activeTask: Task<Void, Never>?
    @ObservationIgnored private var activeAttemptID: UUID?
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

    init(
        credentialStore: any DeviceCredentialStoring = DeviceCredentialStore(),
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
        return startAttempt(initialState: .disconnected) { model, attemptID in
            do {
                let stored = try await model.credentialStore.load()
                guard model.isCurrent(attemptID) else { return }
                if let stored, stored.connection.expiresAt > Date() {
                    model.connectedInfo = stored.connection
                    model.state = .connected(stored.connection)
                    if model.api.reportMode != .legacy {
                        model.connectedCredential = stored
                        await model.performInventoryReports(record: stored, attemptID: attemptID)
                    }
                } else if stored != nil {
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
            do {
                guard let stored = try await model.credentialStore.load() else {
                    guard model.isCurrent(attemptID) else { return }
                    model.state = .failed(.reconnectRequired)
                    return
                }
                guard model.isCurrent(attemptID) else { return }
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
                if let stored = try? await model.credentialStore.load() {
                    try? await model.credentialStore.delete(deviceID: stored.connection.deviceID)
                }
                guard model.isCurrent(attemptID) else { return }
                model.connectedInfo = nil
                model.state = .failed(.reconnectRequired)
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
        reportRequested = false
        reportStatus = .idle
        let previousTask = activeTask
        activeAttemptID = nil
        browserAuthorizer?.cancel()
        previousTask?.cancel()
        let attemptID = UUID()
        activeAttemptID = attemptID
        disconnectWarning = nil
        let activity = updateCoordinator?.beginActivity(.portalConnection)

        let task = Task { @MainActor [weak self] in
            defer { activity?.finish() }
            guard let self else { return }
            await previousTask?.value
            guard isCurrent(attemptID) else { return }
            var remoteRevocationFailed = false
            do {
                if let stored = try await credentialStore.load() {
                    do {
                        try await api.revoke(credential: stored.credential)
                    } catch {
                        remoteRevocationFailed = true
                    }
                    try await credentialStore.delete(deviceID: stored.connection.deviceID)
                }
            } catch {
                if isCurrent(attemptID) {
                    state = .failed(.credentialStorage)
                }
                return
            }
            guard isCurrent(attemptID) else { return }
            disconnectWarning = remoteRevocationFailed
                ? "This Mac was disconnected locally. Revoke it from the web portal when you are online."
                : nil
            connectedInfo = nil
            state = .disconnected
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
        if let connectedInfo {
            state = .connected(connectedInfo)
        } else {
            state = .disconnected
        }
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
        do {
            let existing = try await credentialStore.load()
            guard isCurrent(attemptID) else { return }
            if existing != nil, !replacingExisting {
                state = .failed(.replacementRequired)
                finish(attemptID)
                return
            }

            let record = try await api.exchange(
                pairingCode: pairingCode,
                deviceName: deviceName,
                codeVerifier: codeVerifier
            )
            exchanged = record
            guard isCurrent(attemptID) else {
                await cleanup(record, credentialStored: false)
                return
            }

            state = .storingCredential
            do {
                try await credentialStore.save(record, replacingExisting: replacingExisting)
            } catch DeviceCredentialStoreError.replacementRequired {
                await cleanup(record, credentialStored: false)
                guard isCurrent(attemptID) else { return }
                state = .failed(.replacementRequired)
                finish(attemptID)
                return
            } catch {
                await cleanup(record, credentialStored: false)
                guard isCurrent(attemptID) else { return }
                state = .failed(.credentialStorage)
                finish(attemptID)
                return
            }
            credentialStored = true
            guard isCurrent(attemptID) else {
                await cleanup(record, credentialStored: true)
                return
            }

            if api.reportMode != .legacy {
                connectedInfo = record.connection
                connectedCredential = record
                state = .connected(record.connection)
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
                await cleanup(record, credentialStored: true)
                return
            }
            connectedInfo = record.connection
            state = .connected(record.connection)
            finish(attemptID)
        } catch is CancellationError {
            if let exchanged {
                await cleanup(exchanged, credentialStored: credentialStored)
            }
        } catch DeviceSyncAPIError.reconnectRequired {
            if let exchanged {
                await cleanup(exchanged, credentialStored: credentialStored)
            }
            guard isCurrent(attemptID) else { return }
            connectedInfo = nil
            state = .failed(.reconnectRequired)
            finish(attemptID)
        } catch {
            guard isCurrent(attemptID) else {
                if let exchanged {
                    await cleanup(exchanged, credentialStored: credentialStored)
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
                try? await credentialStore.delete(deviceID: record.connection.deviceID)
                guard isCurrent(attemptID), connectedCredential == record else { return }
                connectedCredential = nil
                connectedInfo = nil
                state = .failed(.reconnectRequired)
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

    private func cleanup(
        _ record: StoredDeviceCredential,
        credentialStored: Bool
    ) async {
        // Cleanup must outlive cancellation; URLSession otherwise cancels the revocation immediately.
        let cleanup = Task { [credentialStore, api] in
            if credentialStored {
                try? await credentialStore.delete(deviceID: record.connection.deviceID)
            }
            try? await api.revoke(credential: record.credential)
        }
        await cleanup.value
    }

    private func isCurrent(_ attemptID: UUID) -> Bool {
        activeAttemptID == attemptID && !Task.isCancelled
    }

    private func neutralState() -> State {
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
