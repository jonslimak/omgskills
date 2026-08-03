import Foundation
import Testing
@testable import omgskills

struct AppDelegateTests {
    @Test func sparkleAutomaticUpdateFlagsAreEnabled() throws {
        let plist = try sourceInfoPlist()

        #expect(plist["SUEnableAutomaticChecks"] as? Bool == true)
        #expect(plist["SUAutomaticallyUpdate"] as? Bool == true)
        #expect(plist["SUAllowsAutomaticUpdates"] as? Bool == true)
        #expect(plist["SUScheduledCheckInterval"] as? Int == 86_400)
    }

    @Test func backgroundUpdateCheckRunsOnlyWhenUpdaterStarts() {
        #expect(AppDelegate.shouldCheckForUpdatesInBackground(updaterStarted: true) == true)
        #expect(AppDelegate.shouldCheckForUpdatesInBackground(updaterStarted: false) == false)
    }

    @Test func manualUpdateFlowRemainsAbsent() throws {
        let source = try appSource(named: "ContentView.swift") + "\n" + appSource(named: "omgskillsApp.swift")

        #expect(!source.contains("checkForUpdateInformation"))
        #expect(!source.contains("updateAvailable"))
        #expect(!source.contains("updateAvailability"))
    }

    @Test func debugAppcastOverrideUsesHTTPEnvironmentURL() {
        let url = AppDelegate.debugAppcastFeedURLString(environment: [
            AppDelegate.debugAppcastURLEnvironmentKey: "http://127.0.0.1:8123/appcast.xml"
        ])

        #expect(url == "http://127.0.0.1:8123/appcast.xml")
    }

    @Test func debugAppcastOverrideTrimsWhitespace() {
        let url = AppDelegate.debugAppcastFeedURLString(environment: [
            AppDelegate.debugAppcastURLEnvironmentKey: "  https://example.test/appcast.xml  "
        ])

        #expect(url == "https://example.test/appcast.xml")
    }

    @Test func debugAppcastOverrideIgnoresMissingBlankAndNonHTTPValues() {
        #expect(AppDelegate.debugAppcastFeedURLString(environment: [:]) == nil)
        #expect(AppDelegate.debugAppcastFeedURLString(environment: [
            AppDelegate.debugAppcastURLEnvironmentKey: " "
        ]) == nil)
        #expect(AppDelegate.debugAppcastFeedURLString(environment: [
            AppDelegate.debugAppcastURLEnvironmentKey: "file:///tmp/appcast.xml"
        ]) == nil)
    }

    private func sourceInfoPlist() throws -> [String: Any] {
        let data = try Data(contentsOf: packageRoot().appending(path: "Info.plist"))
        let plist = try PropertyListSerialization.propertyList(from: data, format: nil)
        return try #require(plist as? [String: Any])
    }

    private func appSource(named filename: String) throws -> String {
        let url = packageRoot()
            .appending(path: "Sources")
            .appending(path: "omgskills")
            .appending(path: filename)
        return try String(contentsOf: url, encoding: .utf8)
    }

    private func packageRoot() -> URL {
        URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }
}
