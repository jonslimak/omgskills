import Foundation
import Testing
@testable import omgskills

struct CatalogInstallServiceTests {
    @Test(arguments: [SkillInstaller.Target.claude, .codex], [".", "skills/design"])
    func legacyInstallsPreserveAliasesAndAllFiles(_ target: SkillInstaller.Target, _ relative: String) async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let skill = legacy(relative: relative)
        let service = fixture.service(git: fixture.git(relative: relative))
        #expect(await service.install(skill, target: target) == .installed)
        let root = fixture.paths.skillsRoot(for: target)
        let destination = root.appendingPathComponent("old-alias")
        let cache = fixture.paths.legacyRepoCacheRoot.appendingPathComponent("owner--repo")
        let source = relative == "." ? cache : cache.appendingPathComponent(relative)
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: destination.path) == source.path)
        #expect(try Data(contentsOf: destination.appendingPathComponent("asset.bin")) == Data([0, 255, 13, 10]))
        #expect(try Data(contentsOf: destination.appendingPathComponent("large.txt")).count == 150_000)
        let metadata = SkillInstallProvenanceStore.metadataURL(targetRoot: root, targetName: "old-alias")
        let original = try Data(contentsOf: metadata)
        try Data("local edit\n".utf8).write(to: destination.appendingPathComponent("SKILL.md"))
        #expect(await service.install(skill, target: target) == .alreadyInstalled)
        #expect(try Data(contentsOf: metadata) == original)
        #expect(try String(contentsOf: destination.appendingPathComponent("SKILL.md"), encoding: .utf8) == "local edit\n")
        #expect(!CatalogInstallFilesystem.exists(root.appendingPathComponent("design")))
    }

    @Test(arguments: [SkillInstaller.Target.claude, .codex])
    func pinnedInstallsRemainValidatedAndRepeatsAreReadOnly(_ target: SkillInstaller.Target) async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let service = fixture.service()
        let skill = pinned()
        #expect(await service.install(skill, target: target) == .installed)
        let destination = fixture.paths.skillsRoot(for: target).appendingPathComponent("old-alias")
        let link = try FileManager.default.destinationOfSymbolicLink(atPath: destination.path)
        let provenance = try #require(SkillInstallProvenanceStore.read(targetRoot: destination.deletingLastPathComponent(), targetName: "old-alias"))
        #expect(provenance.catalogSkillId == skill.id)
        #expect(provenance.commitSha == GroupSkillPackageTestSupport.commitSha)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: destination.appendingPathComponent("SKILL.md").path)
        try Data("local edit\n".utf8).write(to: destination.appendingPathComponent("SKILL.md"))
        #expect(await service.install(skill, target: target) == .alreadyInstalled)
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: destination.path) == link)
        #expect(SkillInstallProvenanceStore.read(targetRoot: destination.deletingLastPathComponent(), targetName: "old-alias") == provenance)
    }

    @Test(arguments: ["directory", "broken-link", "record", "wrong-source", "redirected-root"])
    func existingUnknownStateIsNeverOverwritten(_ kind: String) async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let root = fixture.paths.codexSkillsRoot
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let target = root.appendingPathComponent("old-alias")
        let service = fixture.service(gitProvider: { throw TestFailure.mustNotRun })
        switch kind {
        case "directory":
            try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
            try Data("local".utf8).write(to: target.appendingPathComponent("SKILL.md"))
        case "broken-link": try FileManager.default.createSymbolicLink(at: target, withDestinationURL: fixture.root.appendingPathComponent("missing"))
        case "record":
            try FileManager.default.createDirectory(at: root.appendingPathComponent(".omgskills"), withIntermediateDirectories: true)
            try Data("untouched".utf8).write(to: SkillInstallProvenanceStore.metadataURL(targetRoot: root, targetName: "old-alias"))
        case "wrong-source":
            let installer = fixture.service(git: fixture.git())
            #expect(await installer.install(legacy(), target: .codex) == .installed)
            try SkillInstallProvenanceStore.write(catalogSkillId: "another/skill", githubUrl: "https://github.com/another/repo",
                skillMdSha: "old", targetRoot: root, targetName: "old-alias")
        default:
            try FileManager.default.removeItem(at: root)
            let external = fixture.root.appendingPathComponent("external")
            try FileManager.default.createDirectory(at: external, withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: root, withDestinationURL: external)
        }
        let before = try fixture.snapshot()
        #expect(await service.install(legacy(), target: .codex) == .conflict)
        #expect(try fixture.snapshot() == before)
    }

    @Test func invalidPinsAndMissingGitDoNotCreateAnything() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let service = fixture.service(gitProvider: { throw SkillInstaller.InstallError.missingGit })
        #expect(await service.install(legacy(), target: .claude) == .needsGit)
        let partial = try catalogRecord(extra: ",\"repo_commit_sha\":\"broken\"").skill
        #expect(await service.install(partial, target: .claude) == .unavailable)
        #expect(try fixture.snapshot().isEmpty)
    }

    @Test(arguments: ["../escape", "nested/name", ".hidden"])
    func unsafeDestinationIsRefusedBeforeWork(_ name: String) async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let service = fixture.service(gitProvider: { throw TestFailure.mustNotRun })
        #expect(await service.install(legacy(name: name), target: .claude) == .unavailable)
        #expect(try fixture.snapshot().isEmpty)
    }

    @Test func provenanceFailureRemovesOnlyNewLinkAndKeepsCache() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let root = fixture.paths.claudeSkillsRoot
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let unrelated = root.appendingPathComponent("unrelated.txt")
        try Data("keep".utf8).write(to: unrelated)
        let service = fixture.service(git: fixture.git(), writer: { _, _, _, _ in throw TestFailure.record })
        guard case .failed = await service.install(legacy(), target: .claude) else { Issue.record("Expected record failure"); return }
        #expect(!CatalogInstallFilesystem.exists(root.appendingPathComponent("old-alias")))
        #expect(try Data(contentsOf: unrelated) == Data("keep".utf8))
        #expect(FileManager.default.fileExists(atPath: fixture.paths.legacyRepoCacheRoot.appendingPathComponent("owner--repo/SKILL.md").path))
        #expect(await fixture.service(git: fixture.git()).install(legacy(), target: .claude) == .installed)
    }

    @Test func cleanupDoesNotRemoveAReplacementItNoLongerOwns() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let service = fixture.service(git: fixture.git(), writer: { _, root, name, _ in
            let destination = root.appendingPathComponent(name)
            try FileManager.default.removeItem(at: destination)
            try Data("other entry".utf8).write(to: destination)
            throw TestFailure.record
        })
        guard case .failed(let message) = await service.install(legacy(), target: .codex) else { Issue.record("Expected failure"); return }
        #expect(message.contains("cleanup was incomplete"))
        #expect(try Data(contentsOf: fixture.paths.codexSkillsRoot.appendingPathComponent("old-alias")) == Data("other entry".utf8))
    }

    @Test func failedFirstCloneIsRemovedAndRetryWorks() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let broken = FixtureGit { arguments in
            let repo = URL(fileURLWithPath: arguments.last!)
            try FileManager.default.createDirectory(at: repo.appendingPathComponent(".git"), withIntermediateDirectories: true)
            throw TestFailure.clone
        }
        guard case .failed = await fixture.service(git: broken).install(legacy(), target: .codex) else { Issue.record("Expected clone failure"); return }
        #expect(!CatalogInstallFilesystem.exists(fixture.paths.legacyRepoCacheRoot.appendingPathComponent("owner--repo")))
        #expect(await fixture.service(git: fixture.git()).install(legacy(), target: .codex) == .installed)
    }

    @Test func legacyRacingDestinationAndRecordArePreserved() async throws {
        for kind in ["destination", "record"] {
            let fixture = try Fixture()
            defer { fixture.remove() }
            let git = fixture.git(afterClone: {
                let root = fixture.paths.codexSkillsRoot
                if kind == "destination" {
                    try Data("other entry".utf8).write(to: root.appendingPathComponent("old-alias"))
                } else {
                    try FileManager.default.createDirectory(at: root.appendingPathComponent(".omgskills"), withIntermediateDirectories: true)
                    try Data("other record".utf8).write(to: SkillInstallProvenanceStore.metadataURL(targetRoot: root, targetName: "old-alias"))
                }
            })
            #expect(await fixture.service(git: git).install(legacy(), target: .codex) == .conflict)
            if kind == "destination" {
                #expect(try Data(contentsOf: fixture.paths.codexSkillsRoot.appendingPathComponent("old-alias")) == Data("other entry".utf8))
            } else {
                #expect(!CatalogInstallFilesystem.exists(fixture.paths.codexSkillsRoot.appendingPathComponent("old-alias")))
                #expect(try Data(contentsOf: SkillInstallProvenanceStore.metadataURL(targetRoot: fixture.paths.codexSkillsRoot, targetName: "old-alias")) == Data("other record".utf8))
            }
        }
    }

    @Test func pinnedRacingDestinationIsNotReplaced() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let destination = fixture.paths.codexSkillsRoot.appendingPathComponent("old-alias")
        let managed = ManagedSkillInstaller(managedRoot: fixture.root.appendingPathComponent("managed"),
            pathAnchor: fixture.paths.homeDirectory, beforeActivationSwitch: {
                try Data("other entry".utf8).write(to: destination)
            })
        let service = fixture.service(managed: managed)
        #expect(await service.install(pinned(), target: .codex) == .conflict)
        #expect(try Data(contentsOf: destination) == Data("other entry".utf8))
    }

    @Test func pinnedHashFailureCannotFallBackToLegacy() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let service = fixture.service(fetcher: FixtureFetcher(fail: true))
        guard case .failed = await service.install(pinned(), target: .claude) else { Issue.record("Expected pinned failure"); return }
        #expect(!CatalogInstallFilesystem.exists(fixture.paths.legacyRepoCacheRoot))
        #expect(!CatalogInstallFilesystem.exists(fixture.paths.claudeSkillsRoot.appendingPathComponent("old-alias")))
    }

    @Test func changedAliasCannotCreateADuplicateInstall() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let service = fixture.service()
        #expect(await service.install(legacy(), target: .claude) == .installed)
        let before = try fixture.snapshot()
        #expect(await service.install(legacy(name: "new-name"), target: .claude) == .conflict)
        #expect(try fixture.snapshot() == before)
    }

    @Test func existingCacheFromAnotherSourceIsNotUsedOrDeleted() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let cache = fixture.paths.legacyRepoCacheRoot.appendingPathComponent("owner--repo")
        try FileManager.default.createDirectory(at: cache.appendingPathComponent(".git"), withIntermediateDirectories: true)
        try Data("other source".utf8).write(to: cache.appendingPathComponent("SKILL.md"))
        let git = FixtureGit { arguments in
            arguments.contains("remote.origin.url") ? Data("https://github.com/other/repo\n".utf8) : Data("HEAD\n".utf8)
        }
        #expect(await fixture.service(git: git).install(legacy(), target: .codex) == .unavailable)
        #expect(try Data(contentsOf: cache.appendingPathComponent("SKILL.md")) == Data("other source".utf8))
        #expect(!CatalogInstallFilesystem.exists(fixture.paths.codexSkillsRoot.appendingPathComponent("old-alias")))
    }

    @Test func appleGitStubIsNotProbedWithoutDeveloperTools() async throws {
        let git = FixtureGit { _ in
            Issue.record("Apple Git must not be probed before developer tools are available")
            throw TestFailure.mustNotRun
        }
        let missingTools = FixtureGit { arguments in
            #expect(arguments == ["-p"])
            throw TestFailure.mustNotRun
        }
        await #expect(throws: SkillInstaller.InstallError.missingGit) {
            try await SkillInstaller.checkedGitRunner(executableURL: URL(fileURLWithPath: "/usr/bin/git"),
                runner: git, developerTools: missingTools)
        }
        let nonApple = FixtureGit { arguments in
            #expect(arguments == ["--version"])
            return Data("git version fixture\n".utf8)
        }
        _ = try await SkillInstaller.checkedGitRunner(executableURL: URL(fileURLWithPath: "/opt/homebrew/bin/git"),
            runner: nonApple, developerTools: missingTools)
    }

    @Test func bothBackendsUseRealGitWithoutAnyRemoteDownload() async throws {
        let repository = try LocalGitPackageRepository()
        defer { repository.remove() }
        let fixture = try Fixture()
        defer { fixture.remove() }
        let actual = GitCommandRunner(temporaryRoot: fixture.root)
        let localClone = FixtureGit { arguments in
            if arguments.first == "clone" {
                #expect(arguments[1] == "https://github.com/owner/repo")
                let destination = arguments[2]
                let output = try await actual.run(arguments: ["clone", repository.repositoryRoot.path, destination], maximumOutputBytes: 1024 * 1024)
                _ = try await actual.run(arguments: ["-C", destination, "config", "remote.origin.url", "https://github.com/owner/repo"], maximumOutputBytes: 1024)
                return output
            }
            return try await actual.run(arguments: arguments, maximumOutputBytes: 1024 * 1024)
        }
        let service = fixture.service(git: localClone)
        let skill = legacy(relative: repository.packagePath)
        #expect(await service.install(skill, target: .claude) == .installed)
        #expect(await service.install(skill, target: .codex) == .installed)
        #expect(try Data(contentsOf: fixture.paths.codexSkillsRoot.appendingPathComponent("old-alias/SKILL.md")) == repository.originalSkillData)

        let pinnedFixture = try Fixture()
        defer { pinnedFixture.remove() }
        let coordinates = repository.coordinates
        let pinnedSkill = try catalogRecord(extra: """
        ,"repo_slug":"owner/repo","skill_md_path":"\(repository.packagePath)/SKILL.md",
        "repo_commit_sha":"\(coordinates.commitSha)","skill_tree_sha":"\(coordinates.treeSha)",
        "skill_md_sha":"\(coordinates.skillMdSha)","install_target_name":"old-alias"
        """).skill
        let fetcher = GitPublicSkillPackageFetcher(temporaryRoot: pinnedFixture.root,
            remoteURL: { _ in repository.repositoryRoot })
        let pinnedService = pinnedFixture.service(git: actual, fetcher: fetcher)
        #expect(await pinnedService.install(pinnedSkill, target: .codex) == .installed)
        #expect(try Data(contentsOf: pinnedFixture.paths.codexSkillsRoot.appendingPathComponent("old-alias/SKILL.md")) == repository.originalSkillData)
    }

    @Test func canceledRequestDoesNotWriteOrReportMissingGit() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let service = fixture.service(gitProvider: { throw CancellationError() })
        #expect(await service.install(legacy(), target: .codex) == .failed("Installation canceled"))
        #expect(try fixture.snapshot().isEmpty)
    }

    @Test func overlappingRequestsDoNotStartAnotherInstall() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let gate = GitGate()
        let git = FixtureGit { arguments in
            await gate.pause()
            return try await fixture.git().run(arguments: arguments, maximumOutputBytes: 1024)
        }
        let service = fixture.service(git: git)
        let first = Task { await service.install(legacy(), target: .claude) }
        await gate.waitUntilPaused()
        guard case .failed = await service.install(legacy(), target: .codex) else { Issue.record("Expected busy result"); return }
        await gate.resume()
        #expect(await first.value == .installed)
        #expect(!CatalogInstallFilesystem.exists(fixture.paths.codexSkillsRoot))
    }
}

