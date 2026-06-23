import Testing
import Foundation
@testable import omgskills

struct SkillSyncServiceTests {
    @Test func payloadUsesGithubUrlAndNameForGithubStableKey() {
        let skill = makeSkill(
            name: "review",
            githubUrl: "https://github.com/acme/review",
            installCmd: "/Users/test/.codex/skills/review",
            origin: "Codex",
            isLocalOnly: false
        )

        let payload = SkillSyncService.payloadSkill(skill)

        #expect(payload.stableKey == "https://github.com/acme/review#review")
        #expect(payload.githubUrl == "https://github.com/acme/review")
        #expect(payload.source == "Codex")
        #expect(payload.isLocalOnly == false)
    }

    @Test func payloadUsesOriginAndPathForLocalOnlyStableKey() {
        let skill = makeSkill(
            name: "local-review",
            githubUrl: "",
            installCmd: "/Users/test/.agents/skills/local-review",
            origin: "Agents",
            isLocalOnly: true
        )

        let payload = SkillSyncService.payloadSkill(skill)

        #expect(payload.stableKey == "Agents:/Users/test/.agents/skills/local-review")
        #expect(payload.githubUrl == nil)
        #expect(payload.isLocalOnly == true)
    }

    private func makeSkill(
        name: String,
        githubUrl: String,
        installCmd: String,
        origin: String,
        isLocalOnly: Bool
    ) -> Skill {
        Skill(
            id: "installed:\(installCmd)",
            name: name,
            description: "Example skill",
            githubUrl: githubUrl,
            installCmd: installCmd,
            authorHandle: "",
            tags: [],
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: "2026-06-23T00:00:00Z",
            firstSeen: "",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: origin,
            isSymlink: false,
            isLocalOnly: isLocalOnly
        )
    }
}
