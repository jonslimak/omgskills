import Foundation
import Testing
@testable import HandoffCore
import HandoffTestSupport

private let discoveryLink = "omgskills-helper-test://install?id=omgskills%2Flocal-h13%3Aomgskills-h13-check-20261006"
private let publicLink = "omgskills-helper-test://install?id=anthropics%2Fclaude-plugins-public%3Afrontend-design"

private struct DiscoveryHome {
    let sandbox: InstallSandbox
    let home: UserInstallHome
    init() throws {
        sandbox = try InstallSandbox.create()
        home = try .simulated(in: sandbox)
    }
    func erase() { try? FileManager.default.removeItem(at: sandbox.url) }
    func location(_ agent: InstallAgent) -> InstallLocation { .user(home, agent, policy: DiscoveryFixture.policy) }
    func target(_ agent: InstallAgent) -> URL { URL(fileURLWithPath: location(agent).destination) }
    func select(_ version: String) async throws {
        _ = try await InstallHarness.run(["select", sandbox.url.path, version])
    }
    func text(_ agent: InstallAgent) throws -> String {
        try String(contentsOf: target(agent).appendingPathComponent("CHECK.txt"), encoding: .utf8)
    }
}

private struct NoDiscoveryHTTP: PublicHTTPClient {
    func data(for request: URLRequest, limit: Int) async throws -> Data {
        Issue.record("Discovery fixture must not make a network request")
        throw URLError(.unsupportedURL)
    }
}

struct DiscoveryFixtureTests {
    @Test func fixtureRequiresSeparateURLAndLaunchMode() throws {
        #expect(HandoffRequest.parseTest(discoveryLink) == nil)
        #expect(HandoffRequest.parseTest(publicLink, discoveryOnly: true) == nil)
        #expect(HandoffRequest.parseTest(discoveryLink, discoveryOnly: true)?.skillID == DiscoveryFixture.id)
        for suffix in ["&version=B", "&path=/tmp", "#B", "&id=other"] {
            #expect(HandoffRequest.parseTest(discoveryLink + suffix, discoveryOnly: true) == nil)
        }
        let env = ["OMGSKILLS_H13_REAL_INSTALLS": "1", "OMGSKILLS_H13_DISCOVERY_ROOT": "/control"]
        #expect(try InstallLaunchMode.parse(env) == .realDiscovery("/control"))
        #expect(!InstallLaunchMode.realDiscovery("/control").isTest)
        #expect(InstallLaunchMode.realDiscovery("/control").fixtures)
        for invalid in [
            ["OMGSKILLS_H13_DISCOVERY_ROOT": "/control"],
            env.merging(["OMGSKILLS_H12_FIXTURES": "1"]) { _, new in new },
            env.merging(["OMGSKILLS_H1_INSTALL_ROOT": "/other"]) { _, new in new }
        ] { #expect(throws: InstallFailure.unsafeRoot) { try InstallLaunchMode.parse(invalid) } }
        // Never call makeModel() for realHome or realDiscovery in automated tests.
    }

    @Test func strictFixtureBytesAndPublicNetworkBoundary() async throws {
        let a = try DiscoveryFixture.candidate("A")
        try a.validate(policy: DiscoveryFixture.policy)
        #expect(a.package.entries.map(\.path) == ["SKILL.md", "CHECK.txt"])
        #expect(a.package.entries.allSatisfy { $0.mode == "100644" })
        #expect(throws: InstallFailure.invalidRecord) { try a.validate() }
        #expect(throws: InstallFailure.invalidRecord) { try InstallFixtures.candidate("A").validate(policy: DiscoveryFixture.policy) }
        let changed = InstallCandidate(pin: a.pin, package: .init(coordinates: a.package.coordinates,
            entries: a.package.entries.map { entry in
                .init(path: entry.path, mode: entry.mode, data: Data("different bytes".utf8), blobSha: entry.blobSha)
            }))
        #expect(throws: InstallFailure.invalidRecord) { try changed.validate(policy: DiscoveryFixture.policy) }
        let request = try #require(HandoffRequest.parseTest(discoveryLink, discoveryOnly: true))
        await #expect(throws: PreviewFailure.invalidMetadata) {
            try await PublicPackageLoader(http: NoDiscoveryHTTP()).resolve(request)
        }
    }

