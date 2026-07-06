import Foundation

@MainActor
final class SkillsStore: ObservableObject {
    @Published private(set) var availableSkills: [Skill] = []
    @Published private(set) var trendingSkills: [Skill] = []
    @Published private(set) var twitterSkills: [Skill] = []
    @Published private(set) var collections: [SkillCollection] = []
    @Published private(set) var installedSkills: [Skill] = []
    @Published private(set) var installedSkillInstallations: [Skill] = []
    @Published private(set) var installedSummary = InstalledSkillSummary()
    @Published private(set) var identityMeasurement = SkillIdentityMeasurement()
    @Published private(set) var loadError: String?
    @Published private(set) var trendingLoadError: String?
    @Published private(set) var twitterLoadError: String?
    @Published private(set) var availableSearchIndex: SkillSearchIndex?
    @Published private(set) var trendingSearchIndex: SkillSearchIndex?
    @Published private(set) var twitterSearchIndex: SkillSearchIndex?
    @Published private(set) var searchIndexVersion = 0
    private var trendingEntries: [TrendingEntry] = []
    private var trendingBaseSkills: [Skill] = []
    private var shaHistory: ShaHistoryAsset?
    private var loadGeneration = 0
    private var availableIndexTask: Task<Void, Never>?
    private var trendingIndexTask: Task<Void, Never>?
    private var twitterIndexTask: Task<Void, Never>?

    init(autoload: Bool = true) {
        if autoload {
            load()
        }
    }

    func load() {
        Task { await loadLibraryData() }
        loadInstalled()
    }

    func refreshInstalled() {
        loadInstalled()
    }

    func refreshRemoteDataIfNeeded(force: Bool = false) async {
        let result = await DataRefreshService.refreshIfNeeded(trigger: .launch, force: force)
        if result == .updated {
            await loadLibraryData()
        }
    }

    func reloadLibraryData() async {
        await loadLibraryData()
    }

    func search(query: String, in pool: [Skill], source: Source, usingIndex: Bool = true) -> [Skill] {
        if usingIndex {
            switch source {
            case .available:
                return availableSearchIndex?.search(query: query, in: pool) ?? pool
            case .trending:
                return trendingSearchIndex?.search(query: query, in: pool) ?? pool
            case .twitter:
                return twitterSearchIndex?.search(query: query, in: pool) ?? pool
            case .installed:
                break
            }
        }
        return linearSearch(query: query, in: pool)
    }

    // MARK: - Private

    private func loadLibraryData() async {
        loadGeneration += 1
        let generation = loadGeneration
        availableIndexTask?.cancel()
        trendingIndexTask?.cancel()
        twitterIndexTask?.cancel()

        async let availableResult = decodeAvailableSkills()
        async let trendingResult = decodeTrendingEntries()
        async let twitterResult = decodeTwitterSkills()
        async let collectionsResult = decodeCollections()
        async let shaHistoryResult = decodeShaHistory()

        let available = await availableResult
        let trending = await trendingResult
        let twitter = await twitterResult
        let collections = await collectionsResult
        let shaHistory = await shaHistoryResult
        guard generation == loadGeneration else { return }

        applyDecodedLibraryData(
            available: available,
            trending: trending,
            twitter: twitter,
            collections: collections,
            shaHistory: shaHistory,
            generation: generation
        )
    }

    func applyDecodedLibraryData(
        available: LoadResult<[Skill]>,
        trending: LoadResult<[TrendingEntry]>,
        twitter: LoadResult<[Skill]>,
        collections: LoadResult<[SkillCollection]> = .success([]),
        shaHistory: LoadResult<ShaHistoryAsset?> = .success(nil),
        generation: Int? = nil,
        buildIndexes: Bool = true
    ) {
        let generation = generation ?? loadGeneration

        switch available {
        case .success(let skills):
            availableSkills = skills.sorted { $0.stars > $1.stars }
            trendingBaseSkills = skills
            loadError = nil
            if buildIndexes {
                buildIndex(for: availableSkills, kind: .available, generation: generation)
            }
        case .failure(let error):
            loadError = error
        }

        switch trending {
        case .success(let entries):
            trendingEntries = entries
            trendingLoadError = nil
            rebuildTrending(generation: generation, buildIndex: buildIndexes)
        case .failure(let error):
            trendingLoadError = error
        }

        switch twitter {
        case .success(let skills):
            twitterSkills = skills.sorted {
                (($0.tweetLikes ?? 0), $0.stars, $0.name) >
                (($1.tweetLikes ?? 0), $1.stars, $1.name)
            }
            twitterLoadError = nil
            if buildIndexes {
                buildIndex(for: twitterSkills, kind: .twitter, generation: generation)
            }
        case .failure(let error):
            twitterLoadError = error
        }

        switch collections {
        case .success(let collections):
            self.collections = collections
        case .failure:
            break
        }

        switch shaHistory {
        case .success(let shaHistory):
            self.shaHistory = shaHistory
        case .failure:
            break
        }

        resolveInstalledIdentities()
    }

