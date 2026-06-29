import Testing
@testable import omgskills

@MainActor
struct SkillsStoreTests {
    @Test func failedAvailableReloadKeepsVisibleSkills() {
        let store = SkillsStore(autoload: false)
        let existing = skill(name: "existing", stars: 10)

        store.applyDecodedLibraryData(
            available: .success([existing]),
            trending: .success([]),
            twitter: .success([]),
            buildIndexes: false
        )
        store.applyDecodedLibraryData(
            available: .failure("available failed"),
            trending: .success([]),
            twitter: .success([]),
            buildIndexes: false
        )

        #expect(store.availableSkills.map(\.id) == ["existing"])
        #expect(store.loadError == "available failed")
    }

    @Test func failedTrendingReloadKeepsVisibleTrendingSkills() {
        let store = SkillsStore(autoload: false)
        let existing = skill(name: "existing", stars: 10)

        store.applyDecodedLibraryData(
            available: .success([existing]),
            trending: .success([trendingEntry(id: existing.id)]),
            twitter: .success([]),
            buildIndexes: false
        )
        store.applyDecodedLibraryData(
            available: .failure("available failed"),
            trending: .failure("trending failed"),
            twitter: .success([]),
            buildIndexes: false
        )

        #expect(store.trendingSkills.map(\.id) == ["existing"])
        #expect(store.trendingLoadError == "trending failed")
    }

    @Test func failedTwitterReloadKeepsVisibleTwitterSkills() {
        let store = SkillsStore(autoload: false)
        let existing = skill(name: "existing", stars: 10, tweetLikes: 50)

        store.applyDecodedLibraryData(
            available: .success([]),
            trending: .success([]),
            twitter: .success([existing]),
            buildIndexes: false
        )
        store.applyDecodedLibraryData(
            available: .success([]),
            trending: .success([]),
            twitter: .failure("twitter failed"),
            buildIndexes: false
        )

        #expect(store.twitterSkills.map(\.id) == ["existing"])
        #expect(store.twitterLoadError == "twitter failed")
    }

    @Test func successfulEmptyTwitterReloadClearsVisibleTwitterSkills() {
        let store = SkillsStore(autoload: false)
        let existing = skill(name: "existing", stars: 10, tweetLikes: 50)

        store.applyDecodedLibraryData(
            available: .success([]),
            trending: .success([]),
            twitter: .success([existing]),
            buildIndexes: false
        )
        store.applyDecodedLibraryData(
            available: .success([]),
            trending: .success([]),
            twitter: .success([]),
            buildIndexes: false
        )

        #expect(store.twitterSkills.isEmpty)
        #expect(store.twitterLoadError == nil)
    }

    private func trendingEntry(id: String) -> TrendingEntry {
        TrendingEntry(
            id: id,
            installs: 100,
            trendingRank: 1,
            trendingSource: "test"
        )
    }

    private func skill(
        name: String,
        stars: Int,
        tweetLikes: Int? = nil
    ) -> Skill {
        Skill(
            id: name,
            name: name,
            description: "Test skill",
            githubUrl: "https://github.com/example/\(name)",
            installCmd: "git clone https://github.com/example/\(name) ~/.claude/skills/\(name)",
            authorHandle: "example",
            tags: [],
            readmeSnippet: nil,
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
            tweetLikes: tweetLikes
        )
    }
}
