#if OMGSKILLS_CATALOG_CANDIDATE
import Foundation
import Testing
@testable import omgskills

struct CatalogCandidatePackageTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["OMGSKILLS_CATALOG_CANDIDATE_PACKAGE"] != nil))
    func packagedSettingsPassTheActualCandidateRuntimeWithoutLaunching() throws {
        let app = try #require(ProcessInfo.processInfo.environment["OMGSKILLS_CATALOG_CANDIDATE_PACKAGE"])
        let url = URL(fileURLWithPath: app).appendingPathComponent("Contents/Info.plist")
        let info = try #require(PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        guard case .enabled(let configuration) = CatalogCandidateRuntime.mode(info: info, home: home) else {
            Issue.record("Packaged metadata did not enable the candidate runtime"); return
        }
        #expect(CatalogCandidateRuntime.buildAllowed)
        #expect(info["CFBundleIdentifier"] as? String == CatalogCandidateRuntime.bundleID)
        #expect(info["CFBundleExecutable"] as? String == "omgskills")
        #expect(info["CFBundleShortVersionString"] as? String == "0.0.0")
        #expect(info["CFBundleURLTypes"] as? [[String: Any]] != nil)
        #expect(configuration.home == home)
        #expect(configuration.paths.codexSkillsRoot.path == home.path + "/.codex/skills")
        #expect(configuration.paths.claudeSkillsRoot.path == home.path + "/.claude/skills")
        #expect(configuration.paths.legacyRepoCacheRoot.path == home.path + "/Library/Application Support/omgskills/repos")
        #if OMGSKILLS_CONNECTED_CANDIDATE
        #expect(ConnectedCandidateConfiguration.buildAllowed)
        #expect(info["CFBundleVersion"] as? String == "2")
        #expect(info["CFBundleDisplayName"] as? String == "OMGSkills Connected Inspection")
        let connected = try #require(configuration.connected)
        #expect(connected.connectURL.absoluteString == "https://omgskills-setup-test-f3b.netlify.app/app/connect")
        #expect(connected.uploadURL.absoluteString == "https://omgskills-setup-test-f3b.netlify.app/api/portal/sync-upload")
        #expect(connected.callbackScheme == "omgskills")
        #expect(connected.keychainService == "com.jonslimak.omgskills.catalog-candidate.inventory")
        #expect(connected.keychainService != DeviceCredentialStore.defaultService)
        #else
        #expect(!ConnectedCandidateConfiguration.buildAllowed)
        #expect(info["CFBundleVersion"] as? String == "1")
        #expect(info["CFBundleDisplayName"] as? String == "OMGSkills Candidate")
        #expect(configuration.connected == nil)
        for key in ConnectedCandidateConfiguration.keys { #expect(info[key] == nil) }
        #endif
        #expect(try FileManager.default.contentsOfDirectory(atPath: home.path).isEmpty)
    }
}
#endif