private enum TestFailure: Error { case mustNotRun, record, clone }
private struct FixtureGit: GitCommandRunning {
    let operation: @Sendable ([String]) async throws -> Data
    init(_ operation: @escaping @Sendable ([String]) async throws -> Data) { self.operation = operation }
    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data { try await operation(arguments) }
}
private struct FixtureFetcher: PublicSkillPackageFetching {
    var fail = false
    func fetchPackage(repositorySlug: String, normalizedRoot: String, expected: SkillPackageCoordinates) async throws -> SkillPackage {
        if fail { throw SkillPackageValidationError(code: .treeShaMismatch, path: nil) }
        return GroupSkillPackageTestSupport.package
    }
}
private struct Fixture: Sendable {
    let root: URL
    let paths: SkillFilesystemPaths
    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("catalog-adapter-\(UUID().uuidString)")
        paths = .isolated(testRoot: root)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    func remove() {
        if let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) {
            for case let url as URL in enumerator {
                if (try? FileManager.default.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType) == .typeDirectory {
                    try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
                }
            }
        }
        try? FileManager.default.removeItem(at: root)
    }
    func git(relative: String = ".", afterClone: @escaping @Sendable () throws -> Void = {}) -> FixtureGit {
        FixtureGit { arguments in
            if arguments.contains("remote.origin.url") { return Data("https://github.com/owner/repo\n".utf8) }
            if arguments.first == "clone" {
                let repo = URL(fileURLWithPath: arguments.last!)
                try FileManager.default.createDirectory(at: repo.appendingPathComponent(".git"), withIntermediateDirectories: true)
                let source = relative == "." ? repo : repo.appendingPathComponent(relative)
                try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
                try Data("---\nname: design\n---\n".utf8).write(to: source.appendingPathComponent("SKILL.md"))
                try Data([0, 255, 13, 10]).write(to: source.appendingPathComponent("asset.bin"))
                try Data(repeating: 120, count: 150_000).write(to: source.appendingPathComponent("large.txt"))
                try afterClone()
            }
            return Data("fixture\n".utf8)
        }
    }
    func service(git: (any GitCommandRunning)? = nil,
                 gitProvider: CatalogInstallService.GitProvider? = nil,
                 managed: ManagedSkillInstaller? = nil,
                 fetcher: any PublicSkillPackageFetching = FixtureFetcher(),
                 writer: CatalogInstallService.RecordWriter? = nil) -> CatalogInstallService {
        let managed = managed ?? ManagedSkillInstaller(managedRoot: root.appendingPathComponent("managed"), pathAnchor: paths.homeDirectory)
        let installer = CatalogSkillInstaller(packageFetcher: fetcher, managedInstaller: managed, filesystemPaths: paths)
        let runner = git ?? self.git()
        let provider = gitProvider ?? { runner }
        if let writer { return CatalogInstallService(installer: installer, gitProvider: provider, writeRecord: writer) }
        return CatalogInstallService(installer: installer, gitProvider: provider)
    }
    func snapshot() throws -> [String: Data] {
        var result: [String: Data] = [:]
        guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { return result }
        for case let url as URL in enumerator {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            let key = String(url.path.dropFirst(root.path.count))
            if attributes[.type] as? FileAttributeType == .typeSymbolicLink {
                result[key] = Data(try FileManager.default.destinationOfSymbolicLink(atPath: url.path).utf8)
            } else if attributes[.type] as? FileAttributeType == .typeRegular {
                result[key] = try Data(contentsOf: url)
            } else { result[key] = Data() }
        }
        return result
    }
}
private func catalogRecord(extra: String = "", name: String = "old-alias", relative: String = ".") throws -> CatalogInstallRecord {
    let command = relative == "." ? "git clone https://github.com/owner/repo ~/.claude/skills/\(name)"
        : "git clone https://github.com/owner/repo /tmp/repo && ln -s /tmp/repo/\(relative) ~/.claude/skills/\(name)"
    return try JSONDecoder().decode(CatalogInstallRecord.self, from: Data("""
    {"id":"owner/repo:alias","name":"design","description":"Skill","author_handle":"owner",
    "github_url":"https://github.com/owner/repo","install_cmd":"\(command)"\(extra)}
    """.utf8))
}
private func legacy(name: String = "old-alias", relative: String = ".") -> Skill {
    try! catalogRecord(name: name, relative: relative).skill
}
private func pinned() -> Skill {
    try! catalogRecord(extra: """
    ,"repo_slug":"owner/repo","skill_md_path":"SKILL.md","repo_commit_sha":"\(GroupSkillPackageTestSupport.commitSha)",
    "skill_tree_sha":"\(GroupSkillPackageTestSupport.treeSha)","skill_md_sha":"\(GroupSkillPackageTestSupport.skillMdSha)","install_target_name":"old-alias"
    """).skill
}
private actor GitGate {
    private var paused = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var continuation: CheckedContinuation<Void, Never>?
    func pause() async {
        paused = true
        waiters.forEach { $0.resume() }; waiters.removeAll()
        await withCheckedContinuation { continuation = $0 }
    }
    func waitUntilPaused() async {
        if paused { return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func resume() { continuation?.resume(); continuation = nil }
}
