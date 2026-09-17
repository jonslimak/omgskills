import Foundation
import Testing
@testable import omgskills

struct CatalogSkillInstallerTests {
    @Test func sharedCrawlerFixturesDecodeAsCompleteAndLegacy() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let skills = try decoder.decode([Skill].self, from: Data(contentsOf: sharedFixtureURL))

        #expect(skills.count == 3)
        guard case .complete(let root) = skills[0].pinnedInstallMetadataState else {
            Issue.record("Expected the root fixture to contain complete pinned metadata")
            return
        }
        guard case .complete(let nested) = skills[1].pinnedInstallMetadataState else {
            Issue.record("Expected the nested fixture to contain complete pinned metadata")
            return
        }
        #expect(root.packageRoot == ".")
        #expect(nested.packageRoot == "skills/example")
        #expect(skills[2].pinnedInstallMetadataState == .legacy)
    }

    @Test func partialOrUnsafePinnedMetadataIsInvalid() {
        #expect(makeSkill(repoCommitSha: nil).pinnedInstallMetadataState == .invalid)
        #expect(makeSkill(installTargetName: "../example").pinnedInstallMetadataState == .invalid)
        #expect(makeSkill(installTargetName: "example/name").pinnedInstallMetadataState == .invalid)
        #expect(makeSkill(skillMdPath: "skills/../SKILL.md").pinnedInstallMetadataState == .invalid)
    }

    @Test func legacyMetadataUsesOnlyTheLegacyInstaller() async throws {
        let fixture = try InstallFixture()
        defer { fixture.remove() }
        let fetcher = RecordingPackageFetcher(package: GroupSkillPackageTestSupport.package)
        let legacy = LegacyInstallRecorder()
        let installer = fixture.installer(fetcher: fetcher, legacy: legacy)

        try await installer.install(makeLegacySkill(), target: .claude)

        #expect(await legacy.callCount() == 1)
        #expect(await fetcher.callCount() == 0)
    }

    @Test func invalidMetadataFailsBeforeNetworkOrLegacyFallback() async throws {
        let fixture = try InstallFixture()
        defer { fixture.remove() }
        let fetcher = RecordingPackageFetcher(package: GroupSkillPackageTestSupport.package)
        let legacy = LegacyInstallRecorder()
        let installer = fixture.installer(fetcher: fetcher, legacy: legacy)

        await #expect(throws: CatalogSkillInstaller.InstallError.invalidPinnedMetadata) {
            try await installer.install(makeSkill(repoCommitSha: nil), target: .claude)
        }

        #expect(await fetcher.callCount() == 0)
        #expect(await legacy.callCount() == 0)
        #expect(fixture.installedSkillExists == false)
    }

    @Test func rootPackageInstallsThroughValidatedManagedPath() async throws {
        try await assertPinnedInstall(skillMDPath: "SKILL.md", expectedRoot: ".")
    }

    @Test func nestedPackageInstallsThroughValidatedManagedPath() async throws {
        try await assertPinnedInstall(
            skillMDPath: "skills/example/SKILL.md",
            expectedRoot: "skills/example"
        )
    }

    @Test func hashMismatchDoesNotFallbackOrLeavePartialInstallation() async throws {
        let fixture = try InstallFixture()
        defer { fixture.remove() }
        let fetcher = RecordingPackageFetcher(package: GroupSkillPackageTestSupport.package)
        let legacy = LegacyInstallRecorder()
        let installer = fixture.installer(fetcher: fetcher, legacy: legacy)
        let skill = makeSkill(skillTreeSha: String(repeating: "f", count: 40))

        await #expect(throws: SkillPackageValidationError.self) {
            try await installer.install(skill, target: .claude)
        }

        #expect(await legacy.callCount() == 0)
        #expect(fixture.installedSkillExists == false)
        #expect(fixture.stagingIsEmpty)
    }

    @Test func cancellationDoesNotFallbackOrLeavePartialInstallation() async throws {
        let fixture = try InstallFixture()
        defer { fixture.remove() }
        let legacy = LegacyInstallRecorder()
        let installer = fixture.installer(fetcher: CancellingPackageFetcher(), legacy: legacy)

        await #expect(throws: CancellationError.self) {
            try await installer.install(makeSkill(), target: .claude)
        }

        #expect(await legacy.callCount() == 0)
        #expect(fixture.installedSkillExists == false)
        #expect(fixture.stagingIsEmpty)
    }

    @Test func sharedManagedActorPreventsCatalogAndGroupMutationsFromOverlapping() async throws {
        let fixture = try InstallFixture()
        defer { fixture.remove() }
        let fetcher = SuspendedPackageFetcher()
        let installer = fixture.installer(fetcher: fetcher, legacy: LegacyInstallRecorder())
        let catalogTask = Task {
            try await installer.install(makeSkill(), target: .claude)
        }
        await fetcher.waitUntilStarted()

        await #expect(throws: ManagedSkillInstaller.InstallError.operationInProgress) {
            try await fixture.managedInstaller.install(fixture.directManagedRequest) {
                GroupSkillPackageTestSupport.package
            }
        }

        await fetcher.resume(with: GroupSkillPackageTestSupport.package)
        try await catalogTask.value
        #expect(fixture.installedSkillExists)
    }

    private func assertPinnedInstall(skillMDPath: String, expectedRoot: String) async throws {
        let fixture = try InstallFixture()
        defer { fixture.remove() }
        let fetcher = RecordingPackageFetcher(package: GroupSkillPackageTestSupport.package)
        let legacy = LegacyInstallRecorder()
        let installer = fixture.installer(fetcher: fetcher, legacy: legacy)

        try await installer.install(makeSkill(skillMdPath: skillMDPath), target: .claude)

        #expect(fixture.installedSkillExists)
        #expect(await fetcher.roots() == [expectedRoot])
        #expect(await fetcher.expectedCoordinates() == [GroupSkillPackageTestSupport.coordinates])
        #expect(await legacy.callCount() == 0)
    }

    private var sharedFixtureURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("index/scraper/new-crawl/fixtures/pinned-install-skills.json")
    }
}

