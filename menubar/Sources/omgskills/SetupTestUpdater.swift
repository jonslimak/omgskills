#if DEBUG || OMGSKILLS_SETUP_TEST
import Foundation

// Lifecycle only: AppDelegate continues to own the app's single Sparkle controller.
@MainActor
final class SetupTestUpdater {
    enum Phase { case idle, checking, restartRequired }
    private(set) var phase: Phase = .idle
    private let model: PublicSkillInstallModel
    private let performCheck: @MainActor () throws -> Void

    init(model: PublicSkillInstallModel, performCheck: @escaping @MainActor () throws -> Void) {
        self.model = model
        self.performCheck = performCheck
    }

    var canCheck: Bool { phase == .idle && !model.ownsRequest && !model.appUpdateActive }
    var permitsUpdate: Bool { phase != .idle && model.appUpdateActive && !model.ownsRequest }

    func check() {
        guard canCheck, model.beginAppUpdate() else { return }
        phase = .checking
        do { try performCheck() }
        catch { finish(failed: true) }
    }

    func installationStarted() {
        guard permitsUpdate else { return }
        phase = .restartRequired
        model.finishAppUpdate(message: "Finish the app update or restart before installing skills.", requiresRestart: true)
    }

    func finish(failed: Bool) {
        guard phase == .checking else { return }
        phase = .idle
        model.finishAppUpdate(message: failed ? "The app update did not complete. You can check again."
                              : "Update check finished. No skill changes made.")
    }
}
#endif
