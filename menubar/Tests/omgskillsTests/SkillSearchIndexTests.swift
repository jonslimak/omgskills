import Testing
import Foundation
@testable import omgskills

struct SkillSearchIndexTests {
    @Test func appstoreSkillRanksAppStoreMatches() throws {
        let results = try search("appstore skill", in: [
            skill(name: "design-html", description: "Build HTML pages and design systems.", stars: 78_646),
            skill(name: "app-store-review", description: "Evaluates code against Apple's App Store Review Guidelines.", stars: 81),
            skill(name: "appstore-connect", description: "Manage Apple App Store Connect metadata.", stars: 6),
        ])

        #expect(results.map(\.name).prefix(2) == ["app-store-review", "appstore-connect"])
    }

    @Test func iosDesignRequiresBothTermsFirst() throws {
        let results = try search("ios design", in: [
            skill(name: "design-html", description: "Design production HTML pages.", stars: 78_646),
            skill(name: "ios-swift", description: "Expert iOS development with SwiftUI and app architecture.", stars: 208),
            skill(name: "apple-hig-designer", description: "Design Apple-style iOS and macOS interfaces.", stars: 109),
        ])

        #expect(results.first?.name == "apple-hig-designer")
        #expect(results.dropFirst().map(\.name).contains("design-html"))
    }

    @Test func uiDesignPrefersStrongRelevantMatchesThenStars() throws {
        let results = try search("ui design", in: [
            skill(name: "design-consultation", description: "Design systems and UI direction.", stars: 78_646),
            skill(name: "ui-design-workflow", description: "Implement UI components and frontend pages.", stars: 3),
            skill(name: "api-client", description: "Build API clients.", stars: 90_000),
        ])

        #expect(results.map(\.name) == ["design-consultation", "ui-design-workflow"])
    }

    @Test func stopwordOnlyQueryStillSearches() throws {
        let results = try search("skill", in: [
            skill(name: "skill-writer", description: "Guide users through creating Agent Skills.", stars: 10),
            skill(name: "design-html", description: "Design finalization.", stars: 78_646),
        ])

        #expect(results.first?.name == "skill-writer")
    }

    @Test func partialMatchesAppearAfterAllTermMatches() throws {
        let results = try search("ios design", in: [
            skill(name: "design-html", description: "Design production HTML pages.", stars: 78_646),
            skill(name: "ios-design-stack", description: "Invocable iOS design pipeline.", stars: 0),
        ])

        #expect(results.map(\.name) == ["ios-design-stack", "design-html"])
    }

    @Test func lowStarSkillsAreDemotedWithinComparableMatches() throws {
        let results = try search("ui design", in: [
            skill(name: "ui-design-workflow", description: "UI design workflow.", stars: 2),
            skill(name: "interface-design-review", description: "UI design review.", stars: 12),
        ])

        #expect(results.map(\.name) == ["interface-design-review", "ui-design-workflow"])
    }

    @Test func collectionLikeSkillsAreDemotedWithinComparableMatches() throws {
        let results = try search("browser use", in: [
            skill(name: "browser-use", description: "Browser automation skill.", stars: 500),
            skill(name: "browser-use-catalog", description: "Browser use skill collection.", stars: 220_000, provenanceType: "repackaged"),
        ])

        #expect(results.map(\.name) == ["browser-use", "browser-use-catalog"])
    }

    @Test func cjkHeavyDescriptionsAreDemotedWithinComparableMatches() throws {
        let results = try search("ui design", in: [
            skill(name: "z-english-ui", description: "UI design workflow for frontend apps.", stars: 100),
            skill(name: "a-cjk-ui", description: "UI design 抖音搜索优化短视频搜索排名关键词策略算法规则内容增长用户研究", stars: 100),
        ])

        #expect(results.map(\.name) == ["z-english-ui", "a-cjk-ui"])
    }

    @Test func mixedEnglishCJKDescriptionsAreNotDemoted() {
        let mixed = skill(
            name: "mixed-ui",
            description: "UI design workflow for frontend apps with 抖音 notes.",
            stars: 100
        )

        #expect(mixed.searchQualityPenalty == 0)
    }

    @Test func cjkHeavySkillsRemainSearchableByDirectQuery() throws {
        let results = try search("douyin seo", in: [
            skill(name: "douyin-seo", description: "抖音搜索优化短视频搜索排名关键词策略算法规则内容增长用户研究", stars: 100),
        ])

        #expect(results.map(\.name) == ["douyin-seo"])
    }

    @Test func collectionLikeSkillsRemainSearchable() throws {
        let results = try search("browser use catalog", in: [
            skill(name: "browser-use-catalog", description: "Browser use skill collection.", stars: 220_000, provenanceType: "catalog"),
        ])

        #expect(results.map(\.name) == ["browser-use-catalog"])
    }

    @Test func knownCollectionRepoIsDemotedEvenWhenMarkedOriginal() throws {
        let results = try search("tools", in: [
            skill(name: "ecc-tools-cost-audit", description: "ECC Tools burn audit.", stars: 174_000, publisherRepo: "affaan-m/everything-claude-code", provenanceType: "original"),
            skill(name: "conversion-tools-automation", description: "Automate Conversion Tools tasks.", stars: 58_000),
        ])

        #expect(results.map(\.name) == ["conversion-tools-automation", "ecc-tools-cost-audit"])
    }

    @Test @MainActor func fallbackSearchDemotesCollectionLikeSkills() {
        let store = SkillsStore()
        let results = store.search(query: "browser use", in: [
            skill(name: "browser-use", description: "Browser automation skill.", stars: 500),
            skill(name: "browser-use-catalog", description: "Browser use skill collection.", stars: 220_000, provenanceType: "repackaged"),
        ], source: .available, usingIndex: false)

        #expect(results.map(\.name) == ["browser-use", "browser-use-catalog"])
    }

    @Test func searchDoesNotNormalizeLargeReadmesPerKeystroke() throws {
        let readme = String(repeating: "long documentation text ", count: 250)
        let skills = (0..<5_000).map { i in
            skill(
                name: i == 4_999 ? "ios-design-stack" : "utility-\(i)",
                description: i == 4_999 ? "Invocable iOS design pipeline." : "General helper.",
                readmeSnippet: readme,
                stars: i
            )
        }
        let index = try SkillSearchIndex(skills: skills)

        let start = Date()
        let results = index.search(query: "ios design", in: skills)
        let elapsed = Date().timeIntervalSince(start)

        #expect(results.first?.name == "ios-design-stack")
        #expect(elapsed < 0.25)
    }

    private func search(_ query: String, in skills: [Skill]) throws -> [Skill] {
        let index = try SkillSearchIndex(skills: skills)
        return index.search(query: query, in: skills)
    }

    private func skill(
        name: String,
        description: String,
        tags: [String] = [],
        readmeSnippet: String? = nil,
        stars: Int,
        publisherRepo: String? = nil,
        provenanceType: String? = nil
    ) -> Skill {
        Skill(
            id: name,
            name: name,
            description: description,
            githubUrl: "https://github.com/example/\(name)",
            installCmd: "git clone https://github.com/example/\(name) ~/.claude/skills/\(name)",
            authorHandle: "example",
            tags: tags,
            readmeSnippet: readmeSnippet,
            stars: stars,
            lastUpdated: "2026-04-23T00:00:00Z",
            firstSeen: "2026-04-23",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: nil,
            isSymlink: nil,
            isLocalOnly: nil,
            publisherRepo: publisherRepo,
            provenanceType: provenanceType
        )
    }
}
