import Foundation
import Testing
@testable import omgskills

struct ProductionConnectedConfigurationTests {
    #if OMGSKILLS_CONNECTED_PRODUCTION
    @Test(.enabled(if: ProcessInfo.processInfo.environment["OMGSKILLS_PRODUCTION_PACKAGE"] != nil))
    func actualProductionPackageEnablesTheCompiledRuntimeWithoutLaunching() throws {
        let app = try #require(ProcessInfo.processInfo.environment["OMGSKILLS_PRODUCTION_PACKAGE"])
        let url = URL(fileURLWithPath: app).appendingPathComponent("Contents/Info.plist")
        let info = try #require(PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        guard case .enabled(let configuration) = CatalogCandidateRuntime.mode(info: info, home: home) else {
            Issue.record("Packaged settings did not enable the compiled production runtime"); return
        }
        #expect(configuration.profile == .production)
        #expect(info["CFBundleShortVersionString"] as? String == "0.0.29")
        #expect(info["CFBundleVersion"] as? String == "29")
        #expect(info["OMGSkillsSkillGroupsAuthEnabled"] as? Bool == true)
        let connected = try #require(configuration.connected)
        #expect(connected.connectURL.absoluteString == "https://omgskills.com/app/connect?inventory=3")
        #expect(connected.uploadURL.absoluteString == "https://omgskills.com/api/portal/sync-upload")
        #expect(connected.keychainService == "com.jonslimak.omgskills.connected.inventory")
        #expect(configuration.paths.codexSkillsRoot.path == home.path + "/.codex/skills")
        #expect(configuration.paths.claudeSkillsRoot.path == home.path + "/.claude/skills")
        #expect(try FileManager.default.contentsOfDirectory(atPath: home.path).isEmpty)
    }
    #endif

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

    @Test(arguments: [false, true])
    func productionCompanionAcceptsEitherExplicitSetSetting(setsEnabled: Bool) throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        var value = info(.production)
        value[AppRuntimeConfiguration.skillGroupsAuthEnabledKey] = setsEnabled
        guard case .enabled(let configuration) = CatalogCandidateRuntime.mode(info: value, home: home,
            allowed: true, connectedAllowed: true, profile: .production) else {
            Issue.record("Production companion rejected the explicit Set setting"); return
        }
        #expect(configuration.profile == .production)
        #expect(configuration.connected != nil)
        #expect(try FileManager.default.contentsOfDirectory(atPath: home.path).isEmpty)
    }

    @Test func setEnabledProductionStillRequiresTrustedIdentityConnectionAndUpdater() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        var value = info(.production)
        value[AppRuntimeConfiguration.skillGroupsAuthEnabledKey] = true
        for change: [String: Any] in [
            ["CFBundleIdentifier": "another.app"],
            [CatalogRuntimeProfile.production.catalogKeys[1]: "https://other.invalid/app/"],
            [CatalogRuntimeProfile.production.connectedKeys[1]: "https://other.invalid/connect"],
            [CatalogRuntimeProfile.production.connectedKeys[0]: false],
            ["SUFeedURL": "https://omgskills.com/appcast.xml"],
            ["SUEnableAutomaticChecks": true], ["SUAutomaticallyUpdate": true],
            [CatalogRuntimeProfile.candidate.catalogKeys[0]: true],
        ] {
            guard case .invalid = CatalogCandidateRuntime.mode(info: value.merging(change) { _, new in new },
                home: home, allowed: true, connectedAllowed: true, profile: .production) else {
                Issue.record("Sets bypassed another production guard: \(change.keys)"); continue
            }
        }
        guard case .invalid = CatalogCandidateRuntime.mode(info: value, home: home,
            allowed: true, connectedAllowed: false, profile: .production) else {
            Issue.record("Sets bypassed the connected build gate"); return
        }
    }

    @Test func candidateProfileStillRefusesSetEnabledConfiguration() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        var value = info(.candidate)
        guard case .enabled = CatalogCandidateRuntime.mode(info: value, home: home,
            allowed: true, connectedAllowed: true, profile: .candidate) else {
            Issue.record("Candidate fixture is invalid before enabling Sets"); return
        }
        value[AppRuntimeConfiguration.skillGroupsAuthEnabledKey] = true
        guard case .invalid = CatalogCandidateRuntime.mode(info: value, home: home,
            allowed: true, connectedAllowed: true, profile: .candidate) else {
            Issue.record("Production Set allowance leaked into the candidate profile"); return
        }
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
