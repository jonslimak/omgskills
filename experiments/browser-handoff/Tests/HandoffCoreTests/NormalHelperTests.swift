import Foundation
import Testing
@testable import HandoffCore
import HandoffTestSupport

private actor ImmediateService: InstallServing {
    private(set) var calls = 0
    func prepare(_ request: HandoffRequest) -> InstallReview {
        calls += 1
        return InstallReview(id: UUID(), action: .install, skillID: request.skillID,
                             destination: "/isolated", fromCommit: nil, toCommit: "A",
                             fileCount: 1, canRestore: false, changes: [])
    }
    func prepareRestore() throws -> InstallReview { throw InstallFailure.noBackup }
    func apply(_ id: UUID) -> String { "Test applied" }
    func discard(_ id: UUID) {}
}

// The production factory is synchronous. Protect the test counter across actors.
private final class FactoryProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var attempts = 0
    let failFirst: Bool
    let service = ImmediateService()
    init(failFirst: Bool = false) { self.failFirst = failFirst }
    var count: Int { lock.withLock { attempts } }
    func make() throws -> any InstallServing {
        try lock.withLock {
            attempts += 1
            if failFirst && attempts == 1 { throw InstallFailure.invalidRecord }
            return service
        }
    }
}

struct NormalHelperTests {
    private let link = "omgskills-helper://install?id=anthropics%2Fclaude-plugins-public%3Afrontend-design"

    @Test func identitiesAndSchemesAreSeparate() throws {
        let normal = try #require(HandoffRequest.parse(link))
        #expect(normal.skillID == HandoffRequest.pinnedTestSkillID)
        #expect(HandoffRequest.parse(link, policy: .test) == nil)
        let test = link.replacingOccurrences(of: "omgskills-helper:", with: "omgskills-helper-test:")
        #expect(HandoffRequest.parse(test) == nil)
        #expect(HandoffRequest.parse(test, policy: .test) == normal)
        #expect(HandoffRequest.parse("omgskills-helper://install?id=\(DiscoveryFixture.id)") == nil)
        #expect(throws: HelperLaunchFailure.invalidBundle) {
            try HelperIdentity.verify(bundleID: "com.omgskills.browser-handoff-test", currentPID: 1, runningPIDs: [])
        }
        #expect(throws: HelperLaunchFailure.invalidBundle) {
            try HelperIdentity.verify(bundleID: nil, currentPID: 1, runningPIDs: [])
        }
        try HelperIdentity.verify(bundleID: HelperIdentity.bundleID, currentPID: 1, runningPIDs: [])
        try HelperIdentity.verify(bundleID: HelperIdentity.bundleID, currentPID: 1, runningPIDs: [1])
        #expect(throws: HelperLaunchFailure.otherCopy) {
            try HelperIdentity.verify(bundleID: HelperIdentity.bundleID, currentPID: 1, runningPIDs: [1, 2])
        }
    }

    @Test(arguments: ["&agent=claude", "&mode=test", "&root=/tmp/test", "&endpoint=https://example.com",
                       "&id=other", "#callback", "&command=touch", "&x=%ZZ"])
    func browserCannotSelectLaunchSettings(_ suffix: String) {
        #expect(HandoffRequest.parse(link + suffix) == nil)
    }

    @Test func serviceIsLazyAndInvalidRequestsNeverCreateStorage() async throws {
        let probe = FactoryProbe()
        let service = UserInstallService(makeService: probe.make)
        #expect(probe.count == 0)
        await service.discard(UUID())
        await #expect(throws: InstallFailure.noBackup) { try await service.prepareRestore() }
        await #expect(throws: InstallFailure.staleReview) { try await service.apply(UUID()) }
        await #expect(throws: InstallFailure.invalidRecord) {
            try await service.prepare(HandoffRequest(skillID: DiscoveryFixture.id, skillName: "fixture"))
        }
        #expect(probe.count == 0)
        let request = try #require(HandoffRequest.parse(link))
        _ = try await service.prepare(request)
        _ = try await service.prepare(request)
        #expect(probe.count == 1)
        #expect(await probe.service.calls == 2)
    }

    @Test func factoryFailureDoesNotFallbackAndRetryIsExplicit() async throws {
        let probe = FactoryProbe(failFirst: true)
        let service = UserInstallService(makeService: probe.make)
        let request = try #require(HandoffRequest.parse(link))
        await #expect(throws: InstallFailure.invalidRecord) { try await service.prepare(request) }
        #expect(probe.count == 1)
        #expect(await probe.service.calls == 0)
        _ = try await service.prepare(request)
        #expect(probe.count == 2)
        #expect(await probe.service.calls == 1)
    }

    @Test func cancelledRequestDoesNotCreateStorage() async throws {
        let probe = FactoryProbe()
        let service = UserInstallService(makeService: probe.make)
        let request = try #require(HandoffRequest.parse(link))
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await service.prepare(request)
        }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(probe.count == 0)
    }

    @MainActor @Test func emptyLaunchAgentChoiceAndWrongSchemeDoNotCreateStorage() async throws {
        let codex = FactoryProbe(), claude = FactoryProbe()
        let model = InstallModel(codex: UserInstallService(makeService: codex.make),
                                 claude: UserInstallService(makeService: claude.make))
        #expect(model.review == nil && model.task == nil && !model.isLoading)
        model.selectAgent(.claude)
        model.open(link.replacingOccurrences(of: "omgskills-helper:", with: "omgskills-helper-test:"))
        model.open("omgskills-helper://install?id=\(DiscoveryFixture.id)")
        #expect(model.errorMessage != nil && model.task == nil)
        #expect(codex.count == 0 && claude.count == 0)
        model.open(link)
        await model.task?.value
        #expect(model.review != nil)
        #expect(codex.count == 0 && claude.count == 1)
        model.cancel()
        model.apply()
        #expect(model.review == nil && !model.isApplying)
    }

    @MainActor @Test func competingCopyBlocksBeforeServiceCreation() {
        let probe = FactoryProbe()
        let model = InstallModel(service: UserInstallService(makeService: probe.make)) {
            throw HelperLaunchFailure.otherCopy
        }
        model.open(link)
        #expect(model.errorMessage == HelperLaunchFailure.otherCopy.localizedDescription)
        #expect(model.task == nil && probe.count == 0)
    }
}
