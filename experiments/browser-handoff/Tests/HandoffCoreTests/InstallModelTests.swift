import Foundation
import Testing
@testable import HandoffCore
import HandoffTestSupport

@MainActor private final class AdmissionProbe {
    var otherCopy = false
}

private actor ControlledInstallService: InstallServing {
    private var pending: [Int: CheckedContinuation<InstallReview, any Error>] = [:]
    private var waiters: [Int: CheckedContinuation<Void, Never>] = [:]
    private var applyContinuation: CheckedContinuation<String, any Error>?
    private(set) var calls = 0
    private(set) var approvals: [UUID] = []
    private(set) var discarded: [UUID] = []

    func prepare(_ request: HandoffRequest) async throws -> InstallReview {
        calls += 1
        let index = calls
        return try await withCheckedThrowingContinuation { continuation in
            pending[index] = continuation
            waiters.removeValue(forKey: index)?.resume()
        }
    }
    func prepareRestore() async throws -> InstallReview {
        try await prepare(HandoffRequest(skillID: "fixture", skillName: "fixture"))
    }
    func apply(_ id: UUID) async throws -> String {
        approvals.append(id)
        return try await withCheckedThrowingContinuation { applyContinuation = $0; waiters.removeValue(forKey: 100)?.resume() }
    }
    func discard(_ id: UUID) { discarded.append(id) }
    func wait(_ index: Int) async {
        if index == 100 ? applyContinuation != nil : calls >= index { return }
        await withCheckedContinuation { waiters[index] = $0 }
    }
    func finish(_ index: Int, action: InstallReview.Action = .install) -> UUID {
        let id = UUID()
        pending.removeValue(forKey: index)?.resume(returning: InstallReview(
            id: id, action: action, skillID: "fixture", destination: "/isolated", fromCommit: action == .install ? nil : "A",
            toCommit: "B", fileCount: 1, canRestore: action != .install, changes: []))
        return id
    }
    func applied(failure: Bool = false) {
        if failure { applyContinuation?.resume(throwing: InstallFailure.changed) }
        else { applyContinuation?.resume(returning: "Verified version installed.") }
        applyContinuation = nil
    }
}

@MainActor
struct InstallModelTests {
    let link = "omgskills-helper-test://install?id=anthropics%2Fclaude-plugins-public%3Afrontend-design"

    @Test(arguments: [HandoffRequestPolicy.helper, .test])
    func duplicateLoadingAndCancelledReviewCannotApply(_ policy: HandoffRequestPolicy) async throws {
        let service = ControlledInstallService()
        let link = link.replacingOccurrences(of: "omgskills-helper-test", with: policy.scheme)
        let subject = InstallModel(service: service, requestPolicy: policy)
        subject.open(link); subject.open(link)
        await service.wait(1)
        #expect(await service.calls == 1)
        let task = try #require(subject.task)
        subject.cancel()
        let id = await service.finish(1)
        await task.value
        subject.apply()
        #expect(await service.approvals.isEmpty)
        #expect(await service.discarded.contains(id))
        #expect(subject.review == nil && !subject.isLoading)
    }

    @Test(arguments: [HandoffRequestPolicy.helper, .test])
    func replacementDiscardsLateReview(_ policy: HandoffRequestPolicy) async throws {
        let service = ControlledInstallService()
        let link = link.replacingOccurrences(of: "omgskills-helper-test", with: policy.scheme)
        let model = InstallModel(service: service, requestPolicy: policy)
        model.open(link); await service.wait(1)
        let old = try #require(model.task)
        model.cancel(); model.open(link); await service.wait(2)
        let new = try #require(model.task)
        let latestID = await service.finish(2)
        await new.value
        let oldID = await service.finish(1)
        await old.value
        #expect(model.review?.id == latestID)
        #expect(await service.discarded.contains(oldID))
    }

    @Test(arguments: [false, true], [HandoffRequestPolicy.helper, .test])
    func applyUsesReviewedIDOnceAndBlocksReplacement(_ failure: Bool, _ policy: HandoffRequestPolicy) async throws {
        let service = ControlledInstallService()
        let link = link.replacingOccurrences(of: "omgskills-helper-test", with: policy.scheme)
        let model = InstallModel(service: service, requestPolicy: policy)
        model.open(link); await service.wait(1)
        let load = try #require(model.task)
        let id = await service.finish(1, action: .update); await load.value
        model.apply(); await service.wait(100)
        let applying = try #require(model.task)
        model.apply(); model.cancel(); model.open("bad://url")
        #expect(model.isApplying)
        #expect(model.noticeMessage?.contains("Reopen the link") == true)
        #expect(await service.approvals == [id])
        #expect(await service.calls == 1)
        await service.applied(failure: failure); await applying.value
        #expect(!model.isApplying && model.review == nil)
        #expect(failure ? model.errorMessage != nil : model.message == "Verified version installed.")
        #expect(model.canRestore == !failure)
        #expect(await service.calls == 1)
    }

