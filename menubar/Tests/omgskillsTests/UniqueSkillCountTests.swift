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
            skill("review", b, origin: "Codex"), // different version of the same skill: still one
            skill("notes", nil), skill("notes", nil, origin: "Codex"), // no hash: still one by name
            skill("ship  it", a), skill("ship it", b, origin: "Codex"),
            skill("", nil), // no name: stands alone
        ]
        #expect(DeviceConnectionModel.uniqueSkillCount(installs) == 4)
    }
}
