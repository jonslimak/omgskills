#if DEBUG
import Foundation
import Testing
@testable import omgskills

@MainActor
struct PublicSkillInstallModelTests {
    private let url = "omgskills-f1://review?v=1&id=owner/repo:example&repo=owner/repo&path=example/SKILL.md&agent=codex"

    @Test func duplicateRequestsReuseReviewAndApplyNeedsExplicitConsent() async throws {
        let service = ReviewStub()
        let model = PublicSkillInstallModel(service: service)
        model.receive(url)
        model.receive(url)
        model.receive(url + "&commit=" + String(repeating: "a", count: 40))
        #expect(!model.notice.isEmpty)
        await model.operation?.value
        #expect(model.phase == .review)
        #expect(await service.prepares == 1)
        #expect(await service.applies == 0)
        model.apply()
        model.apply()
        await model.operation?.value
        #expect(model.phase == .success)
        #expect(await service.applies == 1)
    }

    @Test func cancelledLatePrepareCannotRestoreReview() async {
        let service = ReviewStub(holdPrepare: true)
        let model = PublicSkillInstallModel(service: service)
        model.receive(url)
        await service.waitForPrepare()
        let cancel = Task { await model.cancel() }
        // The stub ignores task cancellation to exercise a late completion.
        await service.resumePrepare()
        await cancel.value
        #expect(model.phase == .idle)
        #expect(model.review == nil)
        #expect(await service.cancels == 1)
        #expect(await service.applies == 0)
    }

    @Test func applyBlocksCloseAndCompetingRequestsUntilResult() async {
        let service = ReviewStub(holdApply: true)
        let model = PublicSkillInstallModel(service: service)
        model.receive(url)
        await model.operation?.value
        model.apply()
        await service.waitForApply()
        await model.cancel()
        model.receive(url)
        #expect(model.phase == .applying)
        await service.resumeApply()
        await model.operation?.value
        #expect(model.phase == .success)
        #expect(await service.cancels == 0)
    }

    @Test func closeDiscardsConsentAndFailureNeverClaimsSuccess() async {
        let service = ReviewStub(failApply: true)
        let model = PublicSkillInstallModel(service: service)
        model.receive(url)
        await model.operation?.value
        await model.cancel()
        model.apply()
        #expect(await service.applies == 0)
        model.receive(url)
        await model.operation?.value
        model.apply()
        await model.operation?.value
        #expect(model.phase == .failure)
        #expect(model.message == PublicSkillReviewError.localChanges.localizedDescription)
    }

    @Test func invalidLinkNeverLoads() async {
        let service = ReviewStub()
        let model = PublicSkillInstallModel(service: service)
        model.receive("omgskills://install?repo=owner/repo")
        #expect(model.phase == .failure)
        #expect(await service.prepares == 0)
    }
}

private actor ReviewStub: PublicSkillReviewServing {
    let holdPrepare: Bool
    let holdApply: Bool
    let failApply: Bool
    var prepares = 0, applies = 0, cancels = 0
    var prepareWait: CheckedContinuation<Void, Never>?
    var applyWait: CheckedContinuation<Void, Never>?
    var prepareStarted: CheckedContinuation<Void, Never>?
    var applyStarted: CheckedContinuation<Void, Never>?

    init(holdPrepare: Bool = false, holdApply: Bool = false, failApply: Bool = false) {
        self.holdPrepare = holdPrepare; self.holdApply = holdApply; self.failApply = failApply
    }
    func prepare(_ source: PublicSkillInstallRequest) async throws -> PublicSkillInstallReview {
        prepares += 1
        if holdPrepare {
            await withCheckedContinuation { prepareWait = $0; prepareStarted?.resume(); prepareStarted = nil }
        }
        return PublicSkillInstallReview(id: UUID(), action: .install, source: source,
            destination: URL(fileURLWithPath: "/private/tmp/example"), fromCoordinates: nil,
            toCoordinates: GroupSkillPackageTestSupport.coordinates, changes: [])
    }
    func apply(_ id: UUID) async throws -> PublicSkillInstallReview.Action {
        applies += 1
        if holdApply {
            await withCheckedContinuation { applyWait = $0; applyStarted?.resume(); applyStarted = nil }
        }
        if failApply { throw PublicSkillReviewError.localChanges }
        return .install
    }
    func cancel(_ id: UUID) { cancels += 1 }
    func waitForPrepare() async {
        if prepareWait == nil { await withCheckedContinuation { prepareStarted = $0 } }
    }
    func waitForApply() async {
        if applyWait == nil { await withCheckedContinuation { applyStarted = $0 } }
    }
    func resumePrepare() { prepareWait?.resume(); prepareWait = nil }
    func resumeApply() { applyWait?.resume(); applyWait = nil }
}
#endif
