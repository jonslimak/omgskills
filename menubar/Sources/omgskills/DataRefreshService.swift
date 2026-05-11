import CryptoKit
import Foundation

enum DataRefreshService {
    private static let manifestURL = URL(string: "https://omgskills.com/data/manifest.json")!
    private static let backgroundCheckInterval: TimeInterval = 24 * 60 * 60
    private static let panelOpenDebounceInterval: TimeInterval = 60

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
            switch self {
            case .skills: return "skills.json"
            case .trending: return "trending.json"
            case .xTrending: return "x-trending.json"
            }
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
        var remoteXTrendingEnabled: Bool?
        var lastCheckedAt: TimeInterval?
        var lastManifestCheckAt: TimeInterval?
        var lastPanelOpenAttemptAt: TimeInterval?
        var lastSuccessfulRefreshAt: TimeInterval?
        var lastLibraryGeneratedAt: String?
    }

    static func cachedData(for resource: Resource) -> Data? {
        try? Data(contentsOf: cacheURL(for: resource))
    }

    static func removeCachedData(for resource: Resource) {
        try? FileManager.default.removeItem(at: cacheURL(for: resource))
    }

    static func remoteXTrendingEnabled() -> Bool? {
        loadMetadata().remoteXTrendingEnabled
    }

    static func lastDisplayableDataUpdateDate() -> Date? {
        let metadata = loadMetadata()
        return displayableDataUpdateDate(
            lastSuccessfulRefreshAt: metadata.lastSuccessfulRefreshAt,
            lastLibraryGeneratedAt: metadata.lastLibraryGeneratedAt,
            bundledGeneratedAt: bundledManifest()?.generatedAt
        )
    }

    static func displayableDataUpdateDate(
        lastSuccessfulRefreshAt: TimeInterval?,
        lastLibraryGeneratedAt: String?,
        bundledGeneratedAt: String?
    ) -> Date? {
        if let lastSuccessfulRefreshAt {
            return Date(timeIntervalSince1970: lastSuccessfulRefreshAt)
        }
        if let lastLibraryGeneratedAt,
           let date = parseLibraryDate(lastLibraryGeneratedAt) {
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
        var metadata = loadMetadata()
        let now = Date().timeIntervalSince1970
        let bootstrapState = bootstrapState(metadata: metadata)

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
        saveMetadata(metadata)

        do {
            let manifestData = try await download(from: manifestURL)
            let manifest = try JSONDecoder().decode(Manifest.self, from: manifestData)
            var didUpdate = false
            metadata.lastManifestCheckAt = now
            metadata.lastCheckedAt = now
            metadata.lastLibraryGeneratedAt = manifest.generatedAt
            metadata.remoteXTrendingEnabled = manifest.xTrending != nil

            if shouldUpdateAsset(
                activeHash: metadata.activeSkillsHash,
                hasCachedData: cachedData(for: .skills) != nil,
                manifestHash: manifest.skills.sha256
            ) {
                let data = try await fetchAndValidate(asset: manifest.skills, decodeAs: [Skill].self)
                try writeCache(data, for: .skills)
                metadata.activeSkillsHash = manifest.skills.sha256
                didUpdate = true
            }

            if let trending = manifest.trending,
               shouldUpdateAsset(
                activeHash: metadata.activeTrendingHash,
                hasCachedData: cachedData(for: .trending) != nil,
                manifestHash: trending.sha256
               ) {
                let data = try await fetchAndValidate(asset: trending, decodeAs: [TrendingEntry].self)
                try writeCache(data, for: .trending)
                metadata.activeTrendingHash = trending.sha256
                didUpdate = true
            }

            if let xTrending = manifest.xTrending,
               shouldUpdateAsset(
                activeHash: metadata.activeXTrendingHash,
                hasCachedData: cachedData(for: .xTrending) != nil,
                manifestHash: xTrending.sha256
               ) {
                do {
                    let data = try await fetchAndValidate(asset: xTrending, decodeAs: [Skill].self)
                    try writeCache(data, for: .xTrending)
                    metadata.activeXTrendingHash = xTrending.sha256
                    didUpdate = true
                } catch {
                    print("[DataRefreshService] xTrending refresh failed: \(error)")
                }
            } else if manifest.xTrending == nil,
                      (cachedData(for: .xTrending) != nil || metadata.activeXTrendingHash != nil) {
                removeCachedData(for: .xTrending)
                metadata.activeXTrendingHash = nil
                didUpdate = true
            }

            if didUpdate {
                metadata.lastSuccessfulRefreshAt = Date().timeIntervalSince1970
            }
            saveMetadata(metadata)
            return didUpdate ? .updated : .checkedNoChange
        } catch {
            print("[DataRefreshService] Refresh failed: \(error)")
            Analytics.signal("error.refresh_failed", parameters: [
                "error": error.localizedDescription
            ])
            saveMetadata(metadata)
            return .skipped
        }
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
            let lastPanelOpenAttemptAt = metadata.lastPanelOpenAttemptAt ?? metadata.lastCheckedAt
            return shouldThrottlePanelOpenCheck(
                lastPanelOpenAttemptAt: lastPanelOpenAttemptAt,
                now: now
            )
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
        guard let lastPanelOpenAttemptAt else {
            return false
        }
        return now - lastPanelOpenAttemptAt < panelOpenDebounceInterval
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

    private static func fetchAndValidate<T: Decodable>(asset: Asset, decodeAs type: T.Type) async throws -> Data {
        let url = try assetURL(for: asset)
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

    private static func assetURL(for asset: Asset) throws -> URL {
        guard let url = URL(string: asset.path, relativeTo: manifestURL)?.absoluteURL else {
            throw RefreshError.badAssetPath(asset.path)
        }
        return url
    }

    private static func bootstrapState(metadata: Metadata) -> BootstrapState {
        let expectsTrending = bundledManifest()?.trending != nil
        return BootstrapState(
            hasSkillsCache: cachedData(for: .skills) != nil,
            hasActiveSkillsHash: metadata.activeSkillsHash != nil,
            expectsTrending: expectsTrending,
            hasTrendingCache: cachedData(for: .trending) != nil,
            hasActiveTrendingHash: metadata.activeTrendingHash != nil
        )
    }

    private static func cacheURL(for resource: Resource) -> URL {
        applicationSupportDirectory().appendingPathComponent(resource.cacheFilename)
    }

    private static func metadataURL() -> URL {
        applicationSupportDirectory().appendingPathComponent("metadata.json")
    }

    private static func applicationSupportDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = base.appendingPathComponent("omgskills", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func loadMetadata() -> Metadata {
        guard let data = try? Data(contentsOf: metadataURL()) else {
            return Metadata()
        }
        return (try? JSONDecoder().decode(Metadata.self, from: data)) ?? Metadata()
    }

    private static func saveMetadata(_ metadata: Metadata) {
        do {
            let data = try JSONEncoder().encode(metadata)
            try data.write(to: metadataURL(), options: .atomic)
        } catch {
            print("[DataRefreshService] Metadata write failed: \(error)")
        }
    }

    private static func writeCache(_ data: Data, for resource: Resource) throws {
        try data.write(to: cacheURL(for: resource), options: .atomic)
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
