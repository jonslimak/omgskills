import Foundation
import Testing
@testable import omgskills

struct DataRefreshServiceTests {
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

    @Test func panelOpenDebounceHonors60Seconds() {
        #expect(DataRefreshService.shouldThrottlePanelOpenCheck(
            lastPanelOpenAttemptAt: 10_000,
            now: 10_030
        ) == true)
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

    @Test func displayableDataUpdateDatePrefersRefreshTime() {
        let date = DataRefreshService.displayableDataUpdateDate(
            lastSuccessfulRefreshAt: 1_777_470_428,
            lastLibraryGeneratedAt: "2026-04-28T21:07:21.568Z",
            bundledGeneratedAt: "2026-04-27T21:07:21.568Z"
        )

        #expect(date?.timeIntervalSince1970 == 1_777_470_428)
    }

    @Test func displayableDataUpdateDateFallsBackToGeneratedTime() {
        let date = DataRefreshService.displayableDataUpdateDate(
            lastSuccessfulRefreshAt: nil,
            lastLibraryGeneratedAt: "2026-04-28T21:07:21.568Z",
            bundledGeneratedAt: "2026-04-27T21:07:21.568Z"
        )
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expected = formatter.date(from: "2026-04-28T21:07:21.568Z")

        #expect(date == expected)
    }

    @Test func displayableDataUpdateDateReturnsNilWithoutMetadata() {
        let date = DataRefreshService.displayableDataUpdateDate(
            lastSuccessfulRefreshAt: nil,
            lastLibraryGeneratedAt: nil,
            bundledGeneratedAt: nil
        )

        #expect(date == nil)
    }
}
