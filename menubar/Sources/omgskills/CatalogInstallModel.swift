#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import Foundation
import Observation

protocol CatalogInstallFlowServing: Sendable {
    func fetch(id: String) async throws -> CatalogInstallRecord?
    func destination(for record: CatalogInstallRecord, target: SkillInstaller.Target) async throws -> URL
    func install(_ record: CatalogInstallRecord, target: SkillInstaller.Target) async -> CatalogInstallService.Result
}

struct CatalogInstallFlowService: CatalogInstallFlowServing {
    let records: CatalogInstallRecordClient
    let installer: CatalogInstallService

    func fetch(id: String) async throws -> CatalogInstallRecord? { try await records.fetch(id: id) }
    func destination(for record: CatalogInstallRecord, target: SkillInstaller.Target) async throws -> URL {
        try await installer.destination(for: record.skill, target: target)
    }
    func install(_ record: CatalogInstallRecord, target: SkillInstaller.Target) async -> CatalogInstallService.Result {
        await installer.install(record.skill, target: target)
    }
}

@MainActor @Observable
final class CatalogInstallModel {
    enum Phase: Equatable { case idle, loading, confirm, rechecking, installing, cancelling, result }
    private(set) var phase: Phase = .idle
    private(set) var record: CatalogInstallRecord?
    private(set) var destination: URL?
    private(set) var request: CatalogInstallRequest?
    private(set) var result: CatalogInstallService.Result?
    private(set) var message = "Ready"
    private(set) var notice = ""
    private(set) var appUpdateActive = false
    let client: CatalogInstallRequest.Client
    let appName: String
    @ObservationIgnored var onInstalled: @MainActor () -> Void
    @ObservationIgnored private let track: ConnectedAppEvent.Track
    @ObservationIgnored private let service: any CatalogInstallFlowServing
    @ObservationIgnored private let coordinator: UpdateInstallCoordinator
    @ObservationIgnored private var activity: UpdateInstallCoordinator.ActivityToken?
    @ObservationIgnored private var operationID: UUID?
    @ObservationIgnored private(set) var operation: Task<Void, Never>?

    init(service: any CatalogInstallFlowServing, coordinator: UpdateInstallCoordinator, client: CatalogInstallRequest.Client = .f1,
         appName: String? = nil, onInstalled: @escaping @MainActor () -> Void = {},
         track: @escaping ConnectedAppEvent.Track = { _ in }) {
        self.service = service
        self.coordinator = coordinator
        self.client = client
        self.appName = appName ?? (client == .product ? "OMGSkills Candidate" : "OMGSkills F1 Test")
        self.onInstalled = onInstalled
        self.track = track
    }

    var canCheckForAppUpdates: Bool { !ownsRequest && !appUpdateActive && !coordinator.isBusy && !appReplacementBlocksRequest }

    func beginAppUpdate() -> Bool {
        guard canCheckForAppUpdates else { return false }
        record = nil
        destination = nil
        request = nil
        result = nil
        notice = ""
        phase = .idle
        message = "Checking for app updates..."
        appUpdateActive = true
        return true
    }

    func finishAppUpdate(failed: Bool, requiresRestart: Bool = false) {
        appUpdateActive = requiresRestart
        message = requiresRestart ? "Finish the app update or restart before installing skills."
            : failed ? "The app update did not complete. You can check again."
            : "Update check finished. No skill changes made."
    }

    var ownsRequest: Bool { [.loading, .confirm, .rechecking, .installing, .cancelling].contains(phase) }
    var canClose: Bool { phase != .installing && phase != .cancelling }
    var isWorking: Bool { [.loading, .rechecking, .installing, .cancelling].contains(phase) }
    var hasFailure: Bool {
        guard let result else { return false }
        switch result {
        case .installed, .alreadyInstalled: return false
        default: return true
        }
    }
    private var appReplacementBlocksRequest: Bool { appUpdateActive || coordinator.hasPendingInstall || coordinator.isAppReplacementActive }

