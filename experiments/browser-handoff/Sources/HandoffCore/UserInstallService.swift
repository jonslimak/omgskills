import Foundation

// Constructing the normal app must not initialize storage or read launch settings.
public actor UserInstallService: InstallServing {
    private let makeService: @Sendable () throws -> any InstallServing
    private var service: (any InstallServing)?

    public init(agent: InstallAgent) {
        makeService = { try PublicInstallService(home: .currentUser(), agent: agent) }
    }

    package init(makeService: @escaping @Sendable () throws -> any InstallServing) {
        self.makeService = makeService
    }

    public func prepare(_ request: HandoffRequest) async throws -> InstallReview {
        guard HandoffRequestPolicy.publicSkills[request.skillID] != nil else { throw InstallFailure.invalidRecord }
        try Task.checkCancellation()
        let active: any InstallServing
        if let service { active = service }
        else { active = try makeService(); service = active }
        return try await active.prepare(request)
    }

    public func prepareRestore() async throws -> InstallReview {
        guard let service else { throw InstallFailure.noBackup }
        return try await service.prepareRestore()
    }

    public func apply(_ id: UUID) async throws -> String {
        guard let service else { throw InstallFailure.staleReview }
        return try await service.apply(id)
    }

    public func discard(_ id: UUID) async { await service?.discard(id) }
}
