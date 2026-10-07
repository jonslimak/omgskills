import Foundation
import Sparkle

@MainActor
final class SparkleUpdateDriver: NSObject, HelperUpdateDriving, SPUUpdaterDelegate {
    private weak var owner: HelperUpdater?
    private var controller: SPUStandardUpdaterController!
    private var started = false
    private var cycle: UUID?

    init(owner: HelperUpdater) {
        self.owner = owner
        super.init()
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
    }

    func start() throws {
        guard !started else { return }
        try controller.updater.start()
        started = true
    }

    func check(_ cycle: UUID) throws {
        guard self.cycle == nil, controller.updater.canCheckForUpdates else { throw Self.unavailable() }
        self.cycle = cycle
        controller.checkForUpdates(nil)
    }

    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        guard updateCheck == .updates, let cycle, owner?.permits(cycle) == true else { throw Self.unavailable() }
    }

    func feedURLString(for updater: SPUUpdater) -> String? {
        // Sparkle otherwise permits a legacy user-default feed to override Info.plist.
        HelperUpdateConfiguration.feed
    }

    func allowedSystemProfileKeys(for updater: SPUUpdater) -> [String]? { [] }

    func updater(_ updater: SPUUpdater, shouldProceedWithUpdate updateItem: SUAppcastItem,
                 updateCheck: SPUUpdateCheck) throws {
        try self.updater(updater, mayPerform: updateCheck)
    }

    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        if let cycle { owner?.installationStarted(cycle) }
    }

    func updater(_ updater: SPUUpdater, userDidMake choice: SPUUserUpdateChoice,
                 forUpdate updateItem: SUAppcastItem, state: SPUUserUpdateState) {
        if state.stage == .installing, let cycle { owner?.installationStarted(cycle) }
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: (any Error)?) {
        guard updateCheck == .updates, let cycle else { return }
        self.cycle = nil
        owner?.finish(cycle, failed: Self.cycleFailed(error))
    }

    static func cycleFailed(_ error: (any Error)?) -> Bool {
        guard let error = error as NSError? else { return false }
        return !(error.domain == SUSparkleErrorDomain && error.code == Int(SUError.noUpdateError.rawValue))
    }

    private static func unavailable() -> NSError {
        NSError(domain: "com.omgskills.helper.updates", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Close the skill review and finish pending work before checking for helper updates."])
    }
}
