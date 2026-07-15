import Foundation
import Testing
@testable import omgskills

struct SkillIdentityResolverTests {
    @Test func gitBlobSHAMatchesGitHashObject() {
        let data = Data("hello\n".utf8)

        #expect(SkillIdentityResolver.gitBlobSHA(for: data) == "ce013625030ba8dba906f756967f9e9ca394464a")
    }

    @Test func provenanceResolvesFirst() {
        let catalog = [
            skill(id: "owner/repo:from-git", name: "example", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:from-provenance", name: "other", githubUrl: "https://github.com/owner/repo")
        ]
        let installed = installedSkill(
            name: "example",
            githubUrl: "https://github.com/owner/repo",
            catalogSkillId: "owner/repo:from-provenance",
            skillMdSha: "1111111111111111111111111111111111111111"
        )

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: nil).resolve(installed)

        #expect(result.catalogSkillId == "owner/repo:from-provenance")
        #expect(result.status == .resolved(method: .provenance))
    }

    @Test func gitResolutionIsCaseInsensitive() {
        let catalog = [
            skill(id: "A7Garden/CoHalo:cohalo", name: "cohalo", githubUrl: "https://github.com/A7Garden/CoHalo")
        ]
        let installed = installedSkill(name: "CoHalo", githubUrl: "https://github.com/a7garden/cohalo")

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: nil).resolve(installed)

