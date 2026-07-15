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
