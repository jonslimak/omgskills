import Foundation
import Observation

public protocol InstallServing: Sendable {
    func prepare(_ request: HandoffRequest) async throws -> InstallReview
    func prepareRestore() async throws -> InstallReview
    func apply(_ id: UUID) async throws -> String
    func discard(_ id: UUID) async
}

public struct PublicInstallService: InstallServing {
    private let loader: PublicPackageLoader
    private let store: SandboxInstaller
    package init(testRoot: String) throws {
        store = SandboxInstaller(sandbox: try InstallSandbox(path: testRoot))
        loader = PublicPackageLoader(http: BoundedPublicHTTP())
    }

    package init(home: UserInstallHome, agent: InstallAgent) {
        store = SandboxInstaller(location: .user(home, agent))
        loader = PublicPackageLoader(http: BoundedPublicHTTP())
    }

    public func prepare(_ request: HandoffRequest) async throws -> InstallReview {
        let candidate = try await withThrowingTaskGroup(of: InstallCandidate.self) { group in
            group.addTask {
                let pin = try await loader.resolve(request)
                return try await InstallCandidate(pin: pin, package: loader.fetch(pin))
            }
            group.addTask {
                try await Task.sleep(for: .seconds(180))
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            guard let result = try await group.next() else { throw CancellationError() }
            return result
        }
        try Task.checkCancellation()
        return try await store.prepare(candidate)
    }

    public func prepareRestore() async throws -> InstallReview { try await store.prepareRestore() }
    public func apply(_ id: UUID) async throws -> String { try await store.apply(id) }
    public func discard(_ id: UUID) async { await store.discard(id) }
}

@MainActor @Observable
public final class InstallModel {
    public private(set) var review: InstallReview?
    public private(set) var isLoading = false
    public private(set) var isApplying = false
    public private(set) var message: String?
    public private(set) var noticeMessage: String?
    public private(set) var errorMessage: String?
    public private(set) var canRestore = false
    public private(set) var selectedAgent: InstallAgent = .codex
    @ObservationIgnored private let requestPolicy: HandoffRequestPolicy
    @ObservationIgnored private let admissionCheck: @MainActor () throws -> Void
    public var canSelectAgent: Bool { !services.isEmpty }
    @ObservationIgnored private var service: any InstallServing
    @ObservationIgnored private let services: [InstallAgent: any InstallServing]
    @ObservationIgnored private var request: HandoffRequest?
    @ObservationIgnored private(set) var task: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()

    public init(service: any InstallServing, requestPolicy: HandoffRequestPolicy = .helper,
                admissionCheck: @escaping @MainActor () throws -> Void = {}) {
        self.service = service; services = [:]; self.requestPolicy = requestPolicy
        self.admissionCheck = admissionCheck
    }

    public init(codex: any InstallServing, claude: any InstallServing, requestPolicy: HandoffRequestPolicy = .helper,
                admissionCheck: @escaping @MainActor () throws -> Void = {}) {
        service = codex
        services = [.codex: codex, .claude: claude]
        self.requestPolicy = requestPolicy
        self.admissionCheck = admissionCheck
    }

    public func selectAgent(_ agent: InstallAgent) {
        guard !isApplying, agent != selectedAgent, let next = services[agent] else { return }
        guard admitted() else { return }
        begin()
        selectedAgent = agent
        service = next
        isLoading = false
        if let request { load { try await next.prepare(request) } }
    }

    public func open(_ raw: String) {
        guard !isApplying else {
            noticeMessage = "An installation is finishing. Reopen the link when it completes."
            return
        }
        guard admitted() else { return }
        guard let incoming = HandoffRequest.parse(raw, policy: requestPolicy) else {
            cancel(); errorMessage = "Invalid install link. Nothing was installed."; return
        }
        if incoming == request, isLoading { return }
        begin()
        request = incoming
        load { [service] in try await service.prepare(incoming) }
    }

    public func restore() {
        guard !isApplying, !isLoading, canRestore else { return }
        guard admitted() else { return }
        begin()
        load { [service] in try await service.prepareRestore() }
    }

    public func apply() {
        guard let review, !isApplying, !isLoading, review.action != .unchanged else { return }
        guard admitted() else { return }
        isApplying = true
        noticeMessage = nil
        errorMessage = nil
        let current = generation
        task = Task { [weak self, service] in
            do {
                let result = try await service.apply(review.id)
                guard let self, generation == current else { return }
                message = result
                self.review = nil
                canRestore = review.fromCommit != nil
            } catch {
                guard let self, generation == current else { return }
                self.review = nil
                canRestore = false
                errorMessage = Self.message(for: error)
            }
            guard let self, generation == current else { return }
            isApplying = false
            task = nil
        }
    }

    public func cancel() {
        guard !isApplying else { return }
        begin()
        request = nil
        isLoading = false
    }

    private func begin() {
        generation = UUID()
        task?.cancel()
        task = nil
        if let review { Task { [service] in await service.discard(review.id) } }
        review = nil
        message = nil
        noticeMessage = nil
        errorMessage = nil
        canRestore = false
    }

    private func admitted() -> Bool {
        do { try admissionCheck(); return true }
        catch {
            cancel()
            errorMessage = (error as? HelperLaunchFailure)?.localizedDescription ?? Self.message(for: error)
            return false
        }
    }

    private func load(_ operation: @escaping @Sendable () async throws -> InstallReview) {
        isLoading = true
        let current = generation
        task = Task { [weak self, service] in
            do {
                let result = try await operation()
                guard let self, generation == current, !Task.isCancelled else {
                    await service.discard(result.id)
                    return
                }
                review = result
                canRestore = result.canRestore
            } catch {
                guard let self, generation == current, !Task.isCancelled else { return }
                errorMessage = Self.message(for: error)
            }
            guard let self, generation == current else { return }
            isLoading = false
            task = nil
        }
    }

    private static func message(for error: any Error) -> String {
        if let known = error as? InstallFailure { return known.localizedDescription }
        if let known = error as? PreviewFailure { return known.localizedDescription }
        if (error as? URLError)?.code == .timedOut { return "The download timed out. Reopen the link to retry." }
        return "The operation could not be verified. Reopen the link to check the installed version."
    }

    deinit { task?.cancel() }
}