    func receive(_ url: URL) {
        guard !appReplacementBlocksRequest else {
            notice = "Finish the app update, then retry from the website."
            return
        }
        let incoming: CatalogInstallRequest
        do { incoming = try CatalogInstallRequest(url: url, client: client) }
        catch {
            if ownsRequest { notice = "This install link is invalid." }
            else {
                record = nil
                request = nil
                destination = nil
                finish(.unavailable, message: "This install link is invalid.")
            }
            return
        }
        guard !ownsRequest else {
            notice = incoming == request ? "" : "Finish or cancel the current request first."
            return
        }
        request = incoming
        track(.install(.requested, agent: incoming.target))
        record = nil
        destination = nil
        result = nil
        notice = ""
        phase = .loading
        message = "Loading installation information..."
        activity = coordinator.beginActivity(.skillInstall)
        let id = UUID()
        operationID = id
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                guard let fetched = try await service.fetch(id: incoming.catalogID) else {
                    if isCurrent(id) { finish(.unavailable, message: "This skill is not available in the catalog.") }
                    return
                }
                guard fetched.id == incoming.catalogID else { throw CatalogInstallRecordClient.ClientError.invalidResponse }
                let target = try await service.destination(for: fetched, target: incoming.target)
                guard isCurrent(id) else { return }
                record = fetched
                destination = target
                phase = .confirm
                message = "Ready to install in \(incoming.target.rawValue)."
            } catch {
                guard isCurrent(id) else { return }
                finish(.unavailable, message: Self.fetchFailureMessage(error))
            }
        }
    }

    func install() {
        guard phase == .confirm, let approved = record, let incoming = request else { return }
        track(.install(.approved, agent: incoming.target))
        guard !appReplacementBlocksRequest else {
            finish(.failed("An app update is waiting. Retry after the app restarts."))
            return
        }
        phase = .rechecking
        message = "Checking installation information..."
        notice = ""
        let id = UUID()
        operationID = id
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                guard let current = try await service.fetch(id: incoming.catalogID) else {
                    if isCurrent(id) { finish(.unavailable, message: "This skill is no longer available in the catalog.") }
                    return
                }
                guard current.id == incoming.catalogID else { throw CatalogInstallRecordClient.ClientError.invalidResponse }
                let currentDestination = try await service.destination(for: current, target: incoming.target)
                guard isCurrent(id) else { return }
                guard !appReplacementBlocksRequest else {
                    finish(.failed("An app update is waiting. Retry after the app restarts."))
                    return
                }
                if !approved.hasSameInstallation(as: current) || destination != currentDestination {
                    record = current
                    destination = currentDestination
                    phase = .confirm
                    message = "Installation information changed. Confirm again."
                    return
                }
                phase = .installing
                message = "Installing in \(incoming.target.rawValue)..."
                // No cancellation or close during the backend's final filesystem writes.
                let installed = await service.install(current, target: incoming.target)
                guard operationID == id else { return }
                finish(installed)
                if installed == .installed { onInstalled() }
            } catch {
                guard isCurrent(id) else { return }
                finish(.unavailable, message: Self.fetchFailureMessage(error))
            }
        }
    }

    func close() async -> Bool {
        guard canClose else { return false }
        if ownsRequest { track(.install(.cancelled, agent: request?.target)) }
        phase = .cancelling
        operationID = nil
        let pending = operation
        pending?.cancel()
        await pending?.value
        operation = nil
        record = nil
        request = nil
        destination = nil
        result = nil
        notice = ""
        message = "Ready"
        phase = .idle
        releaseActivity()
        return true
    }

    private func isCurrent(_ id: UUID) -> Bool { operationID == id && !Task.isCancelled }

    private func finish(_ result: CatalogInstallService.Result, message: String? = nil) {
        track(.installResult(result, agent: request?.target))
        self.result = result
        phase = .result
        notice = ""
        operationID = nil
        self.message = message ?? Self.resultMessage(result, target: request?.target)
        releaseActivity()
    }

    private func releaseActivity() {
        let token = activity
        activity = nil
        token?.finish()
    }

    private static func fetchFailureMessage(_ error: any Error) -> String {
        if error is CancellationError { return "Request canceled. No installation started." }
        if error is CatalogSkillInstaller.InstallError || error is SkillInstaller.InstallError { return error.localizedDescription }
        return "Could not load installation information. Close this request and retry."
    }

    private static func resultMessage(_ result: CatalogInstallService.Result, target: SkillInstaller.Target?) -> String {
        switch result {
        case .installed: return "Installed in \(target?.rawValue ?? "the selected agent")."
        case .alreadyInstalled: return "Already installed. No changes made."
        case .conflict: return "Another skill or record uses this destination. Nothing was replaced."
        case .needsGit: return "Git is required. Set up Git, then retry from the website."
        case .unavailable: return "This skill's installation information is unavailable."
        case .failed(let reason): return reason
        }
    }
}
#endif
