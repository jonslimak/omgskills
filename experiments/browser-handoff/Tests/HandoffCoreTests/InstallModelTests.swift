import Foundation
import Testing
@testable import HandoffCore

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

    @Test func duplicateLoadingAndCancelledReviewCannotApply() async throws {
        let service = ControlledInstallService()
        let subject = InstallModel(service: service)
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

    @Test func replacementDiscardsLateReview() async throws {
        let service = ControlledInstallService()
        let model = InstallModel(service: service)
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

    @Test(arguments: [false, true])
    func applyUsesReviewedIDOnceAndBlocksReplacement(_ failure: Bool) async throws {
        let service = ControlledInstallService()
        let model = InstallModel(service: service)
        model.open(link); await service.wait(1)
        let load = try #require(model.task)
        let id = await service.finish(1, action: .update); await load.value
        model.apply(); await service.wait(100)
        let applying = try #require(model.task)
        model.apply(); model.cancel(); model.open("bad://url")
        #expect(model.isApplying)
        #expect(await service.approvals == [id])
        #expect(await service.calls == 1)
        await service.applied(failure: failure); await applying.value
        #expect(!model.isApplying && model.review == nil)
        #expect(failure ? model.errorMessage != nil : model.message == "Verified version installed.")
        #expect(model.canRestore == !failure)
    }

    @Test func fixtureServiceAppliesReviewedAWhileSelectionChangesToB() async throws {
        let sandbox = try InstallSandbox.create(); defer { try? FileManager.default.removeItem(at: sandbox.url) }
        _ = try await InstallHarness.run(["select", sandbox.url.path, "A"])
        let service = try PublicInstallService(testRoot: sandbox.url.path, fixtures: true)
        let review = try await service.prepare(HandoffRequest.parse(link)!)
        _ = try await InstallHarness.run(["select", sandbox.url.path, "B"])
        _ = try await service.apply(review.id)
        #expect(try await InstallHarness.run(["inspect", sandbox.url.path]) == String(repeating: "a", count: 40))
        let next = try await service.prepare(HandoffRequest.parse(link)!)
        #expect(next.action == .update && next.toCommit == String(repeating: "b", count: 40))
    }
}
