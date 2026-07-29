import Foundation

@MainActor
final class UpdateInstallCoordinator {
    typealias InstallHandler = @MainActor () -> Void

    enum Activity: Hashable {
        case skillInstall
        case gitHubInstallPrompt
        case localCrossInstall
        case localSkillDelete
        case portalConnection
        case legacySync
    }

    @MainActor
    final class ActivityToken {
        private weak var coordinator: UpdateInstallCoordinator?
        private let id: UUID
        private var isFinished = false

        fileprivate init(coordinator: UpdateInstallCoordinator, id: UUID) {
            self.coordinator = coordinator
            self.id = id
        }

        func finish() {
            guard !isFinished else { return }
            isFinished = true
            coordinator?.finishActivity(id: id)
        }
    }

    private struct PendingInstall {
        let targetVersion: String?
        let targetBuild: String?
        let handler: InstallHandler
    }

    private var activeActivities: [UUID: Activity] = [:]
    private var pendingInstall: PendingInstall?

    var isBusy: Bool {
        !activeActivities.isEmpty
    }

    var hasPendingInstall: Bool {
        pendingInstall != nil
    }

    var pendingTargetVersion: String? {
        pendingInstall?.targetVersion
    }

    var pendingTargetBuild: String? {
        pendingInstall?.targetBuild
    }

    func beginActivity(_ activity: Activity) -> ActivityToken {
        let id = UUID()
        activeActivities[id] = activity
        return ActivityToken(coordinator: self, id: id)
    }

    @discardableResult
    func requestInstall(
        targetVersion: String? = nil,
        targetBuild: String? = nil,
        handler: @escaping InstallHandler
    ) -> Bool {
        guard pendingInstall == nil else { return true }

        pendingInstall = PendingInstall(
            targetVersion: targetVersion,
            targetBuild: targetBuild,
            handler: handler
        )

        invokePendingInstallIfIdle()
        return true
    }

    func withActivity<T>(
        _ activity: Activity,
        operation: () throws -> T
    ) rethrows -> T {
        let token = beginActivity(activity)
        defer { token.finish() }
        return try operation()
    }

    private func finishActivity(id: UUID) {
        activeActivities[id] = nil
        invokePendingInstallIfIdle()
    }

    private func invokePendingInstallIfIdle() {
        guard !isBusy, let install = pendingInstall else { return }
        pendingInstall = nil
        install.handler()
    }
}