private struct InstallFixture {
    let root: URL
    let managedRoot: URL
    let claudeRoot: URL
    let codexRoot: URL
    let managedInstaller: ManagedSkillInstaller

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("omgskills-catalog-installer-\(UUID().uuidString)", isDirectory: true)
        managedRoot = root.appendingPathComponent("managed", isDirectory: true)
        claudeRoot = root.appendingPathComponent("claude", isDirectory: true)
        codexRoot = root.appendingPathComponent("codex", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        managedInstaller = ManagedSkillInstaller(managedRoot: managedRoot, pathAnchor: root)
    }

    var installedSkillExists: Bool {
        FileManager.default.fileExists(
            atPath: claudeRoot.appendingPathComponent("example/SKILL.md").path
        )
    }

    var stagingIsEmpty: Bool {
        let staging = managedRoot.appendingPathComponent("staging", isDirectory: true)
        return (try? FileManager.default.contentsOfDirectory(atPath: staging.path).isEmpty) ?? true
    }

    var directManagedRequest: ManagedSkillInstallRequest {
        ManagedSkillInstallRequest(
            sourceKind: .catalog,
            sourceId: "owner/repo:group-example",
            releaseId: "group-release",
            groupRevision: nil,
            catalogSkillId: "owner/repo:group-example",
            githubUrl: "https://github.com/owner/repo",
            expectedCoordinates: GroupSkillPackageTestSupport.coordinates,
            mode: .snapshot,
            destination: ManagedSkillDestination(
                agent: .codex,
                scope: .userGlobal,
                rootIdentifier: "codex-user-global",
                rootURL: codexRoot,
                targetName: "group-example"
            )
        )
    }

    func installer(
        fetcher: any PublicSkillPackageFetching,
        legacy: LegacyInstallRecorder
    ) -> CatalogSkillInstaller {
        let claudeRoot = claudeRoot
        let codexRoot = codexRoot
        return CatalogSkillInstaller(
            packageFetcher: fetcher,
            managedInstaller: managedInstaller,
            legacyInstall: { skill, target in
                await legacy.record(skill: skill, target: target)
            },
            destinationBuilder: { target, targetName in
                ManagedSkillDestination(
                    agent: target == .claude ? .claude : .codex,
                    scope: .userGlobal,
                    rootIdentifier: target == .claude ? "claude-user-global" : "codex-user-global",
                    rootURL: target == .claude ? claudeRoot : codexRoot,
                    targetName: targetName
                )
            }
        )
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }
}

