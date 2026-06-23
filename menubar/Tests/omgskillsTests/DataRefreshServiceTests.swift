import Foundation
import Testing
@testable import omgskills

struct DataRefreshServiceTests {
    @Test func legacyManifestURLTargetsV2Track() {
        #expect(DataRefreshService.manifestURL.absoluteString == "https://omgskills.com/data/v2/manifest.json")
    }

    @Test func defaultTrackIsProductionV2() {
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        #expect(DataRefreshService.selectedTrack(userDefaults: defaults) == .productionV2)
    }

    @Test func selectedTrackPersistsInUserDefaults() {
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        DataRefreshService.setSelectedTrack(.crawl4, userDefaults: defaults)

        #expect(DataRefreshService.selectedTrack(userDefaults: defaults) == .crawl4)
    }

    @Test func manifestURLUsesSelectedTrack() {
        #expect(DataRefreshService.manifestURL(for: .productionV2).absoluteString == "https://omgskills.com/data/v2/manifest.json")
        #expect(DataRefreshService.manifestURL(for: .crawl4).absoluteString == "https://omgskills.com/data/crawl4/manifest.json")
    }

    @Test func crawl4TrackUsesSeparateCacheFiles() {
        #expect(LibraryDataTrack.productionV2.cacheFilename(for: .skills) == "skills.json")
        #expect(LibraryDataTrack.productionV2.cacheFilename(for: .trending) == "trending.json")
        #expect(LibraryDataTrack.productionV2.cacheFilename(for: .xTrending) == "x-trending.json")
        #expect(LibraryDataTrack.crawl4.cacheFilename(for: .skills) == "crawl4-skills.json")
        #expect(LibraryDataTrack.crawl4.cacheFilename(for: .trending) == "crawl4-trending.json")
        #expect(LibraryDataTrack.crawl4.cacheFilename(for: .xTrending) == "crawl4-x-trending.json")
    }

    @Test func missingSkillsCacheBypassesThrottle() {
        let state = DataRefreshService.BootstrapState(
            hasSkillsCache: false,
            hasActiveSkillsHash: true,
            expectsTrending: true,
            hasTrendingCache: true,
            hasActiveTrendingHash: true
        )

        #expect(DataRefreshService.shouldThrottleRefresh(
            lastCheckedAt: 1_000,
            now: 2_000,
            bootstrapState: state
        ) == false)
    }

    @Test func missingSkillsHashBypassesThrottle() {
        let state = DataRefreshService.BootstrapState(
            hasSkillsCache: true,
            hasActiveSkillsHash: false,
            expectsTrending: true,
            hasTrendingCache: true,
            hasActiveTrendingHash: true
        )

        #expect(DataRefreshService.shouldThrottleRefresh(
            lastCheckedAt: 1_000,
            now: 2_000,
            bootstrapState: state
        ) == false)
    }

    @Test func missingTrendingStateBypassesThrottleWhenTrendingExpected() {
        let missingFile = DataRefreshService.BootstrapState(
            hasSkillsCache: true,
            hasActiveSkillsHash: true,
            expectsTrending: true,
            hasTrendingCache: false,
            hasActiveTrendingHash: true
        )
        let missingHash = DataRefreshService.BootstrapState(
            hasSkillsCache: true,
            hasActiveSkillsHash: true,
            expectsTrending: true,
            hasTrendingCache: true,
            hasActiveTrendingHash: false
        )

        #expect(DataRefreshService.shouldThrottleRefresh(
            lastCheckedAt: 1_000,
            now: 2_000,
            bootstrapState: missingFile
        ) == false)
        #expect(DataRefreshService.shouldThrottleRefresh(
            lastCheckedAt: 1_000,
            now: 2_000,
            bootstrapState: missingHash
        ) == false)
    }

    @Test func hydratedStateHonorsThrottleWindow() {
        let state = DataRefreshService.BootstrapState(
            hasSkillsCache: true,
            hasActiveSkillsHash: true,
            expectsTrending: true,
            hasTrendingCache: true,
            hasActiveTrendingHash: true
        )

        #expect(DataRefreshService.shouldThrottleRefresh(
            lastCheckedAt: 10_000,
            now: 10_100,
            bootstrapState: state
        ) == true)
    }

    @Test func staleHydratedStateAllowsRefresh() {
        let state = DataRefreshService.BootstrapState(
            hasSkillsCache: true,
            hasActiveSkillsHash: true,
            expectsTrending: true,
            hasTrendingCache: true,
            hasActiveTrendingHash: true
        )

        #expect(DataRefreshService.shouldThrottleRefresh(
            lastCheckedAt: 10_000,
            now: 10_000 + (24 * 60 * 60) + 1,
            bootstrapState: state
        ) == false)
    }

    @Test func backgroundRefreshThrottleHonors24Hours() {
        #expect(DataRefreshService.shouldThrottleBackgroundRefresh(
            lastManifestCheckAt: 10_000,
            now: 10_100
        ) == true)
        #expect(DataRefreshService.shouldThrottleBackgroundRefresh(
            lastManifestCheckAt: 10_000,
            now: 10_000 + (24 * 60 * 60) + 1
        ) == false)
    }

    @Test func panelOpenChecksAreNeverThrottled() {
        #expect(DataRefreshService.shouldThrottlePanelOpenCheck(
            lastPanelOpenAttemptAt: 10_000,
            now: 10_030
        ) == false)
        #expect(DataRefreshService.shouldThrottlePanelOpenCheck(
            lastPanelOpenAttemptAt: 10_000,
            now: 10_061
        ) == false)
    }

    @Test func unchangedManifestHashSkipsAssetRewrite() {
        #expect(DataRefreshService.shouldUpdateAsset(
            activeHash: "abc",
            hasCachedData: true,
            manifestHash: "abc"
        ) == false)
    }

    @Test func changedManifestHashTriggersAssetRewrite() {
        #expect(DataRefreshService.shouldUpdateAsset(
            activeHash: "abc",
            hasCachedData: true,
            manifestHash: "def"
        ) == true)
        #expect(DataRefreshService.shouldUpdateAsset(
            activeHash: nil,
            hasCachedData: false,
            manifestHash: "def"
        ) == true)
    }

    @Test func activeRefreshSkipsSecondTrigger() {
        #expect(AppDelegate.shouldStartLibraryRefresh(isRefreshActive: false) == true)
        #expect(AppDelegate.shouldStartLibraryRefresh(isRefreshActive: true) == false)
    }

    @Test func displayableDataUpdateDatePrefersActiveLibraryTime() {
        let date = DataRefreshService.displayableDataUpdateDate(
            activeLibraryGeneratedAt: "2026-04-28T21:07:21.568Z",
            bundledGeneratedAt: "2026-04-27T21:07:21.568Z"
        )
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expected = formatter.date(from: "2026-04-28T21:07:21.568Z")

        #expect(date == expected)
    }

    @Test func displayableDataUpdateDateFallsBackToBundledGeneratedTime() {
        let date = DataRefreshService.displayableDataUpdateDate(
            activeLibraryGeneratedAt: nil,
            bundledGeneratedAt: "2026-04-27T21:07:21.568Z"
        )
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expected = formatter.date(from: "2026-04-27T21:07:21.568Z")

        #expect(date == expected)
    }

    @Test func displayableDataUpdateDateReturnsNilWithoutMetadata() {
        let date = DataRefreshService.displayableDataUpdateDate(
            activeLibraryGeneratedAt: nil,
            bundledGeneratedAt: nil
        )

        #expect(date == nil)
    }

}
