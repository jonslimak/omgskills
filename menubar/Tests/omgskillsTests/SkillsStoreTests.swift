import Testing
@testable import omgskills

@MainActor
struct SkillsStoreTests {
    @Test func failedAvailableReloadKeepsVisibleSkills() {
        let store = makeStore()
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
        let store = makeStore()
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
        let store = makeStore()
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
        let store = makeStore()
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

    @Test func failedCollectionsReloadKeepsVisibleCollections() {
        let store = makeStore()
        let existing = collection(id: "author-openai", type: .author, title: "OpenAI", authorHandle: "openai")

        store.applyDecodedLibraryData(
            available: .success([]),
            trending: .success([]),
            twitter: .success([]),
            collections: .success([existing]),
            buildIndexes: false
        )
        store.applyDecodedLibraryData(
            available: .success([]),
            trending: .success([]),
            twitter: .success([]),
            collections: .failure("collections failed"),
            buildIndexes: false
        )

        #expect(store.collections.map(\.id) == ["author-openai"])
    }

    @Test func collectionHelpersLookupAuthorsAndSkills() {
        let store = makeStore()
        let openAISkill = skill(name: "openai-skill", stars: 20, authorHandle: "openai")
        let cursorSkill = skill(name: "cursor-skill", stars: 10, authorHandle: "cursor")
        let authorCollection = collection(
            id: "author-openai",
            type: .author,
            title: "OpenAI",
            authorHandle: "OpenAI",
            featuredSkillIds: [openAISkill.id]
        )
        let topicCollection = collection(
            id: "starter-pack",
            type: .topic,
            title: "Starter Pack",
            featuredSkillIds: [cursorSkill.id],
            skillIds: [cursorSkill.id, openAISkill.id]
        )

        store.applyDecodedLibraryData(
            available: .success([cursorSkill, openAISkill]),
            trending: .success([]),
            twitter: .success([]),
            collections: .success([authorCollection, topicCollection]),
            buildIndexes: false
        )

        #expect(store.collection(id: "starter-pack")?.title == "Starter Pack")
        #expect(store.authorCollection(for: "@openai")?.id == "author-openai")
        #expect(store.featuredSkills(for: topicCollection).map(\.id) == [cursorSkill.id])
        #expect(store.allSkills(for: topicCollection).map(\.id) == [cursorSkill.id, openAISkill.id])
        #expect(store.allSkills(for: authorCollection).map(\.id) == [openAISkill.id])
    }

    @Test func installedIdentitySnapshotIsReadyOnlyAfterScanAndPreservesInstallations() {
        let store = makeStore()
        let catalog = skill(name: "review", stars: 10)
        store.applyDecodedLibraryData(
            available: .success([catalog]),
            trending: .success([]),
            twitter: .success([]),
            buildIndexes: false
        )
        #expect(store.isInstalledIdentityReady == false)

        let claude = installedSkill(name: "review", origin: "Claude")
        let codex = installedSkill(name: "review", origin: "Codex")
        store.applyInstalledScanResult(.init(
            skills: [claude],
            installations: [claude, codex],
            summary: InstalledSkillSummary(totalInstallations: 2)
        ))

        #expect(store.isInstalledIdentityReady)
        #expect(store.installedSkillInstallations.count == 2)
        #expect(store.installedSkillInstallations.allSatisfy { $0.catalogSkillId == catalog.id })
        #expect(store.installedSkillInstallations.allSatisfy { $0.identityStatus == .resolved(method: .git) })
    }

    @Test func completedEmptyScanProducesReadyEmptySnapshot() {
        let store = makeStore()

        store.applyInstalledScanResult(.init(
            skills: [],
            installations: [],
            summary: InstalledSkillSummary()
        ))

        #expect(store.isInstalledIdentityReady)
        #expect(store.installedSkillInstallations.isEmpty)
    }

    @Test func identityMeasurementReportsOnceAfterCatalogAndScanAreReady() {
        var reports: [(SkillIdentityMeasurement, LibraryDataTrack)] = []
        let store = SkillsStore(
            autoload: false,
            identityMeasurementReporter: { measurement, track in
                reports.append((measurement, track))
            }
        )
        let catalog = skill(name: "review", stars: 10)
        let installed = installedSkill(name: "review", origin: "Claude")

        store.applyDecodedLibraryData(
            available: .failure("catalog unavailable"),
            trending: .success([]),
            twitter: .success([]),
            buildIndexes: false
        )
        store.applyInstalledScanResult(.init(
            skills: [installed],
            installations: [installed],
            summary: InstalledSkillSummary(totalInstallations: 1)
        ))
        #expect(reports.isEmpty)

        store.applyDecodedLibraryData(
            available: .success([catalog]),
            trending: .success([]),
            twitter: .success([]),
            buildIndexes: false
        )
        #expect(reports.count == 1)
        #expect(reports.first?.0.totalInstalled == 1)
        #expect(reports.first?.0.resolvedByGit == 1)

        store.applyInstalledScanResult(.init(
            skills: [installed],
            installations: [installed],
            summary: InstalledSkillSummary(totalInstallations: 1)
        ))
        #expect(reports.count == 1)
    }

    @Test func completedEmptyScanReportsZeroMeasurement() {
        var reports: [SkillIdentityMeasurement] = []
        let store = SkillsStore(
            autoload: false,
            identityMeasurementReporter: { measurement, _ in
                reports.append(measurement)
            }
        )

        store.applyDecodedLibraryData(
            available: .success([]),
            trending: .success([]),
            twitter: .success([]),
            buildIndexes: false
        )
        store.applyInstalledScanResult(.init(
            skills: [],
            installations: [],
            summary: InstalledSkillSummary()
        ))
        #expect(reports.isEmpty)

        store.applyDecodedLibraryData(
            available: .success([skill(name: "catalog-skill", stars: 10)]),
            trending: .success([]),
            twitter: .success([]),
            buildIndexes: false
        )

        #expect(reports.count == 1)
        #expect(reports.first?.totalInstalled == 0)
    }

    private func trendingEntry(id: String) -> TrendingEntry {
        TrendingEntry(
            id: id,
            installs: 100,
            trendingRank: 1,
            trendingSource: "test"
        )
    }

    private func makeStore() -> SkillsStore {
        SkillsStore(
            autoload: false,
            identityMeasurementReporter: { _, _ in }
        )
    }

    private func skill(
        name: String,
        stars: Int,
        authorHandle: String = "example",
        tweetLikes: Int? = nil
    ) -> Skill {
        Skill(
            id: name,
            name: name,
            description: "Test skill",
            githubUrl: "https://github.com/example/\(name)",
            installCmd: "git clone https://github.com/example/\(name) ~/.claude/skills/\(name)",
            authorHandle: authorHandle,
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

    private func collection(
        id: String,
        type: CollectionType,
        title: String,
        authorHandle: String? = nil,
        featuredSkillIds: [String] = [],
        skillIds: [String]? = nil
    ) -> SkillCollection {
        SkillCollection(
            id: id,
            type: type,
            title: title,
            subtitle: "Test collection",
            authorHandle: authorHandle,
            imageUrl: nil,
            featuredSkillIds: featuredSkillIds,
            skillIds: skillIds,
            description: nil
        )
    }

    private func installedSkill(name: String, origin: String) -> Skill {
        Skill(
            id: "installed:/Users/test/.\(origin.lowercased())/skills/\(name)",
            name: name,
            description: "Test skill",
            githubUrl: "https://github.com/example/\(name)",
            installCmd: "/Users/test/.\(origin.lowercased())/skills/\(name)",
            authorHandle: "example",
            tags: [],
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: "2026-04-23T00:00:00Z",
            firstSeen: "",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: origin,
            isSymlink: false,
            isLocalOnly: false
        )
    }
}