private actor RecordingPackageFetcher: PublicSkillPackageFetching {
    private let package: SkillPackage
    private var recordedRoots: [String] = []
    private var recordedCoordinates: [SkillPackageCoordinates] = []

    init(package: SkillPackage) {
        self.package = package
    }

    func fetchPackage(
        repositorySlug: String,
        normalizedRoot: String,
        expected: SkillPackageCoordinates
    ) async throws -> SkillPackage {
        recordedRoots.append(normalizedRoot)
        recordedCoordinates.append(expected)
        return package
    }

    func callCount() -> Int { recordedRoots.count }
    func roots() -> [String] { recordedRoots }
    func expectedCoordinates() -> [SkillPackageCoordinates] { recordedCoordinates }
}

private struct CancellingPackageFetcher: PublicSkillPackageFetching {
    func fetchPackage(
        repositorySlug: String,
        normalizedRoot: String,
        expected: SkillPackageCoordinates
    ) async throws -> SkillPackage {
        throw CancellationError()
    }
}

private actor SuspendedPackageFetcher: PublicSkillPackageFetching {
    private var started = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private var packageContinuation: CheckedContinuation<SkillPackage, any Error>?

    func fetchPackage(
        repositorySlug: String,
        normalizedRoot: String,
        expected: SkillPackageCoordinates
    ) async throws -> SkillPackage {
        started = true
        startWaiters.forEach { $0.resume() }
        startWaiters.removeAll()
        return try await withCheckedThrowingContinuation { continuation in
            packageContinuation = continuation
        }
    }

    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { continuation in
            startWaiters.append(continuation)
        }
    }

    func resume(with package: SkillPackage) {
        packageContinuation?.resume(returning: package)
        packageContinuation = nil
    }
}

private actor LegacyInstallRecorder {
    private var calls: [(String, SkillInstaller.Target)] = []

    func record(skill: Skill, target: SkillInstaller.Target) {
        calls.append((skill.id, target))
    }

    func callCount() -> Int { calls.count }
}

private func makeSkill(
    repoSlug: String? = "owner/repo",
    skillMdPath: String? = "skills/example/SKILL.md",
    repoCommitSha: String? = GroupSkillPackageTestSupport.commitSha,
    skillTreeSha: String? = GroupSkillPackageTestSupport.treeSha,
    skillMdSha: String? = GroupSkillPackageTestSupport.skillMdSha,
    installTargetName: String? = "example"
) -> Skill {
    Skill(
        id: "owner/repo:example",
        name: "example",
        description: "Example",
        githubUrl: "https://github.com/owner/repo",
        installCmd: "git clone https://github.com/owner/repo /tmp/repo && ln -s /tmp/repo/skills/example ~/.claude/skills/example",
        authorHandle: "owner",
        tags: [],
        readmeSnippet: nil,
        stars: 1,
        lastUpdated: "2026-09-17T00:00:00Z",
        firstSeen: "2026-09-17",
        skillMdSha: skillMdSha,
        repoSlug: repoSlug,
        skillMdPath: skillMdPath,
        repoCommitSha: repoCommitSha,
        skillTreeSha: skillTreeSha,
        installTargetName: installTargetName,
        installs: nil,
        trendingRank: nil,
        trendingSource: nil,
        origin: nil,
        isSymlink: nil,
        isLocalOnly: nil
    )
}

private func makeLegacySkill() -> Skill {
    Skill(
        id: "owner/repo:legacy",
        name: "legacy",
        description: "Legacy",
        githubUrl: "https://github.com/owner/repo",
        installCmd: "git clone https://github.com/owner/repo ~/.claude/skills/legacy",
        authorHandle: "owner",
        tags: [],
        readmeSnippet: nil,
        stars: 1,
        lastUpdated: "2026-09-17T00:00:00Z",
        firstSeen: "2026-09-17",
        skillMdSha: GroupSkillPackageTestSupport.skillMdSha,
        installs: nil,
        trendingRank: nil,
        trendingSource: nil,
        origin: nil,
        isSymlink: nil,
        isLocalOnly: nil
    )
}
