import Foundation
import Testing
@testable import HandoffCore
import HandoffTestSupport

private actor ControlledPreviewService: PackagePreviewLoading {
    private(set) var count = 0
    private var pending: [Int: CheckedContinuation<PackagePreview, any Error>] = [:]
    private var started: [Int: CheckedContinuation<Void, Never>] = [:]

    func preview(_ request: HandoffRequest) async throws -> PackagePreview {
        count += 1
        let index = count
        return try await withCheckedThrowingContinuation { continuation in
            pending[index] = continuation
            started.removeValue(forKey: index)?.resume()
        }
    }

    func waitForCall(_ number: Int) async {
        if count >= number { return }
        await withCheckedContinuation { started[number] = $0 }
    }

    func succeed(_ number: Int, id: String = "fixture") {
        pending.removeValue(forKey: number)?.resume(returning: PackagePreview(
            skillID: id, repo: "test/repo", path: "skill", commit: String(repeating: "1", count: 40),
            treeSHA: String(repeating: "2", count: 40), skillSHA: String(repeating: "3", count: 40),
            totalBytes: 0, files: []
        ))
    }

    func fail(_ number: Int, error: any Error) { pending.removeValue(forKey: number)?.resume(throwing: error) }
}

@MainActor
struct PreviewModelTests {
    let link = "omgskills-helper-test://install?id=anthropics%2Fclaude-plugins-public%3Afrontend-design"
    let other = "omgskills-helper-test://install?id=anthropics%2Fskills%3Askills%2Ffrontend-design"

    @Test func repeatedClickReusesLoadingAndCompletedPreview() async throws {
        let service = ControlledPreviewService()
        let model = PreviewModel(service: service, requestPolicy: .test)
        model.open(link)
        model.open(link)
        await service.waitForCall(1)
        #expect(await service.count == 1)
        let task = try #require(model.task)
        await service.succeed(1)
        await task.value
        model.open(link)
        #expect(await service.count == 1)
        #expect(model.preview != nil)
        #expect(!model.isLoading)
        model.cancel()
        #expect(model.preview == nil)
    }

    @Test func cancelDiscardsLateSuccess() async throws {
        let service = ControlledPreviewService()
        let model = PreviewModel(service: service, requestPolicy: .test)
        model.open(link)
        await service.waitForCall(1)
        let task = try #require(model.task)
        model.cancel()
        #expect(task.isCancelled)
        await service.succeed(1)
        await task.value
        #expect(model.preview == nil)
        #expect(model.request == nil)
        #expect(!model.isLoading)
        #expect(model.errorMessage == nil)
    }

    @Test func replacementIgnoresPreviousCompletion() async throws {
        let service = ControlledPreviewService()
        let model = PreviewModel(service: service, requestPolicy: .test)
        model.open(link)
        await service.waitForCall(1)
        let first = try #require(model.task)
        model.open(other)
        await service.waitForCall(2)
        let second = try #require(model.task)
        await service.succeed(2, id: "second")
        await second.value
        await service.succeed(1, id: "first")
        await first.value
        #expect(model.preview?.skillID == "second")
        #expect(!model.isLoading)
    }

    @Test func invalidLinkCancelsPreviousDownloadWithoutStartingAnother() async throws {
        let service = ControlledPreviewService()
        let model = PreviewModel(service: service, requestPolicy: .test)
        model.open(link)
        await service.waitForCall(1)
        let task = try #require(model.task)
        model.open(link + "&url=https://evil.example")
        await service.succeed(1)
        await task.value
        #expect(model.preview == nil)
        #expect(model.errorMessage?.hasPrefix("Invalid") == true)
        #expect(await service.count == 1)
    }

    @Test func timeoutShowsFailureAndAllowsRetry() async throws {
        let service = ControlledPreviewService()
        let model = PreviewModel(service: service, requestPolicy: .test)
        model.open(link)
        await service.waitForCall(1)
        let first = try #require(model.task)
        await service.fail(1, error: URLError(.timedOut))
        await first.value
        #expect(model.errorMessage == "The download timed out. Try again.")
        model.open(link)
        await service.waitForCall(2)
        let second = try #require(model.task)
        await service.succeed(2)
        await second.value
        #expect(model.errorMessage == nil)
        #expect(model.preview != nil)
    }
}
