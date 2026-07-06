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

    @Test func uniqueShaResolves() {
        let sha = "2222222222222222222222222222222222222222"
        let catalog = [skill(id: "owner/repo:example", name: "different", githubUrl: "https://github.com/owner/repo")]
        let history = ShaHistoryAsset(version: 1, generatedAt: nil, shaToSkillIds: [sha: ["owner/repo:example"]])
        let installed = installedSkill(name: "local-name", githubUrl: "", skillMdSha: sha)

        let result = SkillIdentityResolver(catalogSkills: catalog, shaHistory: history).resolve(installed)

        #expect(result.catalogSkillId == "owner/repo:example")
        #expect(result.status == .resolved(method: .sha))
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

    private func installedSkill(
        name: String,
        githubUrl: String,
        catalogSkillId: String? = nil,
        skillMdSha: String? = nil
    ) -> Skill {
        skill(
            id: "installed:/tmp/\(name)",
            name: name,
            githubUrl: githubUrl,
            skillMdSha: skillMdSha,
            origin: "Claude",
            catalogSkillId: catalogSkillId
        )
    }

    private func skill(
        id: String,
        name: String,
        githubUrl: String,
        skillMdSha: String? = nil,
        origin: String? = nil,
        catalogSkillId: String? = nil
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
            catalogSkillId: catalogSkillId
        )
    }
}
