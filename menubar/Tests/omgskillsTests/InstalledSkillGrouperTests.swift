import Foundation
import Testing
@testable import omgskills

struct InstalledSkillGrouperTests {
    @Test func equivalenceAndSameCatalogGroupingComposeTransitively() throws {
        let equivalence = try equivalenceIndex(
            memberSkillIds: ["claude-id", "codex-id"],
            representativeSkillId: "codex-id"
        )
        let claudeFirst = installedSkill(
            id: "claude-first",
            origin: "Claude",
            catalogSkillId: "claude-id",
            installPath: "/tmp/.claude/skills/review"
        )
        let codex = installedSkill(
            id: "codex",
            origin: "Codex",
            catalogSkillId: "codex-id",
            installPath: "/tmp/.codex/skills/review"
        )
        let claudeSecond = installedSkill(
            id: "claude-second",
            origin: "Claude",
            catalogSkillId: "claude-id",
            installPath: "/tmp/alternate/.claude/skills/review"
        )

        let items = InstalledSkillGrouper.group(
            installations: [claudeFirst, codex, claudeSecond],
            equivalence: equivalence
        )

        let item = try #require(items.first)
        #expect(items.count == 1)
        #expect(item.members.count == 3)
        #expect(item.representative.id == codex.id)
        #expect(item.sourceGroups.map(\.badgeTitle) == ["Claude 2", "Codex"])
        #expect(item.installationSummary == "3 installations: 2 Claude, 1 Codex")
    }

    @Test func installedAssetRepresentativeWinsBeforePortalFallback() throws {
        let equivalence = try equivalenceIndex(
            memberSkillIds: ["claude-id", "codex-id"],
            representativeSkillId: "claude-id"
        )
        let claude = installedSkill(
            id: "claude",
            origin: "Claude",
            catalogSkillId: "claude-id"
        )
        let codex = installedSkill(
            id: "codex",
            origin: "Codex",
            catalogSkillId: "codex-id"
        )

        let item = try #require(InstalledSkillGrouper.group(
            installations: [codex, claude],
            equivalence: equivalence
        ).first)

        #expect(item.representative.id == claude.id)
    }

    @Test func missingAssetRepresentativeFallsBackToCodex() throws {
        let equivalence = try equivalenceIndex(
            memberSkillIds: ["claude-id", "codex-id", "missing-id"],
            representativeSkillId: "missing-id"
        )
        let claude = installedSkill(
            id: "claude",
            origin: "Claude",
            catalogSkillId: "claude-id"
        )
        let codex = installedSkill(
            id: "codex",
            origin: "Codex",
            catalogSkillId: "codex-id"
        )

        let item = try #require(InstalledSkillGrouper.group(
            installations: [claude, codex],
            equivalence: equivalence
        ).first)

        #expect(item.representative.id == codex.id)
    }

    @Test func searchMatchesMetadataFromNonRepresentativeMembers() throws {
        let equivalence = try equivalenceIndex(
            memberSkillIds: ["claude-id", "codex-id"],
            representativeSkillId: "codex-id"
        )
        let claude = installedSkill(
            id: "claude",
            origin: "Claude",
            catalogSkillId: "claude-id",
            description: "Creates detailed watermelon launch plans."
        )
        let codex = installedSkill(
            id: "codex",
            origin: "Codex",
            catalogSkillId: "codex-id",
            description: "Creates launch plans."
        )

        let item = try #require(InstalledSkillGrouper.group(
            installations: [claude, codex],
            equivalence: equivalence
        ).first)

        #expect(item.representative.id == codex.id)
        #expect(item.matches(query: "watermelon"))
        #expect(item.matches(query: "watermelon plans"))
    }

    @Test func catalogBackedSkillsDoNotUseFuzzyFallback() {
        let first = installedSkill(
            id: "first",
            origin: "Claude",
            catalogSkillId: "owner/repo:first",
            description: "Review a pull request before it is merged."
        )
        let second = installedSkill(
            id: "second",
            origin: "Codex",
            catalogSkillId: "owner/repo:second",
            description: "Review a pull request before it is merged."
        )

        let items = InstalledSkillGrouper.group(
            installations: [first, second],
            equivalence: .empty
        )

        #expect(items.count == 2)
    }

    @Test func localOnlyGroupingMatchesPortalRulesAndKeepsLongestDescription() {
        let shorter = installedSkill(
            id: "shorter",
            origin: "Claude",
            catalogSkillId: nil,
            description: "Review a pull request before it is merged.",
            githubURL: "https://github.com/owner/repo"
        )
        let longer = installedSkill(
            id: "longer",
            origin: "Codex",
            catalogSkillId: nil,
            description: "Review a pull request before it is merged and explain every risk.",
            githubURL: "https://github.com/owner/repo"
        )

        let item = InstalledSkillGrouper.group(
            installations: [shorter, longer],
            equivalence: .empty
        )[0]

        #expect(item.members.count == 2)
        #expect(item.representative.id == longer.id)
        #expect(item.displayDescription == longer.description)
    }

    @Test func localGroupIdsAreStableAcrossInputOrder() {
        let claude = installedSkill(
            id: "claude",
            origin: "Claude",
            catalogSkillId: nil
        )
        let codex = installedSkill(
            id: "codex",
            origin: "Codex",
            catalogSkillId: nil
        )

        let forward = InstalledSkillGrouper.group(
            installations: [claude, codex],
            equivalence: .empty
        )
        let reversed = InstalledSkillGrouper.group(
            installations: [codex, claude],
            equivalence: .empty
        )

        #expect(forward.map(\.id) == reversed.map(\.id))
    }

    private func equivalenceIndex(
        memberSkillIds: [String],
        representativeSkillId: String
    ) throws -> SkillEquivalenceIndex {
        let members = memberSkillIds.map { "\"\($0)\"" }.joined(separator: ",")
        let data = Data("""
        {
          "version": 1,
          "groups": [{
            "id": "group-a",
            "memberSkillIds": [\(members)],
            "representativeSkillId": "\(representativeSkillId)",
            "preferredSkillIds": {},
            "confidence": "high",
            "evidence": ["same-repo"]
          }]
        }
        """.utf8)
        let asset = try JSONDecoder().decode(SkillEquivalenceAsset.self, from: data)
        return SkillEquivalenceIndex(asset: asset, liveSkillIds: Set(memberSkillIds))
    }

    private func installedSkill(
        id: String,
        origin: String,
        catalogSkillId: String?,
        description: String = "Review a pull request before it is merged.",
        githubURL: String = "https://github.com/owner/repo",
        installPath: String? = nil
    ) -> Skill {
        Skill(
            id: id,
            name: "review",
            description: description,
            githubUrl: githubURL,
            installCmd: installPath ?? "/tmp/.\(origin.lowercased())/skills/review",
            authorHandle: "owner",
            tags: ["review"],
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
            isLocalOnly: catalogSkillId == nil,
            catalogSkillId: catalogSkillId,
            identityStatus: catalogSkillId == nil
                ? .localOnly
                : .resolved(method: .provenance)
        )
    }
}
