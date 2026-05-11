import Foundation
import Testing
@testable import omgskills

struct LocalSkillCrossInstallerTests {
    @Test func installsSymlinkToExistingLocalSkill() throws {
        let root = try temporaryDirectory()
        let source = root.appendingPathComponent("source-skill", isDirectory: true)
        let targetRoot = root.appendingPathComponent("codex", isDirectory: true)
        try writeSkill(at: source)

        let result = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(path: source.path, origin: "Claude"),
            targetRoot: targetRoot
        )

        let target = targetRoot.appendingPathComponent("source-skill", isDirectory: true)
        #expect(result == .installed)
        #expect(FileManager.default.fileExists(atPath: target.appendingPathComponent("SKILL.md").path))
        #expect((try? target.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true)
    }

    @Test func returnsAlreadyInstalledWhenTargetHasSkillFile() throws {
        let root = try temporaryDirectory()
        let source = root.appendingPathComponent("source-skill", isDirectory: true)
        let target = root.appendingPathComponent("codex/source-skill", isDirectory: true)
        try writeSkill(at: source)
        try writeSkill(at: target)

        let result = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(path: source.path, origin: "Claude"),
            targetRoot: root.appendingPathComponent("codex", isDirectory: true)
        )

        #expect(result == .alreadyInstalled)
    }

    @Test func symlinkSourceInstallsResolvedDestination() throws {
        let root = try temporaryDirectory()
        let realSource = root.appendingPathComponent("real-source", isDirectory: true)
        let linkedSource = root.appendingPathComponent("linked-source", isDirectory: true)
        let targetRoot = root.appendingPathComponent("codex", isDirectory: true)
        try writeSkill(at: realSource)
        try FileManager.default.createSymbolicLink(at: linkedSource, withDestinationURL: realSource)

        _ = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(path: linkedSource.path, origin: "Claude"),
            targetRoot: targetRoot
        )

        let target = targetRoot.appendingPathComponent("linked-source", isDirectory: true)
        #expect(target.resolvingSymlinksInPath().path == realSource.path)
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writeSkill(at directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let content = """
        ---
        name: source-skill
        description: Example skill.
        ---
        """
        try content.write(to: directory.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
    }

    private func makeInstalledSkill(path: String, origin: String) -> Skill {
        Skill(
            id: "installed:\(path)",
            name: "source-skill",
            description: "Example skill.",
            githubUrl: "",
            installCmd: path,
            authorHandle: "",
            tags: [],
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: "",
            firstSeen: "",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: origin,
            isSymlink: nil,
            isLocalOnly: nil
        )
    }
}