    @Test(arguments: InstallAgent.allCases)
    func discoveryInstallFrozenReviewUpdateAndRestore(_ agent: InstallAgent) async throws {
        let test = try DiscoveryHome(); defer { test.erase() }
        let service = DiscoveryInstallService(home: test.home, agent: agent, control: test.sandbox)
        let request = try #require(HandoffRequest.parseTest(discoveryLink, discoveryOnly: true))
        let publicRequest = try #require(HandoffRequest.parseTest(publicLink))
        await #expect(throws: InstallFailure.invalidRecord) { try await service.prepare(publicRequest) }
        try await test.select("A")
        let a = try await service.prepare(request)
        #expect(a.destination == test.target(agent).path)
        #expect(a.destination.hasSuffix("/skills/" + DiscoveryFixture.name))
        #expect(!FileManager.default.fileExists(atPath: a.destination))
        try await test.select("B")
        _ = try await service.apply(a.id)
        #expect(try test.text(agent) == "OMGSkills H13 check: A\n")
        let b = try await service.prepare(request)
        #expect(b.action == .update)
        #expect(b.changes.map(\.path) == ["CHECK.txt"])
        #expect(b.changes[0].diff.contains("-OMGSkills H13 check: A"))
        #expect(b.changes[0].diff.contains("+OMGSkills H13 check: B"))
        await service.discard(b.id)
        await #expect(throws: InstallFailure.staleReview) { try await service.apply(b.id) }
        #expect(try test.text(agent) == "OMGSkills H13 check: A\n")
        let fresh = try await service.prepare(request)
        _ = try await service.apply(fresh.id)
        #expect(try test.text(agent) == "OMGSkills H13 check: B\n")
        #expect(try await service.prepare(request).action == .unchanged)
        let restore = try await service.prepareRestore()
        _ = try await service.apply(restore.id)
        #expect(try test.text(agent) == "OMGSkills H13 check: A\n")
    }

    @Test(arguments: InstallAgent.allCases)
    func cleanupOnlyRemovesOwnedTestLinkAndRetainsVersions(_ agent: InstallAgent) async throws {
        let test = try DiscoveryHome(); defer { test.erase() }
        let fm = FileManager.default
        let existing = test.home.url.appendingPathComponent("\(agent.directory)/skills/frontend-design")
        try fm.createDirectory(at: existing, withIntermediateDirectories: true)
        let legacy = test.home.url.appendingPathComponent(".codex/skills/frontend-design")
        try fm.createDirectory(at: legacy, withIntermediateDirectories: true)
        try Data("untouched".utf8).write(to: existing.appendingPathComponent("mine"))
        let store = SandboxInstaller(location: test.location(agent))
        let a = try await store.prepare(DiscoveryFixture.candidate("A"))
        _ = try await store.apply(a.id)
        let content = try fm.destinationOfSymbolicLink(atPath: test.target(agent).path)
        _ = try await store.removeOwnedActivation()
        #expect(try fm.contentsOfDirectory(atPath: test.target(agent).deletingLastPathComponent().path) == ["frontend-design"])
        #expect(fm.fileExists(atPath: content + "/CHECK.txt"))
        #expect(try String(contentsOf: existing.appendingPathComponent("mine"), encoding: .utf8) == "untouched")
        #expect(fm.fileExists(atPath: legacy.path))
        #expect(try await store.removeOwnedActivation() == "Test skill is not installed.")
        await #expect(throws: InstallFailure.unmanaged) {
            try await SandboxInstaller(location: .user(test.home, agent)).removeOwnedActivation()
        }
    }

    @Test(arguments: ["local-edit", "foreign-link", "legacy-collision"])
    func unsafeStateBlocksCleanupAndUpdate(_ kind: String) async throws {
        let test = try DiscoveryHome(); defer { test.erase() }
        let store = SandboxInstaller(location: test.location(.codex))
        let a = try await store.prepare(DiscoveryFixture.candidate("A"))
        _ = try await store.apply(a.id)
        let target = test.target(.codex)
        let fm = FileManager.default
        if kind == "local-edit" {
            try Data("my edit".utf8).write(to: target.appendingPathComponent("CHECK.txt"))
        } else if kind == "foreign-link" {
            try fm.removeItem(at: target)
            try fm.createSymbolicLink(at: target, withDestinationURL: test.sandbox.url)
        } else {
            try fm.createDirectory(at: test.home.url.appendingPathComponent(".codex/skills/" + DiscoveryFixture.name),
                                   withIntermediateDirectories: true)
        }
        let error: InstallFailure = kind == "local-edit" ? .changed : .unmanaged
        await #expect(throws: error) { try await store.removeOwnedActivation() }
        await #expect(throws: error) { try await store.prepare(DiscoveryFixture.candidate("B")) }
        #expect(fm.fileExists(atPath: target.path))
        if kind == "local-edit" { #expect(try test.text(.codex) == "my edit") }
    }

    @MainActor @Test func modelRejectsPublicLinksAndSelectsOnlyTestTargets() async throws {
        let test = try DiscoveryHome(); defer { test.erase() }
        try await test.select("A")
        let model = InstallModel(
            codex: DiscoveryInstallService(home: test.home, agent: .codex, control: test.sandbox),
            claude: DiscoveryInstallService(home: test.home, agent: .claude, control: test.sandbox), requestPolicy: .discovery)
        model.open(publicLink)
        #expect(model.review == nil && model.errorMessage != nil)
        model.open(discoveryLink)
        await model.task?.value
        #expect(model.review?.destination == test.target(.codex).path)
        model.selectAgent(.claude)
        await model.task?.value
        #expect(model.review?.destination == test.target(.claude).path)
        model.cancel()
        #expect(!FileManager.default.fileExists(atPath: test.target(.codex).path))
        #expect(!FileManager.default.fileExists(atPath: test.target(.claude).path))
    }

    @Test func harnessRequiresExplicitRealHomeArgument() async {
        for command in ["discovery-inspect", "discovery-remove"] {
            await #expect(throws: InstallFailure.invalidRecord) {
                try await InstallHarness.run([command, "/not-a-control", "codex"])
            }
        }
    }
}
