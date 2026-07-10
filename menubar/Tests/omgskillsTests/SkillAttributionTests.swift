import Foundation
import Testing
@testable import omgskills

struct SkillAttributionTests {
    @Test func decoderIgnoresOptionalQualityTierField() throws {
        let data = Data(#"{"id":"owner/repo:skill","name":"skill","description":"desc","github_url":"https://github.com/owner/repo","install_cmd":"git clone","author_handle":"owner","tags":[],"stars":10,"last_updated":"2026-07-01T00:00:00Z","first_seen":"2026-07-01","quality_tier":"creator"}"#.utf8)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase

        let skill = try decoder.decode(Skill.self, from: data)
        #expect(skill.id == "owner/repo:skill")
    }

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
