#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import Foundation
import Observation

@MainActor @Observable
final class CatalogCandidateUpdater {
    enum Phase { case idle, checking, restartRequired }
    private(set) var phase: Phase = .idle
    private let model: CatalogInstallModel
    private let performCheck: @MainActor () throws -> Void

    init(model: CatalogInstallModel, performCheck: @escaping @MainActor () throws -> Void) {
        self.model = model
        self.performCheck = performCheck
    }

    var canCheck: Bool { phase == .idle && model.canCheckForAppUpdates }
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
        model.finishAppUpdate(failed: false, requiresRestart: true)
    }

    func finish(failed: Bool) {
        guard phase == .checking else { return }
        phase = .idle
        model.finishAppUpdate(failed: failed)
    }
}
#endif
