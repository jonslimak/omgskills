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
    /// Time source for the "still loading" hint and record freshness; tests inject a manual clock.
    struct Timing: Sendable {
        var now: @Sendable () -> ContinuousClock.Instant
        var sleep: @Sendable (Duration) async throws -> Void
        static let live = Timing(now: { .now }, sleep: { try await Task.sleep(for: $0) })
    }
    static let slowLoadingDelay: Duration = .seconds(3)
    static let loadingMessage = "Loading installation information..."
    static let slowLoadingMessage = "Still loading…"
    static let recheckingMessage = "Checking installation information..."
    static let slowRecheckingMessage = "Still checking…"
    /// Approve re-reads the record so a takedown or changed pins between review and approval are caught.
    /// A record read this recently is trusted instead; the gap is no wider than this window.
    static let recordReuseWindow: Duration = .seconds(30)
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
    /// Runs once for each install link that parses, before any install work; must not block.
    @ObservationIgnored var onRequestReceived: @MainActor (CatalogInstallRequest) -> Void = { _ in }
    @ObservationIgnored private let track: ConnectedAppEvent.Track
    @ObservationIgnored private let service: any CatalogInstallFlowServing
    @ObservationIgnored private let coordinator: UpdateInstallCoordinator
    @ObservationIgnored private var activity: UpdateInstallCoordinator.ActivityToken?
    @ObservationIgnored private var operationID: UUID?
    @ObservationIgnored private(set) var operation: Task<Void, Never>?
    @ObservationIgnored private let timing: Timing
    /// When the shown record's lookup started; nil when no record is shown.
    @ObservationIgnored private var recordFetchedAt: ContinuousClock.Instant?
    @ObservationIgnored private var slowNotice: Task<Void, Never>?

    init(service: any CatalogInstallFlowServing, coordinator: UpdateInstallCoordinator, client: CatalogInstallRequest.Client = .f1,
         appName: String? = nil, onInstalled: @escaping @MainActor () -> Void = {},
         track: @escaping ConnectedAppEvent.Track = { _ in }, timing: Timing = .live) {
        self.service = service
        self.timing = timing
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
        recordFetchedAt = nil
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
    var appReplacementBlocksRequest: Bool { appUpdateActive || coordinator.hasPendingInstall || coordinator.isAppReplacementActive }

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
                recordFetchedAt = nil
                request = nil
                destination = nil
                finish(.unavailable, message: "This install link is invalid.")
            }
            return
        }
        // Ack only links this Mac takes up (or the one already on screen), not ones turned away.
        if !ownsRequest || incoming == request { onRequestReceived(incoming) }
        guard !ownsRequest else {
            notice = incoming == request ? "" : "Finish or cancel the current request first."
            return
        }
        request = incoming
        track(.install(.requested, agent: incoming.target))
        record = nil
        recordFetchedAt = nil
        destination = nil
        result = nil
        notice = ""
        phase = .loading
        message = Self.loadingMessage
        activity = coordinator.beginActivity(.skillInstall)
        let id = UUID()
        operationID = id
        showSlowNotice(Self.slowLoadingMessage, in: .loading, for: id)
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                let started = timing.now()
                guard let fetched = try await service.fetch(id: incoming.catalogID) else {
                    if isCurrent(id) { finish(.unavailable, message: "This skill is not available in the catalog.") }
                    return
                }
                guard fetched.id == incoming.catalogID else { throw CatalogInstallRecordClient.ClientError.invalidResponse }
                let target = try await service.destination(for: fetched, target: incoming.target)
                guard isCurrent(id) else { return }
                cancelSlowNotice()
                record = fetched
                recordFetchedAt = started
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
        // Reuse only the record on screen for this request, and only while it is very fresh.
        let reuse = recordFetchedAt.map { timing.now() - $0 < Self.recordReuseWindow } ?? false
        phase = .rechecking
        message = Self.recheckingMessage
        notice = ""
        let id = UUID()
        operationID = id
        if !reuse { showSlowNotice(Self.slowRecheckingMessage, in: .rechecking, for: id) }
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                let started = timing.now()
                let fetched = reuse ? approved : try await service.fetch(id: incoming.catalogID)
                guard let current = fetched else {
                    if isCurrent(id) { finish(.unavailable, message: "This skill is no longer available in the catalog.") }
                    return
                }
                guard current.id == incoming.catalogID else { throw CatalogInstallRecordClient.ClientError.invalidResponse }
                let currentDestination = try await service.destination(for: current, target: incoming.target)
                guard isCurrent(id) else { return }
                cancelSlowNotice()
                guard !appReplacementBlocksRequest else {
                    finish(.failed("An app update is waiting. Retry after the app restarts."))
                    return
                }
                if !approved.hasSameInstallation(as: current) || destination != currentDestination {
                    record = current
                    if !reuse { recordFetchedAt = started }
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
        cancelSlowNotice()
        record = nil
        recordFetchedAt = nil
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

    /// After `slowLoadingDelay`, swaps in `text` if this operation is still waiting in `phase`.
    private func showSlowNotice(_ text: String, in phase: Phase, for id: UUID) {
        slowNotice?.cancel()
        let sleep = timing.sleep
        slowNotice = Task { [weak self] in
            do { try await sleep(Self.slowLoadingDelay) } catch { return }
            guard let self, !Task.isCancelled, operationID == id, self.phase == phase else { return }
            message = text
        }
    }

    private func cancelSlowNotice() {
        slowNotice?.cancel()
        slowNotice = nil
    }

    private func finish(_ result: CatalogInstallService.Result, message: String? = nil) {
        track(.installResult(result, agent: request?.target))
        cancelSlowNotice()
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
