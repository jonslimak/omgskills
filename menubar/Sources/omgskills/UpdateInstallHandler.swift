import Foundation

struct PendingUpdateInstall: Equatable {
    let targetVersion: String?
    let targetBuild: String?
}

struct PendingUpdateInstallStore {
    private enum Key {
        static let targetVersion = "pendingUpdateInstall.targetVersion"
        static let targetBuild = "pendingUpdateInstall.targetBuild"
    }

    private let userDefaults: UserDefaults

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }

    func save(targetVersion: String?, targetBuild: String?) {
        userDefaults.set(targetVersion, forKey: Key.targetVersion)
        userDefaults.set(targetBuild, forKey: Key.targetBuild)
    }

    func load() -> PendingUpdateInstall? {
        let targetVersion = userDefaults.string(forKey: Key.targetVersion)
        let targetBuild = userDefaults.string(forKey: Key.targetBuild)
        guard targetVersion != nil || targetBuild != nil else { return nil }
        return PendingUpdateInstall(targetVersion: targetVersion, targetBuild: targetBuild)
    }

    func clear() {
        userDefaults.removeObject(forKey: Key.targetVersion)
        userDefaults.removeObject(forKey: Key.targetBuild)
    }
}

@MainActor
final class UpdateInstallHandler {
    private let coordinator: UpdateInstallCoordinator
    private let pendingStore: PendingUpdateInstallStore

    init(
        coordinator: UpdateInstallCoordinator,
        pendingStore: PendingUpdateInstallStore = PendingUpdateInstallStore()
    ) {
        self.coordinator = coordinator
        self.pendingStore = pendingStore
    }

    @discardableResult
    func handleInstallOnQuit(
        targetVersion: String?,
        targetBuild: String?,
        immediateInstallHandler: @escaping @MainActor () -> Void
    ) -> Bool {
        coordinator.requestInstall(
            targetVersion: targetVersion,
            targetBuild: targetBuild
        ) { [pendingStore] in
            pendingStore.save(targetVersion: targetVersion, targetBuild: targetBuild)
            immediateInstallHandler()
        }
    }
}