        #expect(result.catalogSkillId == "A7Garden/CoHalo:cohalo")
        #expect(result.status == .resolved(method: .git))
    }

    @Test func exactNestedGitPathResolvesBeforeDuplicateName() {
        let catalog = [
            skill(id: "owner/repo:skills/first", name: "shared", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:skills/second", name: "shared", githubUrl: "https://github.com/owner/repo")
        ]
        let installed = installedSkill(
            name: "shared",
            githubUrl: "https://github.com/owner/repo",
            gitRelativePath: "skills/second"
        )

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: nil).resolve(installed)

        #expect(result.catalogSkillId == "owner/repo:skills/second")
        #expect(result.status == .resolved(method: .git))
    }

    @Test func rootGitPathMatchesCatalogIDWithoutSuffix() {
        let catalog = [
            skill(id: "owner/repo", name: "root-skill", githubUrl: "https://github.com/owner/repo")
        ]
        let installed = installedSkill(
            name: "root-skill",
            githubUrl: "https://github.com/owner/repo",
            gitRelativePath: "."
        )

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: nil).resolve(installed)

        #expect(result.catalogSkillId == "owner/repo")
        #expect(result.status == .resolved(method: .git))
    }

    @Test func leadingDotGitPathIsPreservedAndComparedCaseInsensitively() {
        let catalog = [
            skill(
                id: "Owner/Repo:.Claude/Skills/Foo",
                name: "foo",
                githubUrl: "https://github.com/Owner/Repo"
            )
        ]
        let installed = installedSkill(
            name: "different-local-name",
            githubUrl: "https://github.com/owner/repo",
            gitRelativePath: ".claude/skills/foo"
        )

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: nil).resolve(installed)

        #expect(result.catalogSkillId == "Owner/Repo:.Claude/Skills/Foo")
        #expect(result.status == .resolved(method: .git))
    }

    @Test func pathMissFallsBackToUniqueRepoAndName() {
        let catalog = [
            skill(id: "owner/repo:skills/new-path", name: "moved", githubUrl: "https://github.com/owner/repo")
        ]
        let installed = installedSkill(
            name: "moved",
            githubUrl: "https://github.com/owner/repo",
            gitRelativePath: "skills/old-path"
        )

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: nil).resolve(installed)

        #expect(result.catalogSkillId == "owner/repo:skills/new-path")
        #expect(result.status == .resolved(method: .git))
    }

    @Test func duplicateRepoAndNameIsOrderIndependentAndAmbiguous() {
        let first = skill(id: "owner/repo:skills/a", name: "shared", githubUrl: "https://github.com/owner/repo")
        let second = skill(id: "owner/repo:skills/b", name: "shared", githubUrl: "https://github.com/owner/repo")
        let installed = installedSkill(name: "shared", githubUrl: "https://github.com/owner/repo")

        let forward = SkillIdentityResolver(catalogSkills: [first, second], shaHistory: nil).resolve(installed)
        let reversed = SkillIdentityResolver(catalogSkills: [second, first], shaHistory: nil).resolve(installed)

        let expected = SkillIdentityStatus.ambiguous(skillIds: ["owner/repo:skills/a", "owner/repo:skills/b"])
        #expect(forward.catalogSkillId == nil)
        #expect(forward.status == expected)
        #expect(reversed.status == expected)
    }

    @Test func uniqueShaResolves() {
        let sha = "2222222222222222222222222222222222222222"
        let catalog = [skill(id: "owner/repo:example", name: "different", githubUrl: "https://github.com/owner/repo")]
        let history = ShaHistoryAsset(version: 1, generatedAt: nil, shaToSkillIds: [sha: ["owner/repo:example"]])
        let installed = installedSkill(name: "local-name", githubUrl: "", skillMdSha: sha)

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

        #expect(result.catalogSkillId == "owner/repo:example")
        #expect(result.status == .resolved(method: .sha))
    }

    @Test func gitMissLeavesUniqueShaUnrestrictedForRenamedRepo() {
        let sha = "2323232323232323232323232323232323232323"
        let catalog = [skill(id: "owner/old-repo:example", name: "example", githubUrl: "https://github.com/owner/old-repo")]
        let history = ShaHistoryAsset(version: 1, generatedAt: nil, shaToSkillIds: [sha: ["owner/old-repo:example"]])
        let installed = installedSkill(
            name: "example",
            githubUrl: "https://github.com/owner/new-repo",
            gitRelativePath: "skills/example",
            skillMdSha: sha
        )

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

        #expect(result.catalogSkillId == "owner/old-repo:example")
        #expect(result.status == .resolved(method: .sha))
    }

    @Test func ambiguousGitCandidatesAreResolvedBySingletonShaIntersection() {
        let sha = "2424242424242424242424242424242424242424"
        let catalog = [
            skill(id: "owner/repo:skills/a", name: "shared", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:skills/b", name: "shared", githubUrl: "https://github.com/owner/repo")
        ]
        let history = ShaHistoryAsset(version: 1, generatedAt: nil, shaToSkillIds: [sha: ["owner/repo:skills/b"]])
        let installed = installedSkill(name: "shared", githubUrl: "https://github.com/owner/repo", skillMdSha: sha)

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

        #expect(result.catalogSkillId == "owner/repo:skills/b")
        #expect(result.status == .resolved(method: .sha))
    }

    @Test func disjointShaDoesNotOverrideAmbiguousGitCandidates() {
        let sha = "2525252525252525252525252525252525252525"
        let catalog = [
            skill(id: "owner/repo:skills/a", name: "shared", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:skills/b", name: "shared", githubUrl: "https://github.com/owner/repo"),
            skill(id: "other/repo:skill", name: "other", githubUrl: "https://github.com/other/repo")
        ]
        let history = ShaHistoryAsset(version: 1, generatedAt: nil, shaToSkillIds: [sha: ["other/repo:skill"]])
        let installed = installedSkill(name: "shared", githubUrl: "https://github.com/owner/repo", skillMdSha: sha)

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

        #expect(result.catalogSkillId == nil)
        #expect(result.status == .ambiguous(skillIds: ["owner/repo:skills/a", "owner/repo:skills/b"]))
    }

    @Test func multiIDShaIntersectionRemainsAmbiguous() {
        let sha = "2626262626262626262626262626262626262626"
        let catalog = [
            skill(id: "owner/repo:skills/a", name: "shared", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:skills/b", name: "shared", githubUrl: "https://github.com/owner/repo")
        ]
        let history = ShaHistoryAsset(version: 1, generatedAt: nil, shaToSkillIds: [sha: [
            "owner/repo:skills/b", "owner/repo:skills/a"
        ]])
        let installed = installedSkill(name: "shared", githubUrl: "https://github.com/owner/repo", skillMdSha: sha)

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

        #expect(result.catalogSkillId == nil)
        #expect(result.status == .ambiguous(skillIds: ["owner/repo:skills/a", "owner/repo:skills/b"]))
    }

    @Test func validCanonicalShaUpgradesAmbiguousMatch() {
        let sha = "2727272727272727272727272727272727272727"
        let catalog = [
            skill(id: "owner/repo:first", name: "first", githubUrl: "https://github.com/owner/repo", skillMdSha: sha),
            skill(id: "owner/repo:second", name: "second", githubUrl: "https://github.com/owner/repo", skillMdSha: sha)
        ]
        let history = ShaHistoryAsset(
            version: 1,
            generatedAt: nil,
            shaToSkillIds: [sha: ["owner/repo:first", "owner/repo:second"]],
            canonicalBySha: [sha: canonical("owner/repo:first")]
        )

        let resolver = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history)
        let installed = installedSkill(name: "local-name", githubUrl: "", skillMdSha: sha)
        let result = resolver.resolve(installed)
        let measured = resolver.resolve([installed])

        #expect(result.catalogSkillId == "owner/repo:first")
        #expect(result.status == .resolved(method: .sha))
        #expect(measured.measurement.resolvedBySha == 1)
        #expect(measured.measurement.ambiguous == 0)
    }

    @Test func publishedCanonicalWireFormatDecodes() throws {
        let sha = "2727272727272727272727272727272727272727"
        let data = """
        {
          "version": 1,
          "generatedAt": "2026-07-15T00:00:00.000Z",
          "shaToSkillIds": {
            "\(sha)": ["owner/repo:first", "owner/repo:second"]
          },
          "canonicalBySha": {
            "\(sha)": {
              "skillId": "owner/repo:first",
              "confidence": "high",
              "reason": "same-repo"
            }
          }
        }
        """.data(using: .utf8)!

        let history = try JSONDecoder().decode(ShaHistoryAsset.self, from: data)

        #expect(history.canonicalBySha?[sha] == canonical("owner/repo:first"))
    }

    @Test func canonicalShaMustBelongToGitCandidateIntersection() {
        let sha = "2828282828282828282828282828282828282828"
        let catalog = [
            skill(id: "owner/repo:skills/a", name: "shared", githubUrl: "https://github.com/owner/repo", skillMdSha: sha),
            skill(id: "owner/repo:skills/b", name: "shared", githubUrl: "https://github.com/owner/repo", skillMdSha: sha),
            skill(id: "other/repo:copy", name: "copy", githubUrl: "https://github.com/other/repo", skillMdSha: sha)
        ]
        let history = ShaHistoryAsset(
            version: 1,
            generatedAt: nil,
            shaToSkillIds: [sha: catalog.map(\.id)],
            canonicalBySha: [sha: canonical("other/repo:copy")]
        )

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(
            installedSkill(name: "shared", githubUrl: "https://github.com/owner/repo", skillMdSha: sha)
        )

        #expect(result.catalogSkillId == nil)
        #expect(result.status == .ambiguous(skillIds: ["owner/repo:skills/a", "owner/repo:skills/b"]))
    }

    @Test func invalidCanonicalPolicyValuesRemainAmbiguous() {
        let sha = "2929292929292929292929292929292929292929"
        let catalog = [
            skill(id: "owner/repo:first", name: "first", githubUrl: "https://github.com/owner/repo", skillMdSha: sha),
            skill(id: "owner/repo:second", name: "second", githubUrl: "https://github.com/owner/repo", skillMdSha: sha)
        ]
        let history = ShaHistoryAsset(
            version: 1,
            generatedAt: nil,
            shaToSkillIds: [sha: catalog.map(\.id)],
            canonicalBySha: [sha: CanonicalShaEntry(
                skillId: "owner/repo:first",
                confidence: "medium",
                reason: "trusted-creator"
            )]
        )

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(
            installedSkill(name: "local-name", githubUrl: "", skillMdSha: sha)
        )

        #expect(result.status == .ambiguous(skillIds: catalog.map(\.id).sorted()))
    }

    @Test func staleNonMemberAndShaMismatchedCanonicalIDsRemainAmbiguous() {
        let sha = "3030303030303030303030303030303030303030"
        let otherSha = "3131313131313131313131313131313131313131"
        let baseCatalog = [
            skill(id: "owner/repo:first", name: "first", githubUrl: "https://github.com/owner/repo", skillMdSha: sha),
            skill(id: "owner/repo:second", name: "second", githubUrl: "https://github.com/owner/repo", skillMdSha: sha)
        ]
        let installed = installedSkill(name: "local-name", githubUrl: "", skillMdSha: sha)
        let fixtures: [([Skill], [String], String, [String])] = [
            (baseCatalog, baseCatalog.map(\.id), "owner/repo:removed", baseCatalog.map(\.id)),
            (baseCatalog + [skill(id: "other/repo:copy", name: "copy", githubUrl: "https://github.com/other/repo", skillMdSha: sha)], baseCatalog.map(\.id), "other/repo:copy", baseCatalog.map(\.id)),
            (baseCatalog + [skill(id: "owner/repo:mismatch", name: "mismatch", githubUrl: "https://github.com/owner/repo", skillMdSha: otherSha)], baseCatalog.map(\.id) + ["owner/repo:mismatch"], "owner/repo:mismatch", baseCatalog.map(\.id) + ["owner/repo:mismatch"])
        ]

        for (catalog, members, canonicalId, expectedIds) in fixtures {
            let history = ShaHistoryAsset(
                version: 1,
                generatedAt: nil,
                shaToSkillIds: [sha: members],
                canonicalBySha: [sha: canonical(canonicalId)]
            )
            let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

            #expect(result.catalogSkillId == nil)
            #expect(result.status == .ambiguous(skillIds: expectedIds.sorted()))
        }
    }

    @Test func malformedCanonicalExtensionDoesNotRejectCoreShaHistory() throws {
        let sha = "3232323232323232323232323232323232323232"
        let data = """
        {
          "version": 1,
          "shaToSkillIds": {
            "\(sha)": ["owner/repo:first", "owner/repo:second"]
          },
          "canonicalBySha": {
            "\(sha)": "malformed"
          }
        }
        """.data(using: .utf8)!

        let history = try JSONDecoder().decode(ShaHistoryAsset.self, from: data)
        let catalog = [
            skill(id: "owner/repo:first", name: "first", githubUrl: "https://github.com/owner/repo", skillMdSha: sha),
            skill(id: "owner/repo:second", name: "second", githubUrl: "https://github.com/owner/repo", skillMdSha: sha)
        ]
        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(
            installedSkill(name: "local-name", githubUrl: "", skillMdSha: sha)
        )

        #expect(history.canonicalBySha == nil)
        #expect(result.status == .ambiguous(skillIds: catalog.map(\.id).sorted()))
    }

    @Test func multiIDShaReturnsAmbiguous() {
        let sha = "3333333333333333333333333333333333333333"
        let catalog = [
            skill(id: "owner/repo:first", name: "first", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:second", name: "second", githubUrl: "https://github.com/owner/repo")
        ]
        let history = ShaHistoryAsset(version: 1, generatedAt: nil, shaToSkillIds: [sha: ["owner/repo:second", "owner/repo:first"]])
        let installed = installedSkill(name: "local-name", githubUrl: "", skillMdSha: sha)

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

        #expect(result.catalogSkillId == nil)
        #expect(result.status == .ambiguous(skillIds: ["owner/repo:first", "owner/repo:second"]))
    }

    @Test func staleShaHistoryIDsAreIgnored() {
        let sha = "4444444444444444444444444444444444444444"
        let catalog = [skill(id: "owner/repo:live", name: "live", githubUrl: "https://github.com/owner/repo")]
        let history = ShaHistoryAsset(version: 1, generatedAt: nil, shaToSkillIds: [sha: ["owner/repo:removed"]])
        let installed = installedSkill(name: "local-name", githubUrl: "", skillMdSha: sha)

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

        #expect(result.catalogSkillId == nil)
        #expect(result.status == .localOnly)
    }

    @Test func countersClassifyResolutionPaths() {
        let sha = "5555555555555555555555555555555555555555"
        let ambiguousSha = "6666666666666666666666666666666666666666"
        let catalog = [
            skill(id: "owner/repo:provenance", name: "provenance", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:git", name: "git", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:sha", name: "sha", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:ambiguous-a", name: "ambiguous-a", githubUrl: "https://github.com/owner/repo"),
            skill(id: "owner/repo:ambiguous-b", name: "ambiguous-b", githubUrl: "https://github.com/owner/repo")
        ]
        let history = ShaHistoryAsset(version: 1, generatedAt: nil, shaToSkillIds: [
            sha: ["owner/repo:sha"],
            ambiguousSha: ["owner/repo:ambiguous-a", "owner/repo:ambiguous-b"]
        ])
        let installed = [
            installedSkill(name: "x", githubUrl: "", catalogSkillId: "owner/repo:provenance"),
            installedSkill(name: "git", githubUrl: "https://github.com/OWNER/REPO"),
            installedSkill(name: "local-sha", githubUrl: "", skillMdSha: sha),
            installedSkill(name: "ambiguous", githubUrl: "", skillMdSha: ambiguousSha),
            installedSkill(name: "local", githubUrl: "")
        ]

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

        #expect(result.measurement.resolvedByProvenance == 1)
        #expect(result.measurement.resolvedByGit == 1)
        #expect(result.measurement.resolvedBySha == 1)
        #expect(result.measurement.ambiguous == 1)
        #expect(result.measurement.localOnly == 1)
    }

    @Test func skillWithoutGitRelativePathStillDecodes() throws {
        let original = installedSkill(
            name: "example",
            githubUrl: "https://github.com/owner/repo",
            gitRelativePath: "skills/example"
        )
        let encoded = try JSONEncoder().encode(original)
        var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object.removeValue(forKey: "gitRelativePath")
        let legacyData = try JSONSerialization.data(withJSONObject: object)

        let decoded = try JSONDecoder().decode(Skill.self, from: legacyData)

        #expect(decoded.gitRelativePath == nil)
        #expect(decoded.id == original.id)
    }

    private func installedSkill(
        name: String,
        githubUrl: String,
        catalogSkillId: String? = nil,
        gitRelativePath: String? = nil,
        skillMdSha: String? = nil
    ) -> Skill {
        skill(
            id: "installed:/tmp/\(name)",
            name: name,
            githubUrl: githubUrl,
            skillMdSha: skillMdSha,
            origin: "Claude",
            catalogSkillId: catalogSkillId,
            gitRelativePath: gitRelativePath
        )
    }

    private func canonical(_ skillId: String) -> CanonicalShaEntry {
        CanonicalShaEntry(skillId: skillId, confidence: "high", reason: "same-repo")
    }

    private func skill(
        id: String,
        name: String,
        githubUrl: String,
        skillMdSha: String? = nil,
        origin: String? = nil,
        catalogSkillId: String? = nil,
        gitRelativePath: String? = nil
    ) -> Skill {
        Skill(
            id: id,
            name: name,
            description: "Example skill.",
            githubUrl: githubUrl,
            installCmd: "git clone \(githubUrl) ~/.claude/skills/\(name)",
            authorHandle: "owner",
            tags: [],
            readmeSnippet: nil,
            stars: 1,
            lastUpdated: "2026-07-06T00:00:00Z",
            firstSeen: "2026-07-06",
            skillMdSha: skillMdSha,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: origin,
            isSymlink: nil,
            isLocalOnly: nil,
            gitRelativePath: gitRelativePath,
            catalogSkillId: catalogSkillId
        )
    }
}
