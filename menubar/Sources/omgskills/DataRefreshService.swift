import CryptoKit
import Foundation

enum LibraryDataTrack: String, CaseIterable, Identifiable {
    case productionV2
    case crawl4

    var id: String { rawValue }

    var label: String {
        switch self {
        case .productionV2: return "Production"
        case .crawl4: return "Crawl 4"
        }
    }

    var manifestURL: URL {
        switch self {
        case .productionV2:
            return URL(string: "https://omgskills.com/data/v2/manifest.json")!
        case .crawl4:
            return URL(string: "https://omgskills.com/data/crawl4/manifest.json")!
        }
    }

    func cacheFilename(for resource: DataRefreshService.Resource) -> String {
        switch (self, resource) {
        case (.productionV2, .skills): return "skills.json"
        case (.productionV2, .trending): return "trending.json"
        case (.productionV2, .xTrending): return "x-trending.json"
        case (.crawl4, .skills): return "crawl4-skills.json"
        case (.crawl4, .trending): return "crawl4-trending.json"
        case (.crawl4, .xTrending): return "crawl4-x-trending.json"
        }
    }

    var metadataFilename: String {
        switch self {
        case .productionV2: return "metadata.json"
        case .crawl4: return "crawl4-metadata.json"
        }
    }
}

enum LibraryDataMode {
    case productionV2Only
    case crawl4PrimaryWithV2Fallback

    var primaryTrack: LibraryDataTrack {
        switch self {
        case .productionV2Only: return .productionV2
        case .crawl4PrimaryWithV2Fallback: return .crawl4
        }
    }

    var fallbackTracks: [LibraryDataTrack] {
        switch self {
        case .productionV2Only:
            return [.productionV2]
        case .crawl4PrimaryWithV2Fallback:
            return [.crawl4, .productionV2]
        }
    }
}

enum DataRefreshService {
    static let manifestURL = LibraryDataTrack.productionV2.manifestURL
    private static let backgroundCheckInterval: TimeInterval = 24 * 60 * 60
    private static let selectedTrackKey = "LibraryDataTrack.selected"
    private static let activeTrackKey = "LibraryDataTrack.active"

#if DEBUG
    static let defaultDataMode: LibraryDataMode = .crawl4PrimaryWithV2Fallback
#else
    static let defaultDataMode: LibraryDataMode = .productionV2Only
#endif

    enum RefreshTrigger: Sendable {
        case launch
        case panelOpen
        case wake
        case timer
        case scheduler
    }

    enum RefreshResult: Sendable, Equatable {
        case skipped
        case checkedNoChange
        case updated
    }

    enum Resource: String {
        case skills
        case trending
        case xTrending

        var cacheFilename: String {
            activeTrack().cacheFilename(for: self)
        }
    }

    struct Manifest: Codable {
        let version: Int
        let generatedAt: String?
        let skills: Asset
        let trending: Asset?
        let xTrending: Asset?
    }

    struct Asset: Codable {
        let path: String
        let sha256: String
        let bytes: Int
    }

    struct BootstrapState: Sendable {
        let hasSkillsCache: Bool
        let hasActiveSkillsHash: Bool
        let expectsTrending: Bool
        let hasTrendingCache: Bool
        let hasActiveTrendingHash: Bool

        var isIncomplete: Bool {
            guard hasSkillsCache, hasActiveSkillsHash else { return true }
            guard expectsTrending else { return false }
            return !hasTrendingCache || !hasActiveTrendingHash
        }
    }

    private struct Metadata: Codable {
        var activeSkillsHash: String?
        var activeTrendingHash: String?
        var activeXTrendingHash: String?
        var activeLibraryGeneratedAt: String?
        var remoteXTrendingEnabled: Bool?
        var lastCheckedAt: TimeInterval?
        var lastManifestCheckAt: TimeInterval?
        var lastPanelOpenAttemptAt: TimeInterval?
        var lastSuccessfulRefreshAt: TimeInterval?
    }

