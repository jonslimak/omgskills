import Testing
@testable import omgskills

struct UniqueSkillCountTests {
    private func skill(_ name: String, _ sha: String?, origin: String = "Claude") -> Skill {
        Skill(id: "installed:\(origin):\(name)", name: name, description: "", githubUrl: "", installCmd: "",
            authorHandle: "", tags: [], readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "",
            skillMdSha: sha, installs: nil, trendingRank: nil, trendingSource: nil,
            origin: origin, isSymlink: false, isLocalOnly: true)
    }

    @Test func countsEachSkillOnceLikeTheWeb() {
        let a = String(repeating: "a", count: 40), b = String(repeating: "b", count: 40)
        let installs = [
            skill("Review", a), skill("review", a.uppercased(), origin: "Codex"), // same skill in two agents
            skill("review", b, origin: "Codex"), // same name, different SKILL.md: shown twice on the web
            skill("notes", nil), skill("notes", nil, origin: "Codex"), // no hash: each stands alone
            skill("ship  it", a), skill("ship it", a, origin: "Codex"),
        ]
        #expect(DeviceConnectionModel.uniqueSkillCount(installs) == 5)
    }
}
