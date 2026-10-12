import Foundation
import Testing
@testable import omgskills

struct SetupTestUpdateConfigurationTests {
    private var info: [String: Any] {
        var value: [String: Any] = [
            "CFBundleIdentifier": SetupTestRuntime.bundleID,
            "CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-setup-test"]]],
            SetupTestRuntime.websiteKey: "https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/",
            "CFBundleVersion": "2", "CFBundleShortVersionString": "0.1.1",
            SetupTestUpdateConfiguration.enabledKey: true,
            "SUFeedURL": SetupTestUpdateConfiguration.feedURL,
            "SUPublicEDKey": Data(repeating: 1, count: 32).base64EncodedString(),
            "SUSignedFeedFailureExpirationInterval": 0,
        ]
        for (key, bool) in SetupTestUpdateConfiguration.policy { value[key] = bool }
        return value
    }

    @Test func legacyCandidateHasNoUpdaterAndPartialConfigurationFailsClosed() throws {
        #expect(try SetupTestUpdateConfiguration.validate([:]) == false)
        for key in ["SUFeedURL", "SUPublicEDKey", "SUDefaultsDomain", "SUEnableAutomaticChecks"] {
            #expect(throws: (any Error).self) { try SetupTestUpdateConfiguration.validate([key: "unexpected"]) }
        }
        for key in info.keys where key.hasPrefix("SU") || key == SetupTestUpdateConfiguration.enabledKey {
            var candidate = info
            candidate.removeValue(forKey: key)
            #expect(throws: (any Error).self) { try SetupTestUpdateConfiguration.validate(candidate) }
        }
    }

    @Test func onlyExplicitCandidateBuildCanEnableTheTwoTestVersions() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("setup-update-config-\(UUID())", isDirectory: true)
            .resolvingSymlinksInPath().standardizedFileURL
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: home) }
        for (build, version) in SetupTestUpdateConfiguration.versions {
            var candidate = info
            candidate["CFBundleVersion"] = build
            candidate["CFBundleShortVersionString"] = version
            #expect(try SetupTestUpdateConfiguration.validate(candidate))
            guard case .enabled(let configuration) = SetupTestRuntime.mode(info: candidate, home: home, allowed: true) else {
                Issue.record("Updater-enabled candidate rejected"); return
            }
            #expect(configuration.updatesEnabled)
            #expect(configuration.stateRoot.lastPathComponent == "OMGSkills Setup Test")
            #expect(try FileManager.default.contentsOfDirectory(atPath: home.path).isEmpty)
            guard case .invalid = SetupTestRuntime.mode(info: candidate, home: home, allowed: false) else {
                Issue.record("Ordinary build enabled test updater"); return
            }
        }
    }

    @Test func rejectsProductionOrOtherFeedsKeysDefaultsAndPolicyChanges() {
        var changes: [[String: Any]] = [
            ["CFBundleIdentifier": "com.jonslimak.omgskills"], ["CFBundleVersion": "3"],
            ["CFBundleShortVersionString": "0.1.0"], [SetupTestUpdateConfiguration.enabledKey: false],
            [SetupTestUpdateConfiguration.enabledKey: 1], ["SUDefaultsDomain": "com.jonslimak.omgskills"],
            ["SUSignedFeedFailureExpirationInterval": 30], ["SUSignedFeedFailureExpirationInterval": false],
        ]
        changes += ["https://omgskills.com/appcast.xml", "https://omgskills.com/helper/updates/appcast.xml",
                    SetupTestUpdateConfiguration.feedURL + "?override=1", "http://localhost:8888/appcast.xml"]
            .map { ["SUFeedURL": $0] }
        changes += ["", "key", Data(repeating: 0, count: 32).base64EncodedString(),
                    Data(repeating: 1, count: 31).base64EncodedString(), (info["SUPublicEDKey"] as! String) + "\n"]
            .map { ["SUPublicEDKey": $0] }
        for (key, value) in SetupTestUpdateConfiguration.policy {
            changes.append([key: !value])
            changes.append([key: value ? 1 : 0])
        }
        for change in changes {
            #expect(throws: (any Error).self) {
                try SetupTestUpdateConfiguration.validate(info.merging(change) { _, new in new })
            }
        }
    }

    @Test func onlyExactTestArchivesAreOffered() {
        let url = SetupTestUpdateConfiguration.baseURL + "OMGSkills-Setup-Test-0.1.2-arm64.zip"
        func accepts(_ raw: String?, build: String = "3", version: String = "0.1.2", kind: String = "application", delta: Bool = false) -> Bool {
            SetupTestUpdateConfiguration.acceptsArchive(url: raw.flatMap(URL.init(string:)), build: build,
                version: version, installationType: kind, isDelta: delta)
        }
        #expect(accepts(url))
        for other in [nil, "https://omgskills.com/OMGSkills.zip", url + "?token=value", url + "#fragment",
                      url.replacingOccurrences(of: "https:", with: "http:"),
                      url.replacingOccurrences(of: ".netlify.app/", with: ".netlify.app.evil.test/")] {
            #expect(!accepts(other))
        }
        #expect(!accepts(url, build: "2"))
        #expect(!accepts(url, version: "0.1.1"))
        #expect(!accepts(url, kind: "package"))
        #expect(!accepts(url, delta: true))
    }
}