    static func selectedTrack(
        userDefaults: UserDefaults = .standard
    ) -> LibraryDataTrack {
        guard let rawValue = userDefaults.string(forKey: selectedTrackKey),
              let track = LibraryDataTrack(rawValue: rawValue) else {
            return .productionV2
        }
        return track
    }

    static func setSelectedTrack(
        _ track: LibraryDataTrack,
        userDefaults: UserDefaults = .standard
    ) {
        userDefaults.set(track.rawValue, forKey: selectedTrackKey)
    }

    static func activeTrack(
        userDefaults: UserDefaults = .standard,
        mode: LibraryDataMode = defaultDataMode
    ) -> LibraryDataTrack {
        if mode == .productionV2Only {
            return selectedTrack(userDefaults: userDefaults)
        }
        guard let rawValue = userDefaults.string(forKey: activeTrackKey),
              let track = LibraryDataTrack(rawValue: rawValue) else {
            return mode.primaryTrack
        }
        return track
    }

    static func setActiveTrack(
        _ track: LibraryDataTrack,
        userDefaults: UserDefaults = .standard
    ) {
        userDefaults.set(track.rawValue, forKey: activeTrackKey)
    }

    static func refreshTracks(
        mode: LibraryDataMode = defaultDataMode,
        userDefaults: UserDefaults = .standard
    ) -> [LibraryDataTrack] {
        switch mode {
        case .productionV2Only:
            return [selectedTrack(userDefaults: userDefaults)]
        case .crawl4PrimaryWithV2Fallback:
            return mode.fallbackTracks
        }
    }

    static func shouldFallback(after error: Error) -> Bool {
        !isCancellation(error)
    }

    static func manifestURL(for track: LibraryDataTrack = selectedTrack()) -> URL {
        track.manifestURL
    }

    static func cachedData(for resource: Resource) -> Data? {
        cachedData(for: resource, track: activeTrack())
    }

    static func removeCachedData(for resource: Resource) {
        removeCachedData(for: resource, track: activeTrack())
    }

    static func remoteXTrendingEnabled() -> Bool? {
        loadMetadata(track: activeTrack()).remoteXTrendingEnabled
    }

    static func lastDisplayableDataUpdateDate() -> Date? {
        let track = activeTrack()
        let metadata = loadMetadata(track: track)
        return displayableDataUpdateDate(
            activeLibraryGeneratedAt: metadata.activeLibraryGeneratedAt,
            bundledGeneratedAt: track == .productionV2 ? bundledManifest()?.generatedAt : nil
        )
    }

    static func displayableDataUpdateDate(
        activeLibraryGeneratedAt: String?,
        bundledGeneratedAt: String?
    ) -> Date? {
        if let activeLibraryGeneratedAt,
           let date = parseLibraryDate(activeLibraryGeneratedAt) {
            return date
        }
        if let bundledGeneratedAt,
           let date = parseLibraryDate(bundledGeneratedAt) {
            return date
        }
        return nil
    }

    static func refreshIfNeeded(
        trigger: RefreshTrigger,
        force: Bool = false
    ) async -> RefreshResult {
        let previousActiveTrack = activeTrack()
        let tracks = refreshTracks()

        for track in tracks {
            do {
                let result = try await refreshIfNeeded(trigger: trigger, force: force, track: track)
                setActiveTrack(track)
                return previousActiveTrack == track ? result : .updated
            } catch {
                if !shouldFallback(after: error) {
                    return .skipped
                }
                print("[DataRefreshService] \(track.label) refresh failed: \(error)")
                Analytics.signal("error.refresh_failed", parameters: [
                    "track": track.rawValue,
                    "error": error.localizedDescription
                ])
            }
        }

        return .skipped
    }