    func collection(id: String) -> SkillCollection? {
        collections.first { $0.id == id }
    }

    func authorCollection(for handle: String) -> SkillCollection? {
        let normalized = normalizeHandle(handle)
        return collections.first {
            $0.type == .author && normalizeHandle($0.authorHandle ?? "") == normalized
        }
    }

    func featuredSkills(for collection: SkillCollection) -> [Skill] {
        skills(for: collection.featuredSkillIds)
    }

    func allSkills(for collection: SkillCollection) -> [Skill] {
        switch collection.type {
        case .author:
            guard let authorHandle = collection.authorHandle else { return featuredSkills(for: collection) }
            let normalized = normalizeHandle(authorHandle)
            return availableSkills
                .filter { normalizeHandle($0.authorHandle) == normalized }
                .sorted { lhs, rhs in
                    if lhs.stars != rhs.stars {
                        return lhs.stars > rhs.stars
                    }
                    return lhs.name.localizedCompare(rhs.name) == .orderedAscending
                }
        case .topic:
            return skills(for: collection.skillIds ?? collection.featuredSkillIds)
        }
    }

    private nonisolated func decodeAvailableSkills() async -> LoadResult<[Skill]> {
        if DataRefreshService.activeTrack() == .crawl4 {
            let crawl4 = await decodeCrawl4AvailableSkills()
            if case .success = crawl4 {
                return crawl4
            }
        }
        return await decodeProductionAvailableSkills()
    }

    private nonisolated func decodeCrawl4AvailableSkills() async -> LoadResult<[Skill]> {
        if let data = DataRefreshService.cachedData(for: .skills, track: .crawl4) {
            let decoded = await decode(data, as: [Skill].self, label: "crawl4-skills.json")
            if case .success = decoded {
                return decoded
            }
            DataRefreshService.removeCachedData(for: .skills, track: .crawl4)
        }

        guard let url = AppResource.shadowAssetURL(for: .cutoverSkills) else {
            return .failure("Crawl 4 skills not found. Run npm run scrape:shadow or publish /data/crawl4.")
        }
        do {
            let data = try Data(contentsOf: url)
            return await decode(data, as: [Skill].self, label: "skills.cutover.shadow.json")
        } catch {
            return .failure("Failed to load Crawl 4 skills: \(error)")
        }
    }

    private nonisolated func decodeProductionAvailableSkills() async -> LoadResult<[Skill]> {
        if let data = DataRefreshService.cachedData(for: .skills, track: .productionV2) {
            let decoded = await decode(data, as: [Skill].self, label: "skills.json")
            if case .success = decoded {
                return decoded
            }
            DataRefreshService.removeCachedData(for: .skills, track: .productionV2)
        }

        guard let url = Bundle.main.url(forResource: "skills", withExtension: "json") else {
            return .failure("skills.json not found in app bundle")
        }
        do {
            let data = try Data(contentsOf: url)
            return await decode(data, as: [Skill].self, label: "skills.json")
        } catch {
            return .failure("Failed to load bundled skills.json: \(error)")
        }
    }

    private nonisolated func decodeTrendingEntries() async -> LoadResult<[TrendingEntry]> {
        if DataRefreshService.activeTrack() == .crawl4,
           let data = DataRefreshService.cachedData(for: .trending, track: .crawl4) {
            let decoded = await decode(data, as: [TrendingEntry].self, label: "crawl4-trending.json")
            if case .success = decoded {
                return decoded
            }
            DataRefreshService.removeCachedData(for: .trending, track: .crawl4)
        }

        if let data = DataRefreshService.cachedData(for: .trending, track: .productionV2) {
            let decoded = await decode(data, as: [TrendingEntry].self, label: "trending.json")
            if case .success = decoded {
                return decoded
            }
            DataRefreshService.removeCachedData(for: .trending, track: .productionV2)
        }

        guard let url = Bundle.main.url(forResource: "trending", withExtension: "json") else {
            return .failure("trending.json not found in app bundle")
        }
        do {
            let data = try Data(contentsOf: url)
            return await decode(data, as: [TrendingEntry].self, label: "trending.json")
        } catch {
            return .failure("Failed to load bundled trending.json: \(error)")
        }
    }

