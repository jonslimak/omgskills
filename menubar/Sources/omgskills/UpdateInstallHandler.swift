import Foundation

struct PendingUpdateInstall: Equatable {
    let sourceVersion: String?
    let sourceBuild: String?
    let targetVersion: String?
    let targetBuild: String?
}

struct PendingUpdateInstallStore {
    private enum Key {
        static let sourceVersion = "pendingUpdateInstall.sourceVersion"
        static let sourceBuild = "pendingUpdateInstall.sourceBuild"
        static let targetVersion = "pendingUpdateInstall.targetVersion"
        static let targetBuild = "pendingUpdateInstall.targetBuild"
    }

    private let userDefaults: UserDefaults

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }

    func save(
        sourceVersion: String?,
        sourceBuild: String?,
        targetVersion: String?,
        targetBuild: String?
    ) {
        userDefaults.set(sourceVersion, forKey: Key.sourceVersion)
        userDefaults.set(sourceBuild, forKey: Key.sourceBuild)
        userDefaults.set(targetVersion, forKey: Key.targetVersion)
        userDefaults.set(targetBuild, forKey: Key.targetBuild)
    }

    func load() -> PendingUpdateInstall? {
        let sourceVersion = userDefaults.string(forKey: Key.sourceVersion)
        let sourceBuild = userDefaults.string(forKey: Key.sourceBuild)
        let targetVersion = userDefaults.string(forKey: Key.targetVersion)
        let targetBuild = userDefaults.string(forKey: Key.targetBuild)
        guard sourceVersion != nil || sourceBuild != nil || targetVersion != nil || targetBuild != nil else { return nil }
        return PendingUpdateInstall(
            sourceVersion: sourceVersion,
            sourceBuild: sourceBuild,
            targetVersion: targetVersion,
            targetBuild: targetBuild
        )
    }

    func clear() {
        userDefaults.removeObject(forKey: Key.sourceVersion)
        userDefaults.removeObject(forKey: Key.sourceBuild)
        userDefaults.removeObject(forKey: Key.targetVersion)
        userDefaults.removeObject(forKey: Key.targetBuild)
    }
}

@MainActor
final class UpdateInstallHandler {
    private let coordinator: UpdateInstallCoordinator
    private let pendingStore: PendingUpdateInstallStore
    private let appVersionParameters: () -> [String: String]
    private let emit: (_ name: String, _ parameters: [String: String]) -> Void

    init(
        coordinator: UpdateInstallCoordinator,
        pendingStore: PendingUpdateInstallStore = PendingUpdateInstallStore(),
        appVersionParameters: @escaping () -> [String: String] = Analytics.appVersionParameters,
        emit: @escaping (_ name: String, _ parameters: [String: String]) -> Void = { name, parameters in
            Analytics.signal(name, parameters: parameters)
        }
    ) {
        self.coordinator = coordinator
        self.pendingStore = pendingStore
        self.appVersionParameters = appVersionParameters
        self.emit = emit
    }

    @discardableResult
    func handleInstallOnQuit(
        targetVersion: String?,
        targetBuild: String?,
        immediateInstallHandler: @escaping @MainActor () -> Void
    ) -> Bool {
        let wasBusy = coordinator.isBusy
        let parameters = Analytics.updateParameters(
            appVersionParameters: appVersionParameters(),
            targetVersion: targetVersion,
            targetBuild: targetBuild
        )

        emit("app.update_ready", parameters)
        if wasBusy {
            emit("app.update_deferred_busy", parameters)
        }

        let emit = self.emit
        return coordinator.requestInstall(
            targetVersion: targetVersion,
            targetBuild: targetBuild
        ) { [pendingStore] in
            pendingStore.save(
                sourceVersion: parameters["app_version"],
                sourceBuild: parameters["build_number"],
                targetVersion: targetVersion,
                targetBuild: targetBuild
            )
            emit("app.update_relaunch_requested", parameters)
            immediateInstallHandler()
        }
    }
}
