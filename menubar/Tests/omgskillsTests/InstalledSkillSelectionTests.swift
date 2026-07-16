import Testing
@testable import omgskills

struct InstalledSkillSelectionTests {
    @Test func selectedPhysicalSkillSurvivesAGroupingMerge() {
        let claude = skill(id: "claude", origin: "Claude")
        let codex = skill(id: "codex", origin: "Codex")
        let previousItem = item(id: "catalog:claude", members: [claude])
        let mergedItem = item(id: "equivalence:group-a", members: [claude, codex])

        let resolution = InstalledSkillSelectionResolver.resolve(
            items: [mergedItem],
            selectedSkillId: claude.id,
            anchor: previousItem.selectionAnchor
        )

        #expect(resolution?.item.id == mergedItem.id)
        #expect(resolution?.skill.id == claude.id)
    }

    @Test func deletedSelectedMemberFallsBackWithinTheSameLogicalItem() {
        let claude = skill(id: "claude", origin: "Claude")
        let codex = skill(id: "codex", origin: "Codex")
        let previousItem = item(
            id: "equivalence:group-a",
            members: [claude, codex],
            representative: codex
        )
        let remainingItem = item(
            id: "equivalence:group-a",
            members: [claude],
            representative: claude
        )

        let resolution = InstalledSkillSelectionResolver.resolve(
            items: [remainingItem],
            selectedSkillId: codex.id,
            anchor: previousItem.selectionAnchor
        )

        #expect(resolution?.item.id == remainingItem.id)
        #expect(resolution?.skill.id == claude.id)
    }

    @Test func splitLogicalItemFallsBackToAGroupWithSurvivingMembers() {
        let first = skill(id: "first", origin: "Claude")
        let second = skill(id: "second", origin: "Codex")
        let removed = skill(id: "removed", origin: "Agents")
        let previousItem = item(
            id: "local:old",
            members: [first, second, removed],
            representative: removed
        )
        let firstItem = item(id: first.id, members: [first])
        let secondItem = item(id: second.id, members: [second])

        let resolution = InstalledSkillSelectionResolver.resolve(
            items: [secondItem, firstItem],
            selectedSkillId: removed.id,
            anchor: previousItem.selectionAnchor
        )

        #expect(resolution?.item.id == firstItem.id)
        #expect(resolution?.skill.id == first.id)
    }

    private func item(
        id: String,
        members: [Skill],
        representative: Skill? = nil
    ) -> InstalledSkillDisplayItem {
        InstalledSkillDisplayItem(
            id: id,
            representative: representative ?? members[0],
            members: members,
            displayDescription: members.map(\.description).max(by: { $0.count < $1.count }) ?? ""
        )
    }

    private func skill(id: String, origin: String) -> Skill {
        Skill(
            id: id,
            name: "review",
            description: "Review a pull request.",
            githubUrl: "https://github.com/owner/repo",
            installCmd: "/tmp/.\(origin.lowercased())/skills/\(id)",
            authorHandle: "owner",
            tags: [],
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: "2026-07-16T00:00:00Z",
            firstSeen: "2026-07-16",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: origin,
            isSymlink: false,
            isLocalOnly: true,
            identityStatus: .localOnly
        )
    }
}
