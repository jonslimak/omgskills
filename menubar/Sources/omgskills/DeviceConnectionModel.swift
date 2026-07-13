import Foundation
import Observation

enum DeviceConnectionFailure: Equatable, Sendable {
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
        case exchanging
        case storingCredential
        case syncing
        case connected(DeviceConnectionInfo)
        case failed(DeviceConnectionFailure)
    }

    private(set) var state: State = .disconnected
    private(set) var disconnectWarning: String?

    @ObservationIgnored private let credentialStore: any DeviceCredentialStoring
    @ObservationIgnored private let api: any DeviceSyncServing
    @ObservationIgnored private var activeTask: Task<Void, Never>?
    @ObservationIgnored private var activeAttemptID: UUID?
    @ObservationIgnored private var connectedInfo: DeviceConnectionInfo?

    init(
        credentialStore: any DeviceCredentialStoring = DeviceCredentialStore(),
        api: any DeviceSyncServing = DeviceSyncAPI()
    ) {
        self.credentialStore = credentialStore
        self.api = api
    }

    @discardableResult
    func restore() -> Task<Void, Never> {
        startAttempt(initialState: .disconnected) { model, attemptID in
            do {
                let stored = try await model.credentialStore.load()
                guard model.isCurrent(attemptID) else { return }
                if let stored, stored.connection.expiresAt > Date() {
                    model.connectedInfo = stored.connection
                    model.state = .connected(stored.connection)
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
        startAttempt(initialState: .exchanging) { model, attemptID in
            await model.performConnect(
                pairingCode: pairingCode,
                deviceName: deviceName,
                installations: installations,
                replacingExisting: replacingExisting,
                attemptID: attemptID
            )
        }
    }

    @discardableResult
    func retrySync(installations: [Skill]) -> Task<Void, Never> {
        startAttempt(initialState: .syncing) { model, attemptID in
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
    func disconnect() -> Task<Void, Never> {
        let previousTask = activeTask
        activeAttemptID = nil
        previousTask?.cancel()
        let attemptID = UUID()
        activeAttemptID = attemptID
        disconnectWarning = nil

        let task = Task { @MainActor [weak self] in
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
            finish(attemptID)
        }
        activeTask = task
        return task
    }

    func cancelCurrentOperation() {
        activeAttemptID = nil
        activeTask?.cancel()
        if let connectedInfo {
            state = .connected(connectedInfo)
        } else {
            state = .disconnected
        }
    }

    private func performConnect(
        pairingCode: String,
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
                codeVerifier: nil
            )
            exchanged = record
            guard isCurrent(attemptID) else {
                try? await api.revoke(credential: record.credential)
                return
            }

            state = .storingCredential
            do {
                try await credentialStore.save(record, replacingExisting: replacingExisting)
            } catch DeviceCredentialStoreError.replacementRequired {
                try? await api.revoke(credential: record.credential)
                guard isCurrent(attemptID) else { return }
                state = .failed(.replacementRequired)
                finish(attemptID)
                return
            } catch {
                try? await api.revoke(credential: record.credential)
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

    @discardableResult
    private func startAttempt(
        initialState: State,
        operation: @escaping @MainActor (DeviceConnectionModel, UUID) async -> Void
    ) -> Task<Void, Never> {
        let previousTask = activeTask
        activeAttemptID = nil
        previousTask?.cancel()
        let attemptID = UUID()
        activeAttemptID = attemptID
        state = initialState
        disconnectWarning = nil
        let task = Task { @MainActor [weak self] in
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

    private func cleanup(
        _ record: StoredDeviceCredential,
        credentialStored: Bool
    ) async {
        if credentialStored {
            try? await credentialStore.delete(deviceID: record.connection.deviceID)
        }
        try? await api.revoke(credential: record.credential)
    }

    private func isCurrent(_ attemptID: UUID) -> Bool {
        activeAttemptID == attemptID && !Task.isCancelled
    }

    private func finish(_ attemptID: UUID) {
        guard activeAttemptID == attemptID else { return }
        activeAttemptID = nil
        activeTask = nil
    }
}
