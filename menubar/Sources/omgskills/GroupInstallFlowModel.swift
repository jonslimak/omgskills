import Foundation
import Observation

struct GroupInstallPresentationContext: Identifiable, Sendable {
    let id = UUID()
    let manifest: GroupManifest
    let route: DeviceGroupManifestRoute
    let credential: StoredDeviceCredential
}

struct GroupInstallFlowFailure: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case reconnectRequired
        case contentReadRequired
        case unavailable
        case temporarilyUnavailable
    }

    let kind: Kind
    let message: String

    var canRetry: Bool {
        switch kind {
        case .reconnectRequired, .contentReadRequired:
            false
        case .unavailable, .temporarilyUnavailable:
            true
        }
    }
}

@MainActor
@Observable
final class GroupInstallFlowModel {
    enum Phase: Equatable, Sendable {
        case idle
        case loading
        case ready
        case failure(GroupInstallFlowFailure)
    }

    private(set) var phase: Phase = .idle
    private(set) var presentationContext: GroupInstallPresentationContext?
    var isPresented = false

    @ObservationIgnored private let credentialStore: any DeviceCredentialStoring
    @ObservationIgnored private let manifestAPI: any DeviceGroupManifestServing
    @ObservationIgnored private var activeTask: Task<Void, Never>?
    @ObservationIgnored private var activeAttemptID: UUID?
    @ObservationIgnored private var currentRoute: DeviceGroupManifestRoute?

    init(
        credentialStore: any DeviceCredentialStoring,
        manifestAPI: any DeviceGroupManifestServing = DeviceGroupManifestAPI()
    ) {
        self.credentialStore = credentialStore
        self.manifestAPI = manifestAPI
    }

    @discardableResult
    func open(_ route: DeviceGroupManifestRoute) -> Task<Void, Never> {
        activeTask?.cancel()
        let attemptID = UUID()
        activeAttemptID = attemptID
        currentRoute = route
        presentationContext = nil
        phase = .loading
        isPresented = true

        let credentialStore = credentialStore
        let manifestAPI = manifestAPI
        let task = Task { @MainActor [weak self] in
            do {
                guard let credential = try await credentialStore.load() else {
                    throw GroupInstallFlowFailure(
                        kind: .reconnectRequired,
                        message: "Connect this Mac to omgskills before installing a Skill Group."
                    )
                }
                try Task.checkCancellation()
                let manifest = try await manifestAPI.fetchManifest(
                    route: route,
                    credential: credential
                )
                try Task.checkCancellation()
                guard self?.activeAttemptID == attemptID else { return }
                self?.presentationContext = GroupInstallPresentationContext(
                    manifest: manifest,
                    route: route,
                    credential: credential
                )
                self?.phase = .ready
            } catch is CancellationError {
                return
            } catch let failure as GroupInstallFlowFailure {
                guard self?.activeAttemptID == attemptID else { return }
                self?.phase = .failure(failure)
            } catch {
                guard self?.activeAttemptID == attemptID else { return }
                self?.phase = .failure(Self.failure(for: error))
            }
            if self?.activeAttemptID == attemptID {
                self?.activeTask = nil
            }
        }
        activeTask = task
        return task
    }

    @discardableResult
    func retry() -> Task<Void, Never>? {
        guard case .failure(let failure) = phase,
              failure.canRetry,
              let currentRoute else { return nil }
        return open(currentRoute)
    }

    func dismiss() {
        activeTask?.cancel()
        activeTask = nil
        activeAttemptID = nil
        currentRoute = nil
        presentationContext = nil
        phase = .idle
        isPresented = false
    }

    private static func failure(for error: Error) -> GroupInstallFlowFailure {
        if let apiError = error as? DeviceGroupManifestAPIError {
            switch apiError {
            case .reconnectRequired:
                return .init(kind: .reconnectRequired, message: apiError.localizedDescription)
            case .contentReadRequired:
                return .init(kind: .contentReadRequired, message: apiError.localizedDescription)
            case .groupUnavailable:
                return .init(kind: .unavailable, message: apiError.localizedDescription)
            case .rateLimited, .temporarilyUnavailable, .server,
                 .invalidConfiguration, .responseTooLarge, .invalidResponse:
                return .init(kind: .temporarilyUnavailable, message: apiError.localizedDescription)
            }
        }
        return .init(
            kind: .temporarilyUnavailable,
            message: "The Skill Group could not be loaded. Try again shortly."
        )
    }
}

extension GroupInstallFlowFailure: Error {}
