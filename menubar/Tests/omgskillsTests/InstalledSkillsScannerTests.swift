import Testing
import Foundation
@testable import omgskills

struct InstalledSkillsScannerTests {
    @Test func summaryCountsInstallLocationsWhileListDedupesSymlinks() throws {
        let root = try temporaryDirectory()
        let codex = root.appendingPathComponent("codex", isDirectory: true)
        let claude = root.appendingPathComponent("claude", isDirectory: true)
        let shared = root.appendingPathComponent("shared", isDirectory: true)
        try FileManager.default.createDirectory(at: codex, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: claude, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: shared, withIntermediateDirectories: true)
        try writeSkill(at: shared, name: "shared-skill")
        try FileManager.default.createSymbolicLink(
            at: codex.appendingPathComponent("shared-skill"),
            withDestinationURL: shared
        )
        try FileManager.default.createSymbolicLink(
            at: claude.appendingPathComponent("shared-skill"),
            withDestinationURL: shared
        )

        let result = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: claude, origin: "Claude"),
            InstalledSkillsScanner.Root(url: codex, origin: "Codex")
        ])

        #expect(result.summary.totalInstallations == 2)
        #expect(result.summary.claudeCount == 1)
        #expect(result.summary.codexCount == 1)
        #expect(result.summary.symlinkCount == 2)
        #expect(result.skills.count == 1)
        #expect(result.installations.count == 2)
        #expect(result.installations.allSatisfy { $0.isSymlink == true })
    }

    @Test func localOnlyMeansNoSymlinkAndNoGitHubRemote() throws {
        let root = try temporaryDirectory()
        let codex = root.appendingPathComponent("codex", isDirectory: true)
        let local = codex.appendingPathComponent("local-only", isDirectory: true)
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        try writeSkill(at: local, name: "local-only")

        let result = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: codex, origin: "Codex")
        ])

        #expect(result.summary.totalInstallations == 1)
        #expect(result.summary.localOnlyCount == 1)
        #expect(result.installations.first?.isLocalOnly == true)
        #expect(result.summary.recentSkills.first?.name == "local-only")
    }

    @Test func scanComputesGitBlobShaForSkillMd() throws {
        let root = try temporaryDirectory()
        let codex = root.appendingPathComponent("codex", isDirectory: true)
        let local = codex.appendingPathComponent("local-only", isDirectory: true)
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        try writeSkill(at: local, name: "local-only")

        let result = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: codex, origin: "Codex")
        ])

        let data = try Data(contentsOf: local.appendingPathComponent("SKILL.md"))
        #expect(result.installations.first?.skillMdSha == SkillIdentityResolver.gitBlobSHA(for: data))
    }

    @Test func scanFindsEnclosingGitRemoteForNestedSkill() throws {
        let root = try temporaryDirectory()
        let codex = root.appendingPathComponent("codex", isDirectory: true)
        let repo = root.appendingPathComponent("repo", isDirectory: true)
        let skillDir = repo.appendingPathComponent("skills/design", isDirectory: true)
        try FileManager.default.createDirectory(at: codex, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: repo.appendingPathComponent(".git", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: skillDir, withIntermediateDirectories: true)
        try """
        [remote "origin"]
            url = git@github.com:Owner/Repo.git
        """.write(to: repo.appendingPathComponent(".git/config"), atomically: true, encoding: .utf8)
        try writeSkill(at: skillDir, name: "design")
        try FileManager.default.createSymbolicLink(
            at: codex.appendingPathComponent("design"),
            withDestinationURL: skillDir
        )

        let result = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: codex, origin: "Codex")
        ])

        #expect(result.installations.first?.githubUrl == "https://github.com/Owner/Repo")
        #expect(result.installations.first?.authorHandle == "Owner")
        #expect(result.installations.first?.gitRelativePath == "skills/design")
    }

    @Test func scanRecordsDotForSkillAtGitRoot() throws {
        let root = try temporaryDirectory()
        let codex = root.appendingPathComponent("codex", isDirectory: true)
        let repo = root.appendingPathComponent("repo", isDirectory: true)
        try FileManager.default.createDirectory(at: codex, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: repo.appendingPathComponent(".git", isDirectory: true), withIntermediateDirectories: true)
        try """
        [remote "origin"]
            url = https://github.com/owner/root-skill.git
        """.write(to: repo.appendingPathComponent(".git/config"), atomically: true, encoding: .utf8)
        try writeSkill(at: repo, name: "root-skill")
        try FileManager.default.createSymbolicLink(
            at: codex.appendingPathComponent("root-skill"),
            withDestinationURL: repo
        )

        let result = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: codex, origin: "Codex")
        ])

        #expect(result.installations.first?.gitRelativePath == ".")
    }

    @Test func scanReadsInstallProvenanceMetadata() throws {
        let root = try temporaryDirectory()
        let codex = root.appendingPathComponent("codex", isDirectory: true)
        let metadataDir = codex.appendingPathComponent(".omgskills", isDirectory: true)
        let local = codex.appendingPathComponent("installed-skill", isDirectory: true)
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: metadataDir, withIntermediateDirectories: true)
        try writeSkill(at: local, name: "installed-skill")
        let metadata = """
        {
          "catalogSkillId": "owner/repo:installed-skill",
          "githubUrl": "https://github.com/owner/repo",
          "installedAt": "2026-07-06T00:00:00Z"
        }
        """
        try Data(metadata.utf8).write(to: metadataDir.appendingPathComponent("installed-skill.json"))

        let result = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: codex, origin: "Codex")
        ])

        #expect(result.installations.first?.catalogSkillId == "owner/repo:installed-skill")
        #expect(SkillInstallProvenanceStore.read(
            targetRoot: codex,
            targetName: "installed-skill"
        )?.skillMdSha == nil)
    }

    @Test func recentSkillsCapsAtTenNewestFirst() throws {
        let root = try temporaryDirectory()
        let codex = root.appendingPathComponent("codex", isDirectory: true)
        try FileManager.default.createDirectory(at: codex, withIntermediateDirectories: true)

        for index in 0..<11 {
            let skill = codex.appendingPathComponent("skill-\(index)", isDirectory: true)
            try FileManager.default.createDirectory(at: skill, withIntermediateDirectories: true)
            try writeSkill(at: skill, name: "skill-\(index)")
            let date = Date(timeIntervalSince1970: TimeInterval(index))
            try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: skill.appendingPathComponent("SKILL.md").path)
            try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: skill.path)
        }

        let result = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: codex, origin: "Codex")
        ])

        #expect(result.summary.recentSkills.count == 10)
        #expect(result.summary.recentSkills.first?.name == "skill-10")
        #expect(result.summary.recentSkills.last?.name == "skill-1")
    }

    @Test func presenceScanKeepsAllThreeLocationsWithoutCatalogMatching() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let shared = root.appendingPathComponent("shared")
        try FileManager.default.createDirectory(at: shared, withIntermediateDirectories: true)
        try writeSkill(at: shared, name: "shared")
        for agentRoot in paths.allSkillsRoots {
            try FileManager.default.createDirectory(at: agentRoot, withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: agentRoot.appendingPathComponent("shared"), withDestinationURL: shared)
        }
        let result = try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths)
        #expect(result.skills.count == 1)
        #expect(result.installations.count == 3)
        #expect(Set(result.installations.compactMap(\.origin)) == ["Claude", "Codex", "Agents"])
        #expect(result.issues.isEmpty)
        #expect(try SkillSyncService.presencePayload(installations: result.installations).skills.count == 3)
    }

    @Test func presenceScanReportsSkippedEntriesAndUnavailableRootsAlongsideUsableSkills() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let good = paths.codexSkillsRoot.appendingPathComponent("good")
        let bad = paths.codexSkillsRoot.appendingPathComponent("bad")
        try FileManager.default.createDirectory(at: good, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: bad, withIntermediateDirectories: true)
        try writeSkill(at: good, name: "good")
        try "not valid frontmatter".write(to: bad.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        try FileManager.default.createDirectory(at: paths.agentsSkillsRoot.deletingLastPathComponent(), withIntermediateDirectories: true)
        // A file where a root should be is a deterministic read error, even as root.
        try Data("not a directory".utf8).write(to: paths.agentsSkillsRoot)
        let result = try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths)
        #expect(result.installations.map(\.name) == ["good"])
        #expect(result.issues.contains(.unreadableRoot(source: "Agents")))
        #expect(result.issues.contains(.skippedSkill(source: "Codex", folder: "bad")))
        #expect(!result.issues.contains(.unreadableRoot(source: "Claude")))
    }

    @Test func presenceScanCancellationDoesNotReturnAnEmptySuccessfulReport() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths)
        }
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test func presenceScanSkipsOversizeMetadataButRetainsOtherSkills() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        for (folder, name) in [("good", "good"), ("oversize", String(repeating: "x", count: 201))] {
            let directory = paths.codexSkillsRoot.appendingPathComponent(folder)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try writeSkill(at: directory, name: name)
        }
        let result = try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths)
        #expect(result.installations.map(\.name) == ["good"])
        #expect(result.issues.contains(.skippedSkill(source: "Codex", folder: "oversize")))
        #expect(try SkillSyncService.presencePayload(installations: result.installations).skills.count == 1)
    }

    @Test func presenceScanDoesNotTreatBrokenRootSymlinkAsAnEmptyRoot() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        try FileManager.default.createDirectory(at: paths.codexSkillsRoot.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: paths.codexSkillsRoot, withDestinationURL: root.appendingPathComponent("missing"))
        let result = try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths)
        #expect(result.installations.isEmpty)
        #expect(result.issues.contains(.unreadableRoot(source: "Codex")))
    }

    @Test func boundedPresenceScanAllowsManagedContentAnywhereInsideTheTestRoot() async throws {
        let base = try temporaryDirectory().resolvingSymlinksInPath()
        defer { try? FileManager.default.removeItem(at: base) }
        let root = base.appendingPathComponent("test")
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let content = root.appendingPathComponent("managed/activation/content")
        try FileManager.default.createDirectory(at: content, withIntermediateDirectories: true)
        let shared = root.appendingPathComponent("shared")
        try FileManager.default.createDirectory(at: shared, withIntermediateDirectories: true)
        try writeSkill(at: shared, name: "managed")
        try FileManager.default.createSymbolicLink(at: content.appendingPathComponent("SKILL.md"),
            withDestinationURL: shared.appendingPathComponent("SKILL.md"))
        for agentRoot in paths.allSkillsRoots {
            try FileManager.default.createDirectory(at: agentRoot, withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: agentRoot.appendingPathComponent("managed"), withDestinationURL: content)
        }
        try SkillInstallProvenanceStore.write(.init(catalogSkillId: "owner/managed", githubUrl: "https://github.com/owner/managed",
            installedAt: "2026-10-16T12:00:00Z", skillMdSha: "fixture"), to: content.deletingLastPathComponent().appendingPathComponent("provenance.json"))
        let scan = try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths, pathAnchor: root)
        #expect(scan.installations.count == 3)
        #expect(scan.installations.allSatisfy { $0.catalogSkillId == "owner/managed" })
        #expect(scan.issues.isEmpty)
    }

    @Test(arguments: ["entry", "skillFile", "provenance", "managedProvenance"])
    func boundedPresenceScanSkipsExternalLinksWithPartialDiagnostics(_ escape: String) async throws {
        let base = try temporaryDirectory().resolvingSymlinksInPath()
        defer { try? FileManager.default.removeItem(at: base) }
        let root = base.appendingPathComponent("test")
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let good = paths.codexSkillsRoot.appendingPathComponent("good")
        let bad = paths.codexSkillsRoot.appendingPathComponent("bad")
        // A sibling sharing the anchor's prefix must still be outside it.
        let outside = base.appendingPathComponent("test-outside")
        try FileManager.default.createDirectory(at: good, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try writeSkill(at: good, name: "good")
        try writeSkill(at: outside, name: "outside")
        switch escape {
        case "entry":
            try FileManager.default.createSymbolicLink(at: bad, withDestinationURL: outside)
        case "skillFile":
            try FileManager.default.createDirectory(at: bad, withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: bad.appendingPathComponent("SKILL.md"),
                withDestinationURL: outside.appendingPathComponent("SKILL.md"))
        case "provenance":
            try FileManager.default.createDirectory(at: bad, withIntermediateDirectories: true)
            try writeSkill(at: bad, name: "outside")
            let metadata = SkillInstallProvenanceStore.metadataURL(targetRoot: paths.codexSkillsRoot, targetName: "bad")
            try FileManager.default.createDirectory(at: metadata.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: metadata, withDestinationURL: outside.appendingPathComponent("provenance.json"))
        default:
            let content = root.appendingPathComponent("managed/activation/content")
            try FileManager.default.createDirectory(at: content, withIntermediateDirectories: true)
            try writeSkill(at: content, name: "outside")
            try FileManager.default.createSymbolicLink(at: bad, withDestinationURL: content)
            try FileManager.default.createSymbolicLink(at: content.deletingLastPathComponent().appendingPathComponent("provenance.json"),
                withDestinationURL: outside.appendingPathComponent("provenance.json"))
        }
        try SkillInstallProvenanceStore.write(.init(catalogSkillId: "owner/outside", githubUrl: "https://github.com/owner/outside",
            installedAt: "2026-10-16T12:00:00Z", skillMdSha: "fixture"), to: outside.appendingPathComponent("provenance.json"))
        let scan = try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths, pathAnchor: root)
        #expect(scan.installations.map(\.name) == ["good"])
        #expect(scan.issues == [.skippedSkill(source: "Codex", folder: "bad")])
        #expect(InstalledSkillsScanner.scanWithSummary(filesystemPaths: paths).installations.count == 2)
    }

    @Test(arguments: ["agent", "home", "anchor", "missingAnchor"])
    func boundedPresenceScanRechecksMovedOrRedirectedRootsEveryTime(_ escape: String) async throws {
        let base = try temporaryDirectory().resolvingSymlinksInPath()
        defer { try? FileManager.default.removeItem(at: base) }
        let root = base.appendingPathComponent("test")
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let skill = paths.codexSkillsRoot.appendingPathComponent("fixture")
        try FileManager.default.createDirectory(at: skill, withIntermediateDirectories: true)
        try writeSkill(at: skill, name: "fixture")
        let first = try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths, pathAnchor: root)
        #expect(first.installations.count == 1)
        let redirected: URL
        switch escape {
        case "agent": redirected = paths.codexSkillsRoot
        case "home": redirected = paths.homeDirectory
        default: redirected = root
        }
        let moved = base.appendingPathComponent("moved")
        try FileManager.default.moveItem(at: redirected, to: moved)
        if escape != "missingAnchor" {
            try FileManager.default.createSymbolicLink(at: redirected, withDestinationURL: moved)
        }
        let second = try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths, pathAnchor: root)
        #expect(second.installations.isEmpty)
        #expect(second.issues.contains(.unreadableRoot(source: "Codex")))
    }

    @Test(arguments: ["linkedConfig", "enclosingRepository"])
    func boundedPresenceScanDoesNotReadGitConfigurationOutsideAnchor(_ escape: String) async throws {
        let base = try temporaryDirectory().resolvingSymlinksInPath()
        defer { try? FileManager.default.removeItem(at: base) }
        let root = base.appendingPathComponent("test")
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let skill = paths.codexSkillsRoot.appendingPathComponent("fixture")
        try FileManager.default.createDirectory(at: skill, withIntermediateDirectories: true)
        try writeSkill(at: skill, name: "fixture")
        let outsideConfig = base.appendingPathComponent(".git/config")
        try FileManager.default.createDirectory(at: outsideConfig.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "[remote \"origin\"]\nurl = https://github.com/outside/repository.git\n".write(to: outsideConfig, atomically: true, encoding: .utf8)
        if escape == "linkedConfig" {
            let config = skill.appendingPathComponent(".git/config")
            try FileManager.default.createDirectory(at: config.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: config, withDestinationURL: outsideConfig)
        }
        let scan = try await InstalledSkillsScanner.scanForPresence(filesystemPaths: paths, pathAnchor: root)
        #expect(scan.installations.count == 1)
        #expect(scan.installations.first?.githubUrl == "")
        #expect(InstalledSkillsScanner.scanWithSummary(filesystemPaths: paths).installations.first?.githubUrl == "https://github.com/outside/repository")
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writeSkill(at directory: URL, name: String) throws {
        let content = """
        ---
        name: \(name)
        description: Example skill.
        ---

        # \(name)
        """
        try content.write(to: directory.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
    }
}