    private static func refreshIfNeeded(
        trigger: RefreshTrigger,
        force: Bool,
        track: LibraryDataTrack
    ) async throws -> RefreshResult {
        var metadata = loadMetadata(track: track)
        let now = Date().timeIntervalSince1970
        let bootstrapState = bootstrapState(metadata: metadata, track: track)

        if !force,
           shouldThrottleRefresh(
            trigger: trigger,
            metadata: metadata,
            now: now,
            bootstrapState: bootstrapState
           ) {
            return .skipped
        }

        if trigger == .panelOpen {
            metadata.lastPanelOpenAttemptAt = now
        }
        saveMetadata(metadata, track: track)

        let manifestData = try await download(from: manifestURL(for: track))
        let manifest = try JSONDecoder().decode(Manifest.self, from: manifestData)
        var didUpdate = false
        metadata.lastManifestCheckAt = now
        metadata.lastCheckedAt = now
        metadata.activeLibraryGeneratedAt = manifest.generatedAt
        metadata.remoteXTrendingEnabled = manifest.xTrending != nil

        if shouldUpdateAsset(
            activeHash: metadata.activeSkillsHash,
            hasCachedData: cachedData(for: .skills, track: track) != nil,
            manifestHash: manifest.skills.sha256
        ) {
            let data = try await fetchAndValidate(asset: manifest.skills, decodeAs: [Skill].self, track: track)
            try writeCache(data, for: .skills, track: track)
            metadata.activeSkillsHash = manifest.skills.sha256
            didUpdate = true
        }

        if let trending = manifest.trending,
           shouldUpdateAsset(
            activeHash: metadata.activeTrendingHash,
            hasCachedData: cachedData(for: .trending, track: track) != nil,
            manifestHash: trending.sha256
           ) {
            let data = try await fetchAndValidate(asset: trending, decodeAs: [TrendingEntry].self, track: track)
            try writeCache(data, for: .trending, track: track)
            metadata.activeTrendingHash = trending.sha256
            didUpdate = true
        }

        if let xTrending = manifest.xTrending,
           shouldUpdateAsset(
            activeHash: metadata.activeXTrendingHash,
            hasCachedData: cachedData(for: .xTrending, track: track) != nil,
            manifestHash: xTrending.sha256
           ) {
            do {
                let data = try await fetchAndValidate(asset: xTrending, decodeAs: [Skill].self, track: track)
                try writeCache(data, for: .xTrending, track: track)
                metadata.activeXTrendingHash = xTrending.sha256
                didUpdate = true
            } catch {
                print("[DataRefreshService] xTrending refresh failed: \(error)")
            }
        } else if manifest.xTrending == nil,
                  (cachedData(for: .xTrending, track: track) != nil || metadata.activeXTrendingHash != nil) {
            removeCachedData(for: .xTrending, track: track)
            metadata.activeXTrendingHash = nil
            didUpdate = true
        }

        if didUpdate {
            metadata.lastSuccessfulRefreshAt = Date().timeIntervalSince1970
        }
        saveMetadata(metadata, track: track)
        return didUpdate ? .updated : .checkedNoChange
    }

    private static func shouldThrottleRefresh(
        trigger: RefreshTrigger,
        metadata: Metadata,
        now: TimeInterval,
        bootstrapState: BootstrapState
    ) -> Bool {
        guard !bootstrapState.isIncomplete else { return false }

        switch trigger {
        case .panelOpen:
            return false
        case .launch, .wake, .timer, .scheduler:
            let lastManifestCheckAt = metadata.lastManifestCheckAt ?? metadata.lastCheckedAt
            return shouldThrottleBackgroundRefresh(
                lastManifestCheckAt: lastManifestCheckAt,
                now: now
            )
        }
    }

    static func shouldThrottleBackgroundRefresh(
        lastManifestCheckAt: TimeInterval?,
        now: TimeInterval
    ) -> Bool {
        guard let lastManifestCheckAt else {
            return false
        }
        return now - lastManifestCheckAt < backgroundCheckInterval
    }

    static func shouldThrottlePanelOpenCheck(
        lastPanelOpenAttemptAt: TimeInterval?,
        now: TimeInterval
    ) -> Bool {
        false
    }

    static func shouldThrottleRefresh(
        lastCheckedAt: TimeInterval?,
        now: TimeInterval,
        bootstrapState: BootstrapState
    ) -> Bool {
        guard !bootstrapState.isIncomplete,
              let lastCheckedAt else {
            return false
        }
        return now - lastCheckedAt < backgroundCheckInterval
    }

