import Testing
import Foundation
@testable import omgskills

struct SkillInstallerTests {
    @Test func rootSkillSpecUsesRepoRoot() throws {
        let skill = makeSkill(
            githubUrl: "https://github.com/example/root-skill",
            installCmd: "git clone https://github.com/example/root-skill ~/.claude/skills/root-skill"
        )

        let spec = try SkillInstaller.installationSpec(for: skill)

        #expect(spec.repoURL == "https://github.com/example/root-skill")
        #expect(spec.repoCacheName == "example--root-skill")
        #expect(spec.skillRelativePath == ".")
        #expect(spec.targetName == "root-skill")
    }

    @Test func nestedSkillSpecUsesLinkedSubdirectory() throws {
        let skill = makeSkill(
            githubUrl: "https://github.com/example/multi-skill",
            installCmd: "git clone https://github.com/example/multi-skill /tmp/multi-skill && ln -s /tmp/multi-skill/skills/design ~/.claude/skills/design"
        )

        let spec = try SkillInstaller.installationSpec(for: skill)

        #expect(spec.repoURL == "https://github.com/example/multi-skill")
        #expect(spec.repoCacheName == "example--multi-skill")
        #expect(spec.skillRelativePath == "skills/design")
        #expect(spec.targetName == "design")
    }

    @Test func targetRootsPointToClaudeAndCodexSkills() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path

        #expect(SkillInstaller.Target.claude.skillsRoot.path == "\(home)/.claude/skills")
        #expect(SkillInstaller.Target.codex.skillsRoot.path == "\(home)/.codex/skills")
    }

    private func makeSkill(githubUrl: String, installCmd: String) -> Skill {
        Skill(
            id: "example",
            name: "example",
            description: "Example skill.",
            githubUrl: githubUrl,
            installCmd: installCmd,
            authorHandle: "example",
            tags: [],
            readmeSnippet: nil,
            stars: 1,
            lastUpdated: "2026-04-23T00:00:00Z",
            firstSeen: "2026-04-23",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: nil,
            isSymlink: nil,
            isLocalOnly: nil
        )
    }
}
