#if DEBUG || OMGSKILLS_SETUP_TEST
import Foundation
import Testing
@testable import omgskills

@MainActor
struct SetupTestUpdaterTests {
    private let url = "omgskills-setup-test://review?v=1&id=owner/repo:example&repo=owner/repo&path=example/SKILL.md&agent=codex"

    @Test func manualOnlyCheckBlocksLinksApplyAndDuplicateChecksUntilFinished() async {
        let service = UpdateReviewStub()
        let model = PublicSkillInstallModel(service: service, client: .setupTest)
        var checks = 0
        let updater = SetupTestUpdater(model: model) { checks += 1 }
        #expect(checks == 0)
        #expect(updater.canCheck)
        #expect(!updater.permitsUpdate)
        updater.check()
        updater.check()
        model.receive(url)
        model.apply()
        await model.cancel()
        #expect(checks == 1)
        #expect(await service.prepares == 0)
        #expect(await service.applies == 0)
        #expect(model.appUpdateActive)
        #expect(updater.permitsUpdate)
        updater.finish(failed: false)
        #expect(!model.appUpdateActive)
        #expect(updater.canCheck)
        #expect(await service.prepares == 0) // A blocked browser link is never silently replayed.
        model.receive(url)
        await model.operation?.value
        #expect(model.phase == .review)
        #expect(await service.prepares == 1)
    }

    @Test func loadingReviewAndApplyingBlockAppUpgrade() async {
        let service = UpdateReviewStub(holdPrepare: true, holdApply: true)
        let model = PublicSkillInstallModel(service: service, client: .setupTest)
        var checks = 0
        let updater = SetupTestUpdater(model: model) { checks += 1 }
        model.receive(url)
        await service.waitForPrepare()
        updater.check()
        #expect(checks == 0)
        #expect(!updater.canCheck)
        await service.resumePrepare()
        await model.operation?.value
        updater.check()
        #expect(checks == 0)
        model.apply()
        await service.waitForApply()
        updater.check()
        #expect(checks == 0)
        #expect(!model.appUpdateActive)
        await service.resumeApply()
        await model.operation?.value
        updater.check()
        #expect(checks == 1)
        #expect(model.review == nil)
        model.apply()
        #expect(await service.applies == 1)
        updater.finish(failed: false)
    }

    @Test func cancellationHoldsTheLockUntilCleanupFinishes() async {
        let service = UpdateReviewStub(holdCancel: true)
        let model = PublicSkillInstallModel(service: service, client: .setupTest)
        var checks = 0
        let updater = SetupTestUpdater(model: model) { checks += 1 }
        model.receive(url)
        await model.operation?.value
        let cancel = Task { await model.cancel() }
        await service.waitForCancel()
        #expect(model.phase == .cancelling)
        updater.check()
        #expect(checks == 0)
        await service.resumeCancel()
        await cancel.value
        updater.check()
        #expect(checks == 1)
        updater.finish(failed: false)
        model.apply()
        #expect(await service.applies == 0)
    }

    @Test func checkFailureUnlocksButPendingReplacementStaysLocked() async {
        let service = UpdateReviewStub()
        let model = PublicSkillInstallModel(service: service, client: .setupTest)
        let failed = SetupTestUpdater(model: model) { throw URLError(.notConnectedToInternet) }
        failed.check()
        #expect(failed.canCheck)
        #expect(!model.appUpdateActive)
        #expect(model.message.contains("did not complete"))
        let updater = SetupTestUpdater(model: model) {}
        updater.installationStarted()
        #expect(updater.phase == .idle)
        updater.check()
        updater.installationStarted()
        updater.finish(failed: true)
        updater.finish(failed: false)
        updater.check()
        model.receive(url)
        await model.cancel()
        model.apply()
        #expect(updater.phase == .restartRequired)
        #expect(!updater.canCheck)
        #expect(model.appUpdateActive)
        #expect(await service.prepares == 0)
        #expect(await service.applies == 0)
        let restarted = PublicSkillInstallModel(service: service, client: .setupTest)
        #expect(!restarted.appUpdateActive)
        #expect(restarted.review == nil)
        restarted.apply()
        #expect(await service.applies == 0)
    }
}

private actor UpdateReviewStub: PublicSkillReviewServing {
    let holdPrepare: Bool, holdApply: Bool, holdCancel: Bool
    var prepares = 0, applies = 0
    private var prepareWait: CheckedContinuation<Void, Never>?, applyWait: CheckedContinuation<Void, Never>?, cancelWait: CheckedContinuation<Void, Never>?
    private var prepareStarted: CheckedContinuation<Void, Never>?, applyStarted: CheckedContinuation<Void, Never>?, cancelStarted: CheckedContinuation<Void, Never>?

    init(holdPrepare: Bool = false, holdApply: Bool = false, holdCancel: Bool = false) {
        self.holdPrepare = holdPrepare; self.holdApply = holdApply; self.holdCancel = holdCancel
    }
    func prepare(_ source: PublicSkillInstallRequest) async throws -> PublicSkillInstallReview {
        prepares += 1
        if holdPrepare { await withCheckedContinuation { prepareWait = $0; prepareStarted?.resume(); prepareStarted = nil } }
        return PublicSkillInstallReview(id: UUID(), action: .install, source: source,
            destination: URL(fileURLWithPath: "/private/tmp/example"), fromCoordinates: nil,
            toCoordinates: GroupSkillPackageTestSupport.coordinates, changes: [])
    }
    func apply(_ id: UUID) async throws -> PublicSkillInstallReview.Action {
        applies += 1
        if holdApply { await withCheckedContinuation { applyWait = $0; applyStarted?.resume(); applyStarted = nil } }
        return .install
    }
    func cancel(_ id: UUID) async {
        if holdCancel { await withCheckedContinuation { cancelWait = $0; cancelStarted?.resume(); cancelStarted = nil } }
    }
    func waitForPrepare() async { if prepareWait == nil { await withCheckedContinuation { prepareStarted = $0 } } }
    func waitForApply() async { if applyWait == nil { await withCheckedContinuation { applyStarted = $0 } } }
    func waitForCancel() async { if cancelWait == nil { await withCheckedContinuation { cancelStarted = $0 } } }
    func resumePrepare() { prepareWait?.resume(); prepareWait = nil }
    func resumeApply() { applyWait?.resume(); applyWait = nil }
    func resumeCancel() { cancelWait?.resume(); cancelWait = nil }
}
#endif
