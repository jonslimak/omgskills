import Foundation
import HandoffCore
@testable import HelperUpdates
import Sparkle
import Testing

private actor NoInstallService: InstallServing {
    private(set) var calls = 0
    func prepare(_ request: HandoffRequest) async throws -> InstallReview { calls += 1; throw URLError(.cancelled) }
    func prepareRestore() async throws -> InstallReview { calls += 1; throw URLError(.cancelled) }
    func apply(_ id: UUID) async throws -> String { calls += 1; throw URLError(.cancelled) }
    func discard(_ id: UUID) async { calls += 1 }
}

@MainActor private final class Driver: HelperUpdateDriving {
    var starts = 0
    var cycles: [UUID] = []
    var failStart = false
    var failCheck = false
    func start() throws { starts += 1; if failStart { throw URLError(.badURL) } }
    func check(_ cycle: UUID) throws { if failCheck { throw URLError(.notConnectedToInternet) }; cycles.append(cycle) }
}

private func configuration(enabled: Bool = true) -> [String: Any] {
    var info: [String: Any] = [
        "CFBundleIdentifier": HelperIdentity.bundleID, "OMGSkillsHelperUpdatesEnabled": enabled,
        "SUEnableAutomaticChecks": false, "SUAutomaticallyUpdate": false, "SUAllowsAutomaticUpdates": false,
        "SUEnableSystemProfiling": false, "SUVerifyUpdateBeforeExtraction": true,
        "SURequireSignedFeed": true, "SUSignedFeedFailureExpirationInterval": 0,
    ]
    if enabled {
        info["SUFeedURL"] = HelperUpdateConfiguration.feed
        info["SUPublicEDKey"] = Data(repeating: 7, count: 32).base64EncodedString()
    }
    return info
}

@MainActor struct HelperUpdaterTests {
    @Test func upToDateIsNotReportedAsFailure() {
        #expect(!SparkleUpdateDriver.cycleFailed(nil))
        #expect(!SparkleUpdateDriver.cycleFailed(NSError(domain: SUSparkleErrorDomain, code: Int(SUError.noUpdateError.rawValue))))
        #expect(SparkleUpdateDriver.cycleFailed(URLError(.notConnectedToInternet)))
        #expect(SparkleUpdateDriver.cycleFailed(NSError(domain: "other", code: Int(SUError.noUpdateError.rawValue))))
    }
    @Test func idleAndUnconfiguredBuildsNeverConstructOrStartDriver() throws {
        let model = InstallModel(service: NoInstallService())
        var constructions = 0
        let disabled = HelperUpdater(model: model, info: configuration(enabled: false)) { _ in
            constructions += 1; return Driver()
        }
        disabled.checkForUpdates()
        #expect(!disabled.canCheck && disabled.status != nil && constructions == 0)
        let enabled = HelperUpdater(model: model, info: configuration()) { _ in constructions += 1; return Driver() }
        #expect(enabled.canCheck && constructions == 0 && !model.helperUpdateActive)
    }

    @Test(arguments: ["CFBundleIdentifier", "SUEnableAutomaticChecks", "SUAutomaticallyUpdate", "SUAllowsAutomaticUpdates",
                      "SUEnableSystemProfiling", "SUVerifyUpdateBeforeExtraction", "SURequireSignedFeed",
                      "SUSignedFeedFailureExpirationInterval", "SUFeedURL", "SUPublicEDKey", "OMGSkillsHelperUpdatesEnabled"])
    func missingConfigurationFailsClosed(_ key: String) {
        var info = configuration(); info.removeValue(forKey: key)
        let updater = HelperUpdater(model: InstallModel(service: NoInstallService()), info: info) { _ in
            Issue.record("Invalid configuration constructed a driver"); return Driver()
        }
        updater.checkForUpdates()
        #expect(!updater.canCheck && updater.status != nil)
    }

