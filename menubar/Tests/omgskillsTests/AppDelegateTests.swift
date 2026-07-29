import Testing
@testable import omgskills

struct AppDelegateTests {
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
}
