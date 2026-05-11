import Foundation

@MainActor
final class SkillsStore: ObservableObject {
    @Published private(set) var availableSkills: [Skill] = []
    @Published private(set) var trendingSkills: [Skill] = []
    @Published private(set) var twitterSkills: [Skill] = []
    @Published private(set) var installedSkills: [Skill] = []
    @Published private(set) var installedSkillInstallations: [Skill] = []
    @Published private(set) var installedSummary = InstalledSkillSummary()
    @Published private(set) var loadError: String?
    @Published private(set) var trendingLoadError: String?
    @Published private(set) var twitterLoadError: String?
    @Published private(set) var availableSearchIndex: SkillSearchIndex?
    @Published private(set) var trendingSearchIndex: SkillSearchIndex?
    @Published private(set) var twitterSearchIndex: SkillSearchIndex?
    @Published private(set) var searchIndexVersion = 0
    private var trendingEntries: [TrendingEntry] = []
    private var loadGeneration = 0
    private var availableIndexTask: Task<Void, Never>?
    private var trendingIndexTask: Task<Void, Never>?
    private var twitterIndexTask: Task<Void, Never>?

    init() { load() }

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

        let available = await availableResult
        let trending = await trendingResult
        let twitter = await twitterResult
        guard generation == loadGeneration else { return }

        switch available {
        case .success(let skills):
            availableSkills = skills.sorted { $0.stars > $1.stars }
            loadError = nil
            buildIndex(for: availableSkills, kind: .available, generation: generation)
        case .failure(let error):
            loadError = error
        }

        switch trending {
        case .success(let entries):
            trendingEntries = entries
            trendingLoadError = nil
        case .failure(let error):
            trendingEntries = []
            trendingSkills = []
            trendingLoadError = error
        }

        rebuildTrending()

        switch twitter {
        case .success(let skills):
            twitterSkills = skills.sorted {
                (($0.tweetLikes ?? 0), $0.stars, $0.name) >
                (($1.tweetLikes ?? 0), $1.stars, $1.name)
            }
            twitterLoadError = nil
            buildIndex(for: twitterSkills, kind: .twitter, generation: generation)
        case .failure(let error):
            twitterSkills = []
            twitterLoadError = error
        }
    }

    private nonisolated func decodeAvailableSkills() async -> LoadResult<[Skill]> {
        if let data = DataRefreshService.cachedData(for: .skills) {
            let decoded = await decode(data, as: [Skill].self, label: "skills.json")
            if case .success = decoded {
                return decoded
            }
            DataRefreshService.removeCachedData(for: .skills)
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
        if let data = DataRefreshService.cachedData(for: .trending) {
            let decoded = await decode(data, as: [TrendingEntry].self, label: "trending.json")
            if case .success = decoded {
                return decoded
            }
            DataRefreshService.removeCachedData(for: .trending)
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
        if let data = DataRefreshService.cachedData(for: .xTrending) {
            let decoded = await decode(data, as: [Skill].self, label: "x-trending.json")
            if case .success = decoded {
                return decoded
            }
            DataRefreshService.removeCachedData(for: .xTrending)
        }

        if DataRefreshService.remoteXTrendingEnabled() == false {
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
    }

    private func linearSearch(query: String, in skills: [Skill]) -> [Skill] {
        let terms = query.lowercased().split(separator: " ").map(String.init)
        guard !terms.isEmpty else { return skills }
        return skills.filter { skill in
            let blob = "\(skill.name) \(skill.description) \(skill.authorHandle) \(skill.tags.joined(separator: " "))".lowercased()
            return terms.allSatisfy { blob.contains($0) }
        }
    }

    private enum IndexKind {
        case available
        case trending
        case twitter
    }

    private enum LoadResult<T: Sendable>: Sendable {
        case success(T)
        case failure(String)
    }

    private func rebuildTrending() {
        let byId = Dictionary(uniqueKeysWithValues: availableSkills.map { ($0.id, $0) })
        trendingSkills = trendingEntries.compactMap { entry in
            byId[entry.id]?.withTrending(entry)
        }
        if trendingSkills.isEmpty && !trendingEntries.isEmpty && !availableSkills.isEmpty {
            trendingLoadError = "No trending ids matched the local library"
        } else if trendingLoadError == nil || trendingLoadError == "No trending ids matched the local library" {
            trendingLoadError = nil
        }
        buildIndex(for: trendingSkills, kind: .trending, generation: loadGeneration)
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