    @Test func rejectsWrongFeedKeyAndAutomaticSettings() throws {
        for feed in ["http://omgskills.com/helper/updates/appcast.xml", "https://omgskills.com/appcast.xml",
                     "https://example.com/helper/updates/appcast.xml", HelperUpdateConfiguration.feed + "?override=1"] {
            var info = configuration(); info["SUFeedURL"] = feed
            #expect(throws: (any Error).self) { try HelperUpdateConfiguration.validate(info) }
        }
        for key in ["", "secret", Data(repeating: 0, count: 32).base64EncodedString(), Data(repeating: 7, count: 31).base64EncodedString()] {
            var info = configuration(); info["SUPublicEDKey"] = key
            #expect(throws: (any Error).self) { try HelperUpdateConfiguration.validate(info) }
        }
        let mutations: [(String, Any)] = [
            ("SUEnableAutomaticChecks", true), ("SUAutomaticallyUpdate", true), ("SUAllowsAutomaticUpdates", true),
            ("SUEnableSystemProfiling", true), ("SUVerifyUpdateBeforeExtraction", false), ("SURequireSignedFeed", false),
            ("SUSignedFeedFailureExpirationInterval", 1), ("SUSignedFeedFailureExpirationInterval", false),
            ("SUDefaultsDomain", "com.omgskills.app"), ("OMGSkillsHelperUpdatesEnabled", "true")
        ]
        for (key, value) in mutations {
            var info = configuration(); info[key] = value
            #expect(throws: (any Error).self) { try HelperUpdateConfiguration.validate(info) }
        }
    }

    @Test(arguments: [false, true]) func completedOrFailedCycleReleasesHoldWithoutResumingSkill(_ failed: Bool) async throws {
        let service = NoInstallService(), driver = Driver()
        let model = InstallModel(service: service)
        let updater = HelperUpdater(model: model, info: configuration()) { _ in driver }
        updater.checkForUpdates(); updater.checkForUpdates()
        let cycle = try #require(driver.cycles.first)
        #expect(driver.cycles.count == 1 && updater.permits(cycle) && !updater.canCheck)
        model.open("omgskills-helper://install?id=anthropics%2Fskills%3Askills%2Ffrontend-design")
        model.apply(); model.restore()
        #expect(await service.calls == 0)
        updater.finish(UUID(), failed: failed)
        #expect(model.helperUpdateActive)
        updater.finish(cycle, failed: failed)
        #expect(updater.canCheck && !model.helperUpdateActive && model.review == nil)
        #expect(!updater.permits(cycle))
        #expect(await service.calls == 0)
        updater.checkForUpdates()
        updater.finish(cycle, failed: false)
        #expect(model.helperUpdateActive)
        updater.finish(try #require(driver.cycles.last), failed: false)
    }

    @Test(arguments: [false, true]) func stagedReplacementKeepsHoldEvenAfterCycleEndOrError(_ failed: Bool) throws {
        let model = InstallModel(service: NoInstallService()), driver = Driver()
        let updater = HelperUpdater(model: model, info: configuration()) { _ in driver }
        updater.checkForUpdates()
        let id = try #require(driver.cycles.first)
        updater.installationStarted(id)
        updater.finish(id, failed: failed)
        #expect(updater.needsRestart && !updater.canCheck && model.helperUpdateActive)
        #expect(model.beginTermination())
        #expect(!updater.permits(id))
    }

    @Test(arguments: [false, true]) func synchronousDriverFailureIsRetryable(_ atStart: Bool) {
        let model = InstallModel(service: NoInstallService()), driver = Driver()
        driver.failStart = atStart; driver.failCheck = !atStart
        let updater = HelperUpdater(model: model, info: configuration()) { _ in driver }
        updater.checkForUpdates()
        #expect(updater.canCheck && updater.status != nil && !model.helperUpdateActive)
        driver.failStart = false; driver.failCheck = false
        updater.checkForUpdates()
        #expect(driver.cycles.count == 1 && model.helperUpdateActive)
    }
}
