import Foundation
import Testing
@testable import omgskills

struct SetupTestRuntimeTests {
    private var info: [String: Any] {
        ["CFBundleIdentifier": SetupTestRuntime.bundleID,
         "CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-setup-test"]]],
         SetupTestRuntime.websiteKey: "http://127.0.0.1:5199/app/preview/unified/"]
    }

    @Test func ordinaryBuildCannotEnableCandidateThroughPlist() throws {
        #expect(SetupTestRuntime.mode(info: [:], allowed: false) == .disabled)
        #expect(SetupTestRuntime.mode(info: ["CFBundleIdentifier": "com.jonslimak.omgskills"], allowed: false) == .disabled)
        guard case .invalid = SetupTestRuntime.mode(info: info, allowed: false) else {
            Issue.record("Ordinary build accepted setup-test configuration"); return
        }
        #if OMGSKILLS_SETUP_TEST
        #expect(SetupTestRuntime.buildAllowed)
        #else
        #expect(!SetupTestRuntime.buildAllowed)
        #endif
    }

    @Test func candidateRequiresOwnIdentitySchemeAndNoOtherRuntime() {
        let changes: [[String: Any]] = [
            ["CFBundleIdentifier": "com.jonslimak.omgskills"],
            ["CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills"]]]],
            ["CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-setup-test", "omgskills-f1"]]]],
            ["SUFeedURL": "https://omgskills.com/appcast.xml"], ["SUPublicEDKey": "key"],
            [AppRuntimeConfiguration.f1RootKey: "/private/tmp/old-test"],
            [AppRuntimeConfiguration.f1WebsiteKey: "http://localhost:5198"],
        ]
        for change in changes {
            let candidate = info.merging(change) { _, new in new }
            guard case .invalid = SetupTestRuntime.mode(info: candidate, allowed: true) else {
                Issue.record("Accepted invalid candidate configuration: \(change.keys)"); continue
            }
        }
        guard case .invalid = SetupTestRuntime.mode(info: [:], allowed: true) else {
            Issue.record("Unconfigured candidate fell through to production"); return
        }
    }

    @Test func validatesWebsiteAndCreatesOnlyCandidateState() throws {
        let home = try temporaryHome()
        defer { try? FileManager.default.removeItem(at: home) }
        for website in ["http://localhost:5199/app/preview/unified/", "https://omgskills.com/app/",
                        "https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/"] {
            var candidate = info
            candidate[SetupTestRuntime.websiteKey] = website
            guard case .enabled(let configuration) = SetupTestRuntime.mode(info: candidate, home: home, allowed: true) else {
                Issue.record("Valid candidate rejected"); return
            }
            #expect(configuration.paths.codexSkillsRoot.path == home.path + "/.codex/skills")
            #expect(configuration.managedRoot.path == home.path + "/Library/Application Support/OMGSkills Setup Test/managed")
            try configuration.prepareStorage()
            #expect(FileManager.default.fileExists(atPath: configuration.stateRoot.path))
            #expect(!FileManager.default.fileExists(atPath: configuration.managedRoot.path))
            #expect(!FileManager.default.fileExists(atPath: home.appendingPathComponent(".codex").path))
            #expect(!FileManager.default.fileExists(atPath: home.appendingPathComponent(".agents").path))
            #expect(SetupTestRuntime.mode(info: candidate, home: home, allowed: true) == .enabled(configuration))
        }
        for website in ["http://omgskills.com/app", "https://evil.test", "http://localhost/app", "file:///tmp",
                        "https://user@omgskills.com/app", "https://omgskills.com/app#token", "https://omgskills.com:443/app",
                        "https://omgskills-setup-test-f3b.netlify.app/other",
                        "https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/?token=test",
                        "https://omgskills-setup-test-f3b.netlify.app.evil.test/app/preview/unified/",
                        "http://omgskills-setup-test-f3b.netlify.app/app/preview/unified/"] {
            var candidate = info
            candidate[SetupTestRuntime.websiteKey] = website
            guard case .invalid = SetupTestRuntime.mode(info: candidate, home: home, allowed: true) else {
                Issue.record("Accepted invalid website \(website)"); continue
            }
        }
    }

    @Test(arguments: ["Library", "Library/Application Support", "Library/Application Support/OMGSkills Setup Test",
                      "Library/Application Support/OMGSkills Setup Test/managed"])
    func redirectedStorageIsRefused(component: String) throws {
        let home = try temporaryHome()
        defer { try? FileManager.default.removeItem(at: home) }
        let path = home.appendingPathComponent(component)
        try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: path, withDestinationURL: home.appendingPathComponent("missing"))
        guard case .invalid = SetupTestRuntime.mode(info: info, home: home, allowed: true) else {
            Issue.record("Redirected storage accepted"); return
        }
        try FileManager.default.removeItem(at: path)
        try Data().write(to: path)
        guard case .invalid = SetupTestRuntime.mode(info: info, home: home, allowed: true) else {
            Issue.record("Non-directory storage accepted"); return
        }
    }

    @Test func handlersCannotBeMixedOrSupplyDestinationOrConsent() throws {
        let query = "://review?v=1&id=owner/repo:example&repo=owner/repo&path=example/SKILL.md&agent=codex"
        let request = try PublicSkillInstallRequest(url: "omgskills-setup-test" + query, client: .setupTest)
        #expect(request == (try PublicSkillInstallRequest(url: "omgskills-f1" + query)))
        #expect(throws: PublicSkillInstallRequest.RequestError.self) { try PublicSkillInstallRequest(url: "omgskills-setup-test" + query) }
        for suffix in ["&destination=/tmp", "&approved=true", "&agent=claude"] {
            #expect(throws: PublicSkillInstallRequest.RequestError.self) {
                try PublicSkillInstallRequest(url: "omgskills-setup-test" + query + suffix, client: .setupTest)
            }
        }
        #expect(throws: PublicSkillInstallRequest.RequestError.self) {
            try PublicSkillInstallRequest(url: "omgskills-f1" + query, client: .setupTest)
        }
    }

    private func temporaryHome() throws -> URL {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("omgskills-setup-runtime-\(UUID())", isDirectory: true)
            .resolvingSymlinksInPath().standardizedFileURL
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        return home
    }
}
