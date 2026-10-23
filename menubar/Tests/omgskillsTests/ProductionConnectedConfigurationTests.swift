import Foundation
import Testing
@testable import omgskills

struct ProductionConnectedConfigurationTests {
    private func info(_ profile: CatalogRuntimeProfile) -> [String: Any] {
        var value = CatalogCandidateRuntimeTests.info
        for key in CatalogRuntimeProfile.compiled.catalogKeys { value.removeValue(forKey: key) }
        value[profile.catalogKeys[0]] = true
        value[profile.catalogKeys[1]] = profile.website.absoluteString
        value[profile.catalogKeys[2]] = value["SUPublicEDKey"]
        value["SUFeedURL"] = profile.feedURL
        value[profile.connectedKeys[0]] = true
        value[profile.connectedKeys[1]] = profile.connectURL.absoluteString
        value[profile.connectedKeys[2]] = profile.uploadURL.absoluteString
        value[profile.connectedKeys[3]] = profile.credentialService
        return value
    }

    @Test func productionReusesStorageAndIdentityButNeverTestEndpointsOrCredentials() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        let profile = CatalogRuntimeProfile.production
        guard case .enabled(let configuration) = CatalogCandidateRuntime.mode(info: info(profile), home: home,
            allowed: true, connectedAllowed: true, profile: profile) else { Issue.record("Production configuration rejected"); return }
        let connected = try #require(configuration.connected)
        #if OMGSKILLS_CONNECTED_PRODUCTION
        #expect(CatalogRuntimeProfile.compiled == .production)
        #expect(CatalogCandidateRuntime.buildAllowed)
        #expect(ConnectedCandidateConfiguration.buildAllowed)
        #expect(CatalogCandidateRuntime.mode(info: info(profile), home: home) == .enabled(configuration))
        #endif
        #expect(configuration.profile.website.absoluteString == "https://omgskills.com/app/")
        #expect(connected.connectURL.absoluteString == "https://omgskills.com/app/connect?inventory=3")
        #expect(connected.uploadURL.absoluteString == "https://omgskills.com/api/portal/sync-upload")
        #expect(connected.callbackScheme == "omgskills")
        #expect(connected.keychainService != CatalogRuntimeProfile.candidate.credentialService)
        #expect(connected.keychainService != DeviceCredentialStore.defaultService)
        #expect(configuration.paths.codexSkillsRoot.path == home.path + "/.codex/skills")
        #expect(configuration.paths.claudeSkillsRoot.path == home.path + "/.claude/skills")
        #expect(configuration.profile.feedURL != "https://omgskills.com/appcast.xml")
        let request = try SystemBrowserPairingRequestGenerator().makeRequest()
        let authorization = try BrowserPairing.authorizationURL(connectURL: connected.connectURL, request: request)
        #expect(authorization.query == "inventory=3")
        #expect(authorization.fragment?.contains("state=") == true)
        #expect(try FileManager.default.contentsOfDirectory(atPath: home.path).isEmpty)
    }

    @Test func candidateAndProductionProfilesCannotBeMixedAndProductionNeedsExplicitOptIn() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        let profile = CatalogRuntimeProfile.production
        let original = info(profile)
        func invalid(_ value: [String: Any], allowed: Bool = true, connected: Bool = true) -> Bool {
            if case .invalid = CatalogCandidateRuntime.mode(info: value, home: home, allowed: allowed,
                connectedAllowed: connected, profile: profile) { return true }
            return false
        }
        #expect(invalid(original, allowed: false))
        #expect(invalid(original, connected: false))
        for key in profile.catalogKeys + profile.connectedKeys {
            var value = original
            value.removeValue(forKey: key)
            #expect(invalid(value))
        }
        for change: [String: Any] in [
            [profile.connectedKeys[1]: CatalogRuntimeProfile.candidate.connectURL.absoluteString],
            [profile.connectedKeys[2]: CatalogRuntimeProfile.candidate.uploadURL.absoluteString],
            [profile.connectedKeys[3]: CatalogRuntimeProfile.candidate.credentialService],
            ["SUFeedURL": "https://omgskills.com/appcast.xml"],
            [CatalogRuntimeProfile.candidate.catalogKeys[0]: true],
            [CatalogRuntimeProfile.candidate.connectedKeys[0]: true],
        ] { #expect(invalid(original.merging(change) { _, new in new })) }
        let url = URL(string: profile.updateBase + "OMGSkills-Connected-0.0.24-24-arm64.zip")!
        #expect(CatalogCandidateRuntime.acceptsArchive(url: url, build: "24", version: "0.0.24",
            installationType: "application", isDelta: false, profile: .production))
        #expect(!CatalogCandidateRuntime.acceptsArchive(url: url, build: "24", version: "0.0.24",
            installationType: "application", isDelta: false, profile: .candidate))
    }
}
