#if DEBUG || OMGSKILLS_SETUP_TEST
import Foundation
import Observation

protocol PublicSkillReviewServing: Sendable {
    func prepare(_ source: PublicSkillInstallRequest) async throws -> PublicSkillInstallReview
    func apply(_ id: UUID) async throws -> PublicSkillInstallReview.Action
    func cancel(_ id: UUID) async
}

struct PublicSkillReviewService: PublicSkillReviewServing {
    let fetcher: any PublicSkillPackageResolving
    let installer: ManagedSkillInstaller
    let paths: SkillFilesystemPaths

    static func setupTest(_ configuration: SetupTestRuntime.Configuration) throws -> Self {
        try configuration.validateStorage()
        return Self(fetcher: HTTPPublicSkillPackageFetcher(),
            installer: ManagedSkillInstaller(managedRoot: configuration.managedRoot, pathAnchor: configuration.home),
            paths: configuration.paths)
    }

    func prepare(_ source: PublicSkillInstallRequest) async throws -> PublicSkillInstallReview {
        let package = try await fetcher.resolvePackage(source)
        try Task.checkCancellation()
        let review = try await installer.preparePublicInstall(source, package: package, filesystemPaths: paths)
        if Task.isCancelled {
            await installer.cancelPublicInstall(reviewID: review.id)
            throw CancellationError()
        }
        return review
    }

    func apply(_ id: UUID) async throws -> PublicSkillInstallReview.Action {
        try await installer.applyPublicInstall(reviewID: id)
    }

    func cancel(_ id: UUID) async { await installer.cancelPublicInstall(reviewID: id) }
}

@MainActor @Observable
final class PublicSkillInstallModel {
    enum Phase: Equatable { case idle, loading, review, applying, cancelling, success, failure }
    private(set) var phase: Phase = .idle
    private(set) var review: PublicSkillInstallReview?
    private(set) var message = "Ready"
    private(set) var notice = ""
    private(set) var appUpdateActive = false
    private var request: PublicSkillInstallRequest?
    @ObservationIgnored private let service: any PublicSkillReviewServing
    let client: PublicSkillInstallClient
    @ObservationIgnored private(set) var operation: Task<Void, Never>?

    init(service: any PublicSkillReviewServing, client: PublicSkillInstallClient = .f1) {
        self.service = service
        self.client = client
    }
    var isApplying: Bool { phase == .applying }
    var ownsRequest: Bool { [.loading, .review, .applying, .cancelling].contains(phase) }

    func beginAppUpdate() -> Bool {
        guard !ownsRequest, !appUpdateActive else { return false }
        appUpdateActive = true
        review = nil
        request = nil
        phase = .idle
        notice = ""
        message = "Checking for app updates..."
        return true
    }

    func finishAppUpdate(message: String, requiresRestart: Bool = false) {
        appUpdateActive = requiresRestart
        self.message = message
        notice = ""
    }

    func receive(_ rawURL: String) {
        guard !appUpdateActive else {
            notice = "Finish the app update before opening a skill request. Then retry from the website."
            return
        }
        let source: PublicSkillInstallRequest
        do { source = try PublicSkillInstallRequest(url: rawURL, client: client) }
        catch {
            if !ownsRequest { phase = .failure; review = nil; message = "This install link is invalid." }
            return
        }
        guard !ownsRequest else {
            notice = source == request ? "" : "Finish or cancel the current request first."
            return
        }
        request = source
        review = nil
        notice = ""
        phase = .loading
        message = "Loading package..."
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await service.prepare(source)
                guard !Task.isCancelled else { await service.cancel(result.id); return }
                review = result
                phase = .review
                message = result.action == .unchanged ? "Already installed" : "Review required"
            } catch is CancellationError {
                // Cancel waits for this task before accepting another request.
            } catch {
                guard !Task.isCancelled else { return }
                phase = .failure
                message = Self.failureMessage(error)
            }
        }
    }

    func apply() {
        guard !appUpdateActive, phase == .review, let review else { return }
        phase = .applying
        message = "Applying reviewed package..."
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await service.apply(review.id)
                phase = .success
                message = switch result {
                case .install: "Installed in " + client.destinationLabel
                case .update: "Updated in " + client.destinationLabel
                case .unchanged: "Already installed. No changes made."
                }
            } catch {
                phase = .failure
                message = Self.failureMessage(error)
            }
        }
    }

    func cancel() async {
        guard !appUpdateActive, !isApplying, phase != .cancelling else { return }
        phase = .cancelling
        operation?.cancel()
        await operation?.value
        if let review { await service.cancel(review.id) }
        operation = nil
        review = nil
        request = nil
        notice = ""
        phase = .idle
        message = "Ready"
    }

    private static func failureMessage(_ error: any Error) -> String {
        if let error = error as? PublicSkillReviewError { return error.localizedDescription }
        if let error = error as? PublicGitHubHTTPError { return error.localizedDescription }
        if error is CancellationError { return "Cancelled. No installation was activated." }
        return "The package could not be loaded or applied safely. Close this request and try again."
    }
}
#endif
