import Testing
import Foundation
@testable import omgskills

struct AnalyticsTests {
    @Test func appVersionParametersIncludeVersionAndBuild() {
        let parameters = Analytics.appVersionParameters()

        #expect(parameters["app_version"]?.isEmpty == false)
        #expect(parameters["build_number"]?.isEmpty == false)
    }

    @Test func identityResolutionSignalUsesOnlyPrivacySafeAggregateParameters() throws {
        let measurement = SkillIdentityMeasurement(
            resolvedByProvenance: 1,
            resolvedByGit: 2,
            resolvedBySha: 3,
            ambiguous: 4,
            localOnly: 5
        )
        var emittedName: String?
        var emittedParameters: [String: String]?

        Analytics.signalIdentityResolution(measurement, track: .crawl4) { name, parameters in
            emittedName = name
            emittedParameters = parameters
        }

        let parameters = try #require(emittedParameters)
        let allowedKeys: Set<String> = [
            "app_version",
            "build_number",
            "track",
            "total_installed",
            "resolved_by_provenance",
            "resolved_by_git",
            "resolved_by_sha",
            "ambiguous",
            "local_only"
        ]
        let bucketKeys = [
            "resolved_by_provenance",
            "resolved_by_git",
            "resolved_by_sha",
            "ambiguous",
            "local_only"
        ]
        let bucketValues = bucketKeys.compactMap { key in
            parameters[key].flatMap(Int.init)
        }

        #expect(emittedName == "identity.resolution_snapshot")
        #expect(Set(parameters.keys) == allowedKeys)
        #expect(parameters["track"] == LibraryDataTrack.crawl4.rawValue)
        #expect(parameters["total_installed"] == "15")
        #expect(parameters["resolved_by_provenance"] == "1")
        #expect(parameters["resolved_by_git"] == "2")
        #expect(parameters["resolved_by_sha"] == "3")
        #expect(parameters["ambiguous"] == "4")
        #expect(parameters["local_only"] == "5")
        #expect(bucketValues.count == bucketKeys.count)
        #expect(bucketValues.reduce(0, +) == measurement.totalInstalled)
    }

    @Test func pendingUpdateCompletionEmitsCompletedAndClearsStore() throws {
        let context = makePendingUpdateContext()
        defer { context.cleanup() }
        context.store.save(
            sourceVersion: "0.0.19",
            sourceBuild: "19",
            targetVersion: "0.0.20",
            targetBuild: "20"
        )
        var emittedName: String?
        var emittedParameters: [String: String]?

        let handled = Analytics.signalPendingUpdateCompletionIfNeeded(
            pendingStore: context.store,
            currentVersion: "0.0.20",
            currentBuild: "20"
        ) { name, parameters in
            emittedName = name
            emittedParameters = parameters
        }

        let parameters = try #require(emittedParameters)
        #expect(handled == true)
        #expect(emittedName == "app.update_completed")
        #expect(parameters["source_version"] == "0.0.19")
        #expect(parameters["source_build"] == "19")
        #expect(parameters["target_version"] == "0.0.20")
        #expect(parameters["target_build"] == "20")
        #expect(parameters["app_version"] == "0.0.20")
        #expect(parameters["build_number"] == "20")
        #expect(context.store.load() == nil)
    }

    @Test func pendingUpdateMismatchEmitsFailureAndClearsStore() throws {
        let context = makePendingUpdateContext()
        defer { context.cleanup() }
        context.store.save(
            sourceVersion: "0.0.19",
            sourceBuild: "19",
            targetVersion: "0.0.20",
            targetBuild: "20"
        )
        var emittedName: String?
        var emittedParameters: [String: String]?

        let handled = Analytics.signalPendingUpdateCompletionIfNeeded(
            pendingStore: context.store,
            currentVersion: "0.0.19",
            currentBuild: "19"
        ) { name, parameters in
            emittedName = name
            emittedParameters = parameters
        }

        let parameters = try #require(emittedParameters)
        #expect(handled == true)
        #expect(emittedName == "error.update_failed")
        #expect(parameters["reason"] == "launched_version_mismatch")
        #expect(context.store.load() == nil)
    }

    @Test func noPendingUpdateCompletionEmitsNothing() {
        let context = makePendingUpdateContext()
        defer { context.cleanup() }
        var emittedCount = 0

        let handled = Analytics.signalPendingUpdateCompletionIfNeeded(
            pendingStore: context.store,
            currentVersion: "0.0.20",
            currentBuild: "20"
        ) { _, _ in
            emittedCount += 1
        }

        #expect(handled == false)
        #expect(emittedCount == 0)
    }

    private func makePendingUpdateContext() -> PendingUpdateContext {
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        return PendingUpdateContext(
            suiteName: suiteName,
            defaults: defaults,
            store: PendingUpdateInstallStore(userDefaults: defaults)
        )
    }

    private struct PendingUpdateContext {
        let suiteName: String
        let defaults: UserDefaults
        let store: PendingUpdateInstallStore

        func cleanup() {
            defaults.removePersistentDomain(forName: suiteName)
        }
    }
}
