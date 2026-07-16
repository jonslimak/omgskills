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

    @Test func activeTrackUsesCrawl4OnlyInDebugFallbackMode() {
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        #expect(DataRefreshService.activeTrack(
            userDefaults: defaults,
            mode: .crawl4PrimaryWithV2Fallback
        ) == .crawl4)
        #expect(DataRefreshService.activeTrack(
            userDefaults: defaults,
            mode: .productionV2Only
        ) == .productionV2)
    }

    @Test func selectedTrackPersistsInUserDefaults() {
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        DataRefreshService.setSelectedTrack(.crawl4, userDefaults: defaults)

        #expect(DataRefreshService.selectedTrack(userDefaults: defaults) == .crawl4)
    }

    @Test func activeTrackPersistsInFallbackMode() {
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        DataRefreshService.setActiveTrack(.productionV2, userDefaults: defaults)

        #expect(DataRefreshService.activeTrack(
            userDefaults: defaults,
            mode: .crawl4PrimaryWithV2Fallback
        ) == .productionV2)
    }

    @Test func productionModeIgnoresPersistedActiveTrack() {
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        DataRefreshService.setSelectedTrack(.productionV2, userDefaults: defaults)
        DataRefreshService.setActiveTrack(.crawl4, userDefaults: defaults)

        #expect(DataRefreshService.activeTrack(
            userDefaults: defaults,
            mode: .productionV2Only
        ) == .productionV2)
    }

    @Test func refreshTrackOrderDependsOnMode() {
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        #expect(DataRefreshService.refreshTracks(
            mode: .crawl4PrimaryWithV2Fallback,
            userDefaults: defaults
        ) == [.crawl4, .productionV2])
        #expect(DataRefreshService.refreshTracks(
            mode: .productionV2Only,
            userDefaults: defaults
        ) == [.productionV2])
    }

    @Test func cancellationDoesNotTriggerFallback() {
        #expect(DataRefreshService.shouldFallback(after: CancellationError()) == false)
        #expect(DataRefreshService.shouldFallback(after: URLError(.cancelled)) == false)
        #expect(DataRefreshService.shouldFallback(after: URLError(.badServerResponse)) == true)
    }

    @Test func retryDelayScheduleUsesThreeTotalAttempts() {
        #expect(DataRefreshService.downloadRetryDelay(afterAttempt: 1) == 1)
        #expect(DataRefreshService.downloadRetryDelay(afterAttempt: 2) == 2)
        #expect(DataRefreshService.downloadRetryDelay(afterAttempt: 3) == nil)
    }

    @Test func refreshTriggerAnalyticsValuesAreStable() {
        #expect(DataRefreshService.RefreshTrigger.launch.analyticsValue == "launch")
        #expect(DataRefreshService.RefreshTrigger.panelOpen.analyticsValue == "panel_open")
        #expect(DataRefreshService.RefreshTrigger.wake.analyticsValue == "wake")
        #expect(DataRefreshService.RefreshTrigger.timer.analyticsValue == "timer")
        #expect(DataRefreshService.RefreshTrigger.scheduler.analyticsValue == "scheduler")
    }

    @Test func refreshResultAnalyticsValuesAreStable() {
        #expect(DataRefreshService.RefreshResult.updated.analyticsValue == "updated")
        #expect(DataRefreshService.RefreshResult.checkedNoChange.analyticsValue == "checked_no_change")
        #expect(DataRefreshService.RefreshResult.skipped.analyticsValue == "skipped")
        #expect(DataRefreshService.RefreshResult.updated.refreshSignalName == "refresh_updated")
        #expect(DataRefreshService.RefreshResult.checkedNoChange.refreshSignalName == "refresh_checked_no_change")
        #expect(DataRefreshService.RefreshResult.skipped.refreshSignalName == nil)
    }

    @Test func refreshResultParametersIncludeTriggerTrackAndResult() {
        let parameters = DataRefreshService.refreshResultParameters(
            trigger: .panelOpen,
            track: .crawl4,
            result: .checkedNoChange
        )

        #expect(parameters["trigger"] == "panel_open")
        #expect(parameters["track"] == "crawl4")
        #expect(parameters["result"] == "checked_no_change")
    }

    @Test func transientDownloadErrorsAreRetried() {
        #expect(DataRefreshService.isRetriableDownloadError(URLError(.timedOut)) == true)
        #expect(DataRefreshService.isRetriableDownloadError(URLError(.networkConnectionLost)) == true)
        #expect(DataRefreshService.isRetriableDownloadError(URLError(.notConnectedToInternet)) == true)
        #expect(DataRefreshService.isRetriableDownloadError(
            DataRefreshService.RefreshError.badHTTPResponse(statusCode: 503)
        ) == true)
    }

    @Test func cancellationAndValidationErrorsAreNotRetried() {
        #expect(DataRefreshService.isRetriableDownloadError(CancellationError()) == false)
        #expect(DataRefreshService.isRetriableDownloadError(URLError(.cancelled)) == false)
        #expect(DataRefreshService.isRetriableDownloadError(
            DataRefreshService.RefreshError.badAssetPath("bad path")
        ) == false)
        #expect(DataRefreshService.isRetriableDownloadError(
            DataRefreshService.RefreshError.byteCountMismatch(expected: 10, actual: 5)
        ) == false)
        #expect(DataRefreshService.isRetriableDownloadError(
            DataRefreshService.RefreshError.hashMismatch
        ) == false)
    }

    @Test func clientHTTPFailuresAreNotRetriedExceptThrottleAndTimeoutStatuses() {
        #expect(DataRefreshService.isRetriableDownloadError(
            DataRefreshService.RefreshError.badHTTPResponse(statusCode: 404)
        ) == false)
        #expect(DataRefreshService.isRetriableDownloadError(
            DataRefreshService.RefreshError.badHTTPResponse(statusCode: 408)
        ) == true)
        #expect(DataRefreshService.isRetriableDownloadError(
            DataRefreshService.RefreshError.badHTTPResponse(statusCode: 429)
        ) == true)
    }

    @Test func refreshFailureParametersIncludeTriggerResultErrorCodeAndAttemptCount() {
        let error = DataRefreshService.RefreshError.downloadFailed(
            underlying: URLError(.timedOut),
            attemptCount: 3
        )
        let parameters = DataRefreshService.refreshFailureParameters(
            trigger: .wake,
            track: .productionV2,
            error: error
        )

        #expect(parameters["trigger"] == "wake")
        #expect(parameters["track"] == "productionV2")
        #expect(parameters["result"] == "failed")
        #expect(parameters["error_code"] == "url_-1001")
        #expect(parameters["attempt_count"] == "3")
        #expect(parameters["error"]?.isEmpty == false)
    }

    @Test func refreshErrorCodesAreStable() {
        #expect(DataRefreshService.refreshErrorCode(for: CancellationError()) == "cancelled")
        #expect(DataRefreshService.refreshErrorCode(for: URLError(.notConnectedToInternet)) == "url_-1009")
        #expect(DataRefreshService.refreshErrorCode(for:
            DataRefreshService.RefreshError.badHTTPResponse(statusCode: 503)
        ) == "http_503")
        #expect(DataRefreshService.refreshErrorCode(for:
            DataRefreshService.RefreshError.badAssetPath("bad path")
        ) == "bad_asset_path")
        #expect(DataRefreshService.refreshErrorCode(for:
            DataRefreshService.RefreshError.byteCountMismatch(expected: 10, actual: 5)
        ) == "byte_count_mismatch")
        #expect(DataRefreshService.refreshErrorCode(for:
            DataRefreshService.RefreshError.hashMismatch
        ) == "hash_mismatch")
        #expect(DataRefreshService.refreshErrorCode(for: NSError(domain: "test", code: 1)) == "unknown")
    }

    @Test func manifestURLUsesSelectedTrack() {
        #expect(DataRefreshService.manifestURL(for: .productionV2).absoluteString == "https://omgskills.com/data/v2/manifest.json")
        #expect(DataRefreshService.manifestURL(for: .crawl4).absoluteString == "https://omgskills.com/data/crawl4/manifest.json")
    }

    @Test func crawl4TrackUsesSeparateCacheFiles() {
        #expect(LibraryDataTrack.productionV2.cacheFilename(for: .skills) == "skills.json")
        #expect(LibraryDataTrack.productionV2.cacheFilename(for: .trending) == "trending.json")
        #expect(LibraryDataTrack.productionV2.cacheFilename(for: .xTrending) == "x-trending.json")
        #expect(LibraryDataTrack.productionV2.cacheFilename(for: .collections) == "collections.json")
        #expect(LibraryDataTrack.productionV2.cacheFilename(for: .shaHistory) == "sha-history.json")
        #expect(LibraryDataTrack.productionV2.cacheFilename(for: .skillEquivalence) == "skill-equivalence.json")
        #expect(LibraryDataTrack.crawl4.cacheFilename(for: .skills) == "crawl4-skills.json")
        #expect(LibraryDataTrack.crawl4.cacheFilename(for: .trending) == "crawl4-trending.json")
        #expect(LibraryDataTrack.crawl4.cacheFilename(for: .xTrending) == "crawl4-x-trending.json")
        #expect(LibraryDataTrack.crawl4.cacheFilename(for: .collections) == "crawl4-collections.json")
        #expect(LibraryDataTrack.crawl4.cacheFilename(for: .shaHistory) == "crawl4-sha-history.json")
        #expect(LibraryDataTrack.crawl4.cacheFilename(for: .skillEquivalence) == "crawl4-skill-equivalence.json")
    }

    @Test func manifestDecodesWithAndWithoutCollections() throws {
        let manifestWithoutCollections = """
        {
          "version": 2,
          "generatedAt": "2026-07-03T00:00:00Z",
          "skills": { "path": "skills.json", "sha256": "abc", "bytes": 10 }
        }
        """.data(using: .utf8)!
        let decodedWithout = try JSONDecoder().decode(DataRefreshService.Manifest.self, from: manifestWithoutCollections)

        #expect(decodedWithout.collections == nil)

        let manifestWithCollections = """
        {
          "version": 2,
          "generatedAt": "2026-07-03T00:00:00Z",
          "skills": { "path": "skills.json", "sha256": "abc", "bytes": 10 },
          "collections": { "path": "collections-def.json", "sha256": "def", "bytes": 20 }
        }
        """.data(using: .utf8)!
        let decodedWith = try JSONDecoder().decode(DataRefreshService.Manifest.self, from: manifestWithCollections)

        #expect(decodedWith.collections?.path == "collections-def.json")
        #expect(decodedWith.collections?.sha256 == "def")
    }

    @Test func manifestDecodesWithAndWithoutShaHistory() throws {
        let manifestWithoutShaHistory = """
        {
          "version": 2,
          "generatedAt": "2026-07-03T00:00:00Z",
          "skills": { "path": "skills.json", "sha256": "abc", "bytes": 10 }
        }
        """.data(using: .utf8)!
        let decodedWithout = try JSONDecoder().decode(DataRefreshService.Manifest.self, from: manifestWithoutShaHistory)

        #expect(decodedWithout.shaHistory == nil)

        let manifestWithShaHistory = """
        {
          "version": 2,
          "generatedAt": "2026-07-03T00:00:00Z",
          "skills": { "path": "skills.json", "sha256": "abc", "bytes": 10 },
          "shaHistory": { "path": "sha-history-def.json", "sha256": "def", "bytes": 20 }
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(DataRefreshService.Manifest.self, from: manifestWithShaHistory)

        #expect(decoded.shaHistory?.path == "sha-history-def.json")
        #expect(decoded.shaHistory?.sha256 == "def")
    }

    @Test func manifestDecodesWithAndWithoutSkillEquivalence() throws {
        let manifestWithoutSkillEquivalence = """
        {
          "version": 2,
          "generatedAt": "2026-07-03T00:00:00Z",
          "skills": { "path": "skills.json", "sha256": "abc", "bytes": 10 }
        }
        """.data(using: .utf8)!
        let decodedWithout = try JSONDecoder().decode(
            DataRefreshService.Manifest.self,
            from: manifestWithoutSkillEquivalence
        )

        #expect(decodedWithout.skillEquivalence == nil)

        let manifestWithSkillEquivalence = """
        {
          "version": 2,
          "generatedAt": "2026-07-03T00:00:00Z",
          "skills": { "path": "skills.json", "sha256": "abc", "bytes": 10 },
          "skillEquivalence": {
            "path": "skill-equivalence-def.json",
            "sha256": "def",
            "bytes": 20
          }
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(
            DataRefreshService.Manifest.self,
            from: manifestWithSkillEquivalence
        )

        #expect(decoded.skillEquivalence?.path == "skill-equivalence-def.json")
        #expect(decoded.skillEquivalence?.sha256 == "def")
    }

    @Test func remoteOptionalAssetStateChangesOnlyFromValidatedManifestPresence() {
        #expect(DataRefreshService.resolvedRemoteAssetEnabled(
            previous: true,
            validatedManifestHasAsset: nil
        ) == true)
        #expect(DataRefreshService.resolvedRemoteAssetEnabled(
            previous: true,
            validatedManifestHasAsset: false
        ) == false)
        #expect(DataRefreshService.resolvedRemoteAssetEnabled(
            previous: false,
            validatedManifestHasAsset: true
        ) == true)
    }

    @Test func omittedShaHistoryClearsItsCachedState() {
        var activeHash: String? = "sha-history-hash"
        var removedCache = false

        let changed = DataRefreshService.clearOmittedOptionalAssetIfNeeded(
            activeHash: &activeHash,
            hasCachedData: true,
            removeCache: { removedCache = true }
        )

        #expect(changed)
        #expect(removedCache)
        #expect(activeHash == nil)
    }

    @Test func absentShaHistoryStateDoesNotReportAnUpdate() {
        var activeHash: String?
        var removedCache = false

        let changed = DataRefreshService.clearOmittedOptionalAssetIfNeeded(
            activeHash: &activeHash,
            hasCachedData: false,
            removeCache: { removedCache = true }
        )

        #expect(!changed)
        #expect(!removedCache)
        #expect(activeHash == nil)
    }

    @Test func optionalShaHistoryDoesNotAffectBootstrapOrTrackFallback() {
        let state = DataRefreshService.BootstrapState(
            hasSkillsCache: true,
            hasActiveSkillsHash: true,
            expectsTrending: false,
            hasTrendingCache: false,
            hasActiveTrendingHash: false
        )
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        #expect(!state.isIncomplete)
        #expect(DataRefreshService.refreshTracks(
            mode: .crawl4PrimaryWithV2Fallback,
            userDefaults: defaults
        ) == [.crawl4, .productionV2])
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

    @Test func missingTrendingStateDoesNotBypassThrottleWhenTrendingIsSoftRetired() {
        let state = DataRefreshService.BootstrapState(
            hasSkillsCache: true,
            hasActiveSkillsHash: true,
            expectsTrending: false,
            hasTrendingCache: false,
            hasActiveTrendingHash: false
        )

        #expect(DataRefreshService.shouldThrottleRefresh(
            lastCheckedAt: 1_000,
            now: 2_000,
            bootstrapState: state
        ) == true)
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

    @Test func panelOpenChecksThrottleForFiveMinutes() {
        #expect(DataRefreshService.shouldThrottlePanelOpenCheck(
            lastPanelOpenAttemptAt: nil,
            now: 10_030
        ) == false)
        #expect(DataRefreshService.shouldThrottlePanelOpenCheck(
            lastPanelOpenAttemptAt: 10_000,
            now: 10_030
        ) == true)
        #expect(DataRefreshService.shouldThrottlePanelOpenCheck(
            lastPanelOpenAttemptAt: 10_000,
            now: 10_000 + (5 * 60) + 1
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
