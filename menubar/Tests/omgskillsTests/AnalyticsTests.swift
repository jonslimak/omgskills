import Testing
import Foundation
@testable import omgskills

struct AnalyticsTests {
    #if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
    @Test @MainActor func connectedTrackingStartsOnlyForProductionAndUsesFixedFields() {
        var starts = 0
        var signals: [(String, [String: String])] = []
        let candidate = Analytics.connectedTracker(profile: .candidate, start: { starts += 1 },
            emit: { signals.append(($0, $1)) })
        candidate(.setupFailed)
        #expect(starts == 0 && signals.isEmpty)

        let production = Analytics.connectedTracker(profile: .production, start: { starts += 1 },
            emit: { signals.append(($0, $1)) })
        production(.install(.installed, agent: .codex))
        production(.setupFailed)
        #expect(starts == 1)
        #expect(signals.map(\.0) == ["connected.install", "connected.setup_failed"])
        #expect(Set(signals[0].1.keys) == ["app_version", "build_number", "outcome", "agent"])
        #expect(signals[0].1["outcome"] == "installed")
        #expect(signals[0].1["agent"] == "codex")
        #expect(Set(signals[1].1.keys) == ["app_version", "build_number"])
    }

    @Test func connectedOutcomesNeverIncludePrivateErrorTextOrIdentifiers() {
        let privateText = "secret-token /Users/private/skills/secret-skill user@example.com"
        let failure = ConnectedAppEvent.installResult(.failed(privateText), agent: .claude)
        #expect(failure == .install(.failed, agent: .claude))
        for error: DeviceConnectionFailure in [.authorization(privateText), .exchange(privateText),
            .sync(privateText), .replacementRequired, .credentialStorage, .reconnectRequired] {
            let event = ConnectedAppEvent.connectionResult(.failed(error), action: .connect, hasWarning: false)
            #expect(event != nil)
            #expect(Set(event?.parameters.keys.map { $0 } ?? []) == ["app_version", "build_number", "action", "outcome"])
            #expect(event?.parameters.values.contains(where: { $0.contains(privateText) }) == false)
        }
        for outcome in ConnectedAppEvent.InstallOutcome.allCases {
            let event = ConnectedAppEvent.install(outcome, agent: .codex)
            #expect(Set(event.parameters.keys) == ["app_version", "build_number", "outcome", "agent"])
        }
        for outcome in ConnectedAppEvent.InventoryOutcome.allCases {
            #expect(Set(ConnectedAppEvent.inventory(outcome).parameters.keys) == ["app_version", "build_number", "outcome"])
        }
        #expect(ConnectedAppEvent.inventoryResult(.reported(partial: true)) == .inventory(.partial))
        #expect(ConnectedAppEvent.inventoryResult(.reported(partial: false)) == .inventory(.reported))
        #expect(ConnectedAppEvent.inventoryResult(.retryable(retryAfter: 123)) == .inventory(.retryable))
        #expect(ConnectedAppEvent.inventoryResult(.checked) == nil)
        #expect(ConnectedAppEvent.inventoryResult(.cancelled) == nil)
    }
    #endif

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