    static func shouldUpdateAsset(
        activeHash: String?,
        hasCachedData: Bool,
        manifestHash: String
    ) -> Bool {
        guard hasCachedData else { return true }
        return activeHash != manifestHash
    }

    private static func fetchAndValidate<T: Decodable>(asset: Asset, decodeAs type: T.Type, track: LibraryDataTrack) async throws -> Data {
        let url = try assetURL(for: asset, track: track)
        let data = try await download(from: url)

        guard data.count == asset.bytes else {
            throw RefreshError.byteCountMismatch(expected: asset.bytes, actual: data.count)
        }
        guard sha256Hex(data) == asset.sha256 else {
            throw RefreshError.hashMismatch
        }

        _ = try JSONDecoder.snakeCaseDecoder.decode(type, from: data)
        return data
    }

    private static func download(from url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw RefreshError.badHTTPResponse
        }
        return data
    }

    private static func assetURL(for asset: Asset, track: LibraryDataTrack = selectedTrack()) throws -> URL {
        guard let url = URL(string: asset.path, relativeTo: manifestURL(for: track))?.absoluteURL else {
            throw RefreshError.badAssetPath(asset.path)
        }
        return url
    }

    private static func bootstrapState(metadata: Metadata, track: LibraryDataTrack) -> BootstrapState {
        let expectsTrending = track == .productionV2 ? bundledManifest()?.trending != nil : true
        return BootstrapState(
            hasSkillsCache: cachedData(for: .skills, track: track) != nil,
            hasActiveSkillsHash: metadata.activeSkillsHash != nil,
            expectsTrending: expectsTrending,
            hasTrendingCache: cachedData(for: .trending, track: track) != nil,
            hasActiveTrendingHash: metadata.activeTrendingHash != nil
        )
    }

    private static func cacheURL(for resource: Resource, track: LibraryDataTrack) -> URL {
        applicationSupportDirectory().appendingPathComponent(track.cacheFilename(for: resource))
    }

    static func cachedData(for resource: Resource, track: LibraryDataTrack) -> Data? {
        try? Data(contentsOf: cacheURL(for: resource, track: track))
    }

    static func removeCachedData(for resource: Resource, track: LibraryDataTrack) {
        try? FileManager.default.removeItem(at: cacheURL(for: resource, track: track))
    }

    private static func metadataURL(track: LibraryDataTrack) -> URL {
        applicationSupportDirectory().appendingPathComponent(track.metadataFilename)
    }

    private static func applicationSupportDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = base.appendingPathComponent("omgskills", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func loadMetadata(track: LibraryDataTrack) -> Metadata {
        guard let data = try? Data(contentsOf: metadataURL(track: track)) else {
            return Metadata()
        }
        return (try? JSONDecoder().decode(Metadata.self, from: data)) ?? Metadata()
    }

    private static func saveMetadata(_ metadata: Metadata, track: LibraryDataTrack) {
        do {
            let data = try JSONEncoder().encode(metadata)
            try data.write(to: metadataURL(track: track), options: .atomic)
        } catch {
            print("[DataRefreshService] Metadata write failed: \(error)")
        }
    }

    private static func writeCache(_ data: Data, for resource: Resource, track: LibraryDataTrack) throws {
        try data.write(to: cacheURL(for: resource, track: track), options: .atomic)
    }

    private static func bundledManifest() -> Manifest? {
        guard let url = Bundle.main.url(forResource: "manifest", withExtension: "json"),
              let data = try? Data(contentsOf: url) else {
            return nil
        }
        return try? JSONDecoder().decode(Manifest.self, from: data)
    }

    private static func parseLibraryDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }

        return ISO8601DateFormatter().date(from: value)
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }
        if let urlError = error as? URLError,
           urlError.code == .cancelled {
            return true
        }
        return false
    }

    private enum RefreshError: Error {
        case badAssetPath(String)
        case badHTTPResponse
        case byteCountMismatch(expected: Int, actual: Int)
        case hashMismatch
    }
}

private extension JSONDecoder {
    static var snakeCaseDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}
