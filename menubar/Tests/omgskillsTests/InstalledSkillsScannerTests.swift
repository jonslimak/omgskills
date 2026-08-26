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
