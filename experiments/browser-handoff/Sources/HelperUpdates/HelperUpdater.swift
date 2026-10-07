import Foundation
import HandoffCore
import Observation

@MainActor package protocol HelperUpdateDriving: AnyObject {
    func start() throws
    func check(_ cycle: UUID) throws
}

@MainActor @Observable
public final class HelperUpdater {
    public private(set) var status: String?
    public private(set) var needsRestart = false
    private var cycle: UUID?
    private let configured: Bool
    private let model: InstallModel
    @ObservationIgnored private var driver: (any HelperUpdateDriving)?
    @ObservationIgnored private let makeDriver: @MainActor (HelperUpdater) -> any HelperUpdateDriving

    public convenience init(model: InstallModel) {
        self.init(model: model, info: Bundle.main.infoDictionary ?? [:]) { SparkleUpdateDriver(owner: $0) }
    }

    package init(model: InstallModel, info: [String: Any],
                 makeDriver: @escaping @MainActor (HelperUpdater) -> any HelperUpdateDriving) {
        self.model = model
        self.makeDriver = makeDriver
        do {
            configured = try HelperUpdateConfiguration.validate(info)
            status = configured ? nil : "Helper updates are not configured for this build."
        } catch {
            configured = false
            status = "Helper update configuration is invalid."
        }
    }

    public var canCheck: Bool { configured && cycle == nil && model.canBeginHelperUpdate }

    public func checkForUpdates() {
        guard canCheck, let id = model.beginHelperUpdate() else { return }
        cycle = id
        status = nil
        if driver == nil { driver = makeDriver(self) }
        do {
            try driver?.start()
            try driver?.check(id)
        } catch {
            finish(id, failed: true)
        }
    }

    package func permits(_ id: UUID) -> Bool {
        cycle == id && model.helperUpdateActive && !model.hasPendingWork && !model.isApplying && !model.isTerminating
    }

    package func installationStarted(_ id: UUID) {
        guard cycle == id else { return }
        needsRestart = true
    }

    package func finish(_ id: UUID, failed: Bool) {
        guard cycle == id else { return }
        // A dismissed/failed installing-stage prompt can still have a pending replacement.
        guard !needsRestart else {
            status = "Restart the helper before installing skills."
            return
        }
        model.endHelperUpdate(id)
        cycle = nil
        status = failed ? "The helper update did not complete. You can check again." : nil
    }
}