    private nonisolated func decodeTwitterSkills() async -> LoadResult<[Skill]> {
        if DataRefreshService.activeTrack() == .crawl4,
           let data = DataRefreshService.cachedData(for: .xTrending, track: .crawl4) {
            let decoded = await decode(data, as: [Skill].self, label: "crawl4-x-trending.json")
            if case .success = decoded {
                return decoded
            }
            DataRefreshService.removeCachedData(for: .xTrending, track: .crawl4)
        }

        if let data = DataRefreshService.cachedData(for: .xTrending, track: .productionV2) {
            let decoded = await decode(data, as: [Skill].self, label: "x-trending.json")
            if case .success = decoded {
                return decoded
            }
            DataRefreshService.removeCachedData(for: .xTrending, track: .productionV2)
        }

        if DataRefreshService.activeTrack() == .productionV2,
           DataRefreshService.remoteXTrendingEnabled() == false {
            return .success([])
        }

        guard let url = Bundle.main.url(forResource: "x-trending", withExtension: "json") else {
            return .success([])
        }
        do {
            let data = try Data(contentsOf: url)
            return await decode(data, as: [Skill].self, label: "x-trending.json")
        } catch {
            return .failure("Failed to load bundled x-trending.json: \(error)")
        }
    }

    private nonisolated func decodeCollections() async -> LoadResult<[SkillCollection]> {
        if DataRefreshService.activeTrack() == .crawl4,
           let data = DataRefreshService.cachedData(for: .collections, track: .crawl4) {
            let decoded = await decode(data, as: CollectionsAsset.self, label: "crawl4-collections.json")
            switch decoded {
            case .success(let asset):
                return .success(asset.collections)
            case .failure(let error):
                DataRefreshService.removeCachedData(for: .collections, track: .crawl4)
                return .failure(error)
            }
        }

        if let data = DataRefreshService.cachedData(for: .collections, track: .productionV2) {
            let decoded = await decode(data, as: CollectionsAsset.self, label: "collections.json")
            switch decoded {
            case .success(let asset):
                return .success(asset.collections)
            case .failure(let error):
                DataRefreshService.removeCachedData(for: .collections, track: .productionV2)
                return .failure(error)
            }
        }

        if let bundled = bundledCollectionsData() {
            let decoded = await decode(bundled.data, as: CollectionsAsset.self, label: bundled.label)
            switch decoded {
            case .success(let asset):
                return .success(asset.collections)
            case .failure(let error):
                return .failure(error)
            }
        }

        return .success([])
    }

    private nonisolated func decodeShaHistory() async -> LoadResult<ShaHistoryAsset?> {
        if DataRefreshService.activeTrack() == .crawl4,
           let data = DataRefreshService.cachedData(for: .shaHistory, track: .crawl4) {
            let decoded = await decode(data, as: ShaHistoryAsset.self, label: "crawl4-sha-history.json")
            switch decoded {
            case .success(let asset):
                return .success(asset)
            case .failure(let error):
                DataRefreshService.removeCachedData(for: .shaHistory, track: .crawl4)
                return .failure(error)
            }
        }

        if let data = DataRefreshService.cachedData(for: .shaHistory, track: .productionV2) {
            let decoded = await decode(data, as: ShaHistoryAsset.self, label: "sha-history.json")
            switch decoded {
            case .success(let asset):
                return .success(asset)
            case .failure(let error):
                DataRefreshService.removeCachedData(for: .shaHistory, track: .productionV2)
                return .failure(error)
            }
        }

        if let bundled = bundledShaHistoryData() {
            let decoded = await decode(bundled.data, as: ShaHistoryAsset.self, label: bundled.label)
            switch decoded {
            case .success(let asset):
                return .success(asset)
            case .failure(let error):
                return .failure(error)
            }
        }

        return .success(nil)
    }

    private nonisolated func bundledCollectionsData() -> (data: Data, label: String)? {
        guard let manifestURL = Bundle.main.url(forResource: "manifest", withExtension: "json"),
              let manifestData = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(DataRefreshService.Manifest.self, from: manifestData),
              let collectionsPath = manifest.collections?.path else {
            return nil
        }

        let collectionsURL = manifestURL.deletingLastPathComponent().appendingPathComponent(collectionsPath)
        guard let data = try? Data(contentsOf: collectionsURL) else {
            return nil
        }
        return (data, collectionsURL.lastPathComponent)
    }

    private nonisolated func bundledShaHistoryData() -> (data: Data, label: String)? {
        guard let manifestURL = Bundle.main.url(forResource: "manifest", withExtension: "json"),
              let manifestData = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(DataRefreshService.Manifest.self, from: manifestData),
              let shaHistoryPath = manifest.shaHistory?.path else {
            return nil
        }

        let shaHistoryURL = manifestURL.deletingLastPathComponent().appendingPathComponent(shaHistoryPath)
        guard let data = try? Data(contentsOf: shaHistoryURL) else {
            return nil
        }
        return (data, shaHistoryURL.lastPathComponent)
    }

