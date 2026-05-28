import Testing
@testable import omgskills

struct SkillAttributionTests {
    @Test func resolvedAuthorWinsOverPublisherFallback() {
        let skill = makeSkill(
            authorHandle: "steipete",
            publisherHandle: "sickn33",
            provenanceType: "catalog"
        )

        #expect(skill.hasResolvedAuthor)
        #expect(skill.shouldShowPublisherFallback == false)
        #expect(skill.discoverAttributionText == "by @steipete")
    }

    @Test func unresolvedCatalogShowsPublisherFallback() {
        let skill = makeSkill(
            authorHandle: "",
            publisherHandle: "sickn33",
            provenanceType: "catalog"
        )

        #expect(skill.hasResolvedAuthor == false)
        #expect(skill.shouldShowPublisherFallback)
        #expect(skill.discoverAttributionText == "via @sickn33")
    }

    @Test func unresolvedUnknownDoesNotShowPublisherFallback() {
        let skill = makeSkill(
            authorHandle: "",
            publisherHandle: "sickn33",
            provenanceType: "unknown"
        )

        #expect(skill.shouldShowPublisherFallback == false)
        #expect(skill.discoverAttributionText == nil)
    }

    private func makeSkill(
        authorHandle: String,
        publisherHandle: String?,
        provenanceType: String?
    ) -> Skill {
        Skill(
            id: "repo:skill",
            name: "skill",
            description: "desc",
            githubUrl: "https://github.com/example/repo",
            installCmd: "git clone",
            authorHandle: authorHandle,
            tags: [],
            readmeSnippet: nil,
            stars: 10,
            lastUpdated: "2026-05-22T00:00:00Z",
            firstSeen: "2026-05-22",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: nil,
            isSymlink: nil,
            isLocalOnly: nil,
            publisherHandle: publisherHandle,
            publisherRepo: publisherHandle.map { "\($0)/repo" },
            provenanceType: provenanceType,
            authorConfidence: nil
        )
    }
}