    @Test func competingCopyInvalidatesConsentBeforeApply() async throws {
        let admission = AdmissionProbe()
        let service = ControlledInstallService()
        let model = InstallModel(service: service) {
            if admission.otherCopy { throw HelperLaunchFailure.otherCopy }
        }
        model.open(link.replacingOccurrences(of: "omgskills-helper-test", with: HelperIdentity.scheme))
        await service.wait(1)
        let task = try #require(model.task)
        _ = await service.finish(1)
        await task.value
        #expect(model.review != nil)
        admission.otherCopy = true
        model.apply()
        #expect(model.review == nil && !model.isApplying)
        #expect(model.errorMessage == HelperLaunchFailure.otherCopy.localizedDescription)
        #expect(await service.approvals.isEmpty)
        admission.otherCopy = false
        model.apply()
        #expect(await service.approvals.isEmpty)
    }

    @Test func fixtureServiceAppliesReviewedAWhileSelectionChangesToB() async throws {
        let sandbox = try InstallSandbox.create(); defer { try? FileManager.default.removeItem(at: sandbox.url) }
        _ = try await InstallHarness.run(["select", sandbox.url.path, "A"])
        let service = try FixtureInstallService(testRoot: sandbox.url.path)
        let review = try await service.prepare(HandoffRequest.parseTest(link)!)
        _ = try await InstallHarness.run(["select", sandbox.url.path, "B"])
        _ = try await service.apply(review.id)
        #expect(try await InstallHarness.run(["inspect", sandbox.url.path]) == String(repeating: "a", count: 40))
        let next = try await service.prepare(HandoffRequest.parseTest(link)!)
        #expect(next.action == .update && next.toCommit == String(repeating: "b", count: 40))
    }

    @Test(arguments: [HandoffRequestPolicy.helper, .test])
    func changingAgentDiscardsOldConsentAndLateResults(_ policy: HandoffRequestPolicy) async throws {
        let codex = ControlledInstallService(), claude = ControlledInstallService()
        let link = link.replacingOccurrences(of: "omgskills-helper-test", with: policy.scheme)
        let model = InstallModel(codex: codex, claude: claude, requestPolicy: policy)
        model.open(link); await codex.wait(1)
        let old = try #require(model.task)
        model.selectAgent(.claude)
        #expect(model.review == nil && model.selectedAgent == .claude)
        model.apply()
        #expect(await codex.approvals.isEmpty)
        await claude.wait(1)
        let new = try #require(model.task)
        let correct = await claude.finish(1); await new.value
        let stale = await codex.finish(1); await old.value
        #expect(model.review?.id == correct)
        #expect(await codex.discarded.contains(stale))
        model.apply(); await claude.wait(100)
        let applying = try #require(model.task)
        model.selectAgent(.codex)
        #expect(model.selectedAgent == .claude)
        #expect(await claude.approvals == [correct])
        #expect(await codex.approvals.isEmpty)
        await claude.applied(); await applying.value
    }

    @Test func simulatedLaunchUsesPersistentDestinationsAndClearsReadyReview() async throws {
        let sandbox = try InstallSandbox.create(); defer { try? FileManager.default.removeItem(at: sandbox.url) }
        _ = try await InstallHarness.run(["select", sandbox.url.path, "A"])
        let model = try #require(try InstallLaunchMode.simulatedHome(sandbox.url.path, fixtures: true).makeModel())
        model.open(link)
        await model.task?.value
        #expect(model.review?.destination.contains("/home/.agents/skills/") == true)
        model.selectAgent(.claude)
        #expect(model.review == nil)
        await model.task?.value
        #expect(model.review?.destination.contains("/home/.claude/skills/") == true)
        model.apply(); await model.task?.value
        #expect(model.errorMessage == nil && model.message != nil)
        #expect(!FileManager.default.fileExists(atPath: sandbox.url.appendingPathComponent("home/.agents/skills/frontend-design").path))
        #expect(FileManager.default.fileExists(atPath: sandbox.url.appendingPathComponent("home/.claude/skills/frontend-design/SKILL.md").path))
    }
}
