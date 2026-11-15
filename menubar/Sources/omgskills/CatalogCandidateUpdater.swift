#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import Foundation
import Observation

@MainActor @Observable
final class CatalogCandidateUpdater {
    enum Phase { case idle, checking, restartRequired }
    private(set) var phase: Phase = .idle
    /// The current check runs in the background: no window, no status message unless an update is ready.
    private(set) var background = false
    private let model: CatalogInstallModel
    /// `true` asks for a background check (download quietly, install once idle); `false` shows Sparkle's window.
    private let performCheck: @MainActor (_ background: Bool) throws -> Void

    init(model: CatalogInstallModel, performCheck: @escaping @MainActor (_ background: Bool) throws -> Void) {
        self.model = model
        self.performCheck = performCheck
    }

    var canCheck: Bool { phase == .idle && model.canCheckForAppUpdates }
    var permitsUpdate: Bool { phase != .idle && model.appUpdateActive && !model.ownsRequest }

    func check() { start(background: false) }

    /// Skipped (and tried again next time) whenever a skill install, review or another check is in progress.
    func checkInBackground() { start(background: true) }

    private func start(background: Bool) {
        guard canCheck, model.beginAppUpdate(quiet: background) else { return }
        phase = .checking
        self.background = background
        do { try performCheck(background) }
        catch { finish(failed: true) }
    }

    func installationStarted() {
        guard permitsUpdate else { return }
        phase = .restartRequired
        model.finishAppUpdate(failed: false, requiresRestart: true)
    }

    func finish(failed: Bool) {
        guard phase == .checking else { return }
        phase = .idle
        model.finishAppUpdate(failed: failed, quiet: background)
        background = false
    }
}
#endif