    private nonisolated func decode<T: Decodable & Sendable>(_ data: Data, as type: T.Type, label: String) async -> LoadResult<T> {
        await Task.detached(priority: .userInitiated) {
            do {
                let decoder = JSONDecoder()
                decoder.keyDecodingStrategy = .convertFromSnakeCase
                return .success(try decoder.decode(type, from: data))
            } catch {
                return .failure("Failed to decode \(label): \(error)")
            }
        }.value
    }

    private func loadInstalled() {
        let result = InstalledSkillsScanner.scanWithSummary()
        installedSkills = result.skills
        installedSkillInstallations = result.installations
        installedSummary = result.summary
        resolveInstalledIdentities()
    }

    private func resolveInstalledIdentities() {
        guard !installedSkills.isEmpty || !installedSkillInstallations.isEmpty else {
            identityMeasurement = SkillIdentityMeasurement()
            return
        }

        let resolver = SkillIdentityResolver(catalogSkills: availableSkills, shaHistory: shaHistory)
        let resolvedSkills = resolver.resolve(installedSkills)
        let resolvedInstallations = resolver.resolve(installedSkillInstallations)

        installedSkills = resolvedSkills.skills
        installedSkillInstallations = resolvedInstallations.skills
        identityMeasurement = resolvedInstallations.measurement
        print("[SkillIdentityResolver] provenance=\(identityMeasurement.resolvedByProvenance) git=\(identityMeasurement.resolvedByGit) sha=\(identityMeasurement.resolvedBySha) ambiguous=\(identityMeasurement.ambiguous) localOnly=\(identityMeasurement.localOnly)")
    }

    private func linearSearch(query: String, in skills: [Skill]) -> [Skill] {
        let terms = query.lowercased().split(separator: " ").map(String.init)
        guard !terms.isEmpty else { return skills }
        return skills.filter { skill in
            let blob = "\(skill.name) \(skill.description) \(skill.authorHandle) \(skill.tags.joined(separator: " "))".lowercased()
            return terms.allSatisfy { blob.contains($0) }
        }.sorted { lhs, rhs in
            if lhs.searchQualityPenalty != rhs.searchQualityPenalty {
                return lhs.searchQualityPenalty < rhs.searchQualityPenalty
            }
            if lhs.stars != rhs.stars {
                return lhs.stars > rhs.stars
            }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }
    }

    private func skills(for ids: [String]) -> [Skill] {
        let byId = Dictionary(uniqueKeysWithValues: availableSkills.map { ($0.id, $0) })
        return ids.compactMap { byId[$0] }
    }

    private func normalizeHandle(_ handle: String) -> String {
        var normalized = handle.trimmingCharacters(in: .whitespacesAndNewlines)
        while normalized.hasPrefix("@") {
            normalized.removeFirst()
        }
        return normalized.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private enum IndexKind {
        case available
        case trending
        case twitter
    }

    enum LoadResult<T: Sendable>: Sendable {
        case success(T)
        case failure(String)
    }

    private func rebuildTrending(generation: Int, buildIndex shouldBuildIndex: Bool = true) {
        let byId = Dictionary(uniqueKeysWithValues: trendingBaseSkills.map { ($0.id, $0) })
        trendingSkills = trendingEntries.compactMap { entry in
            byId[entry.id]?.withTrending(entry)
        }
        if trendingSkills.isEmpty && !trendingEntries.isEmpty && !availableSkills.isEmpty {
            trendingLoadError = "No trending ids matched the local library"
        } else if trendingLoadError == nil || trendingLoadError == "No trending ids matched the local library" {
            trendingLoadError = nil
        }
        if shouldBuildIndex {
            buildIndex(for: trendingSkills, kind: .trending, generation: generation)
        }
    }

    private func buildIndex(for skills: [Skill], kind: IndexKind, generation: Int) {
        let task = Task { [weak self] in
            do {
                let index = try await Task.detached(priority: .userInitiated) {
                    try SkillSearchIndex(skills: skills)
                }.value
                guard !Task.isCancelled else { return }
                guard let self, generation == self.loadGeneration else { return }
                switch kind {
                case .available:
                    self.availableSearchIndex = index
                case .trending:
                    self.trendingSearchIndex = index
                case .twitter:
                    self.twitterSearchIndex = index
                }
                self.searchIndexVersion += 1
            } catch {
                print("[SkillsStore] FTS index build failed: \(error)")
            }
        }
        switch kind {
        case .available:
            availableIndexTask = task
        case .trending:
            trendingIndexTask = task
        case .twitter:
            twitterIndexTask = task
        }
    }
}
