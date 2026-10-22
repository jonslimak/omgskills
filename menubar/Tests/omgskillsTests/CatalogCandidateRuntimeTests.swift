import Foundation
import Testing
@testable import omgskills

struct CatalogCandidateRuntimeTests {
    static var info: [String: Any] {
        var value: [String: Any] = [
            CatalogCandidateRuntime.enabledKey: true,
            CatalogCandidateRuntime.websiteKey: CatalogCandidateRuntime.website.absoluteString,
            CatalogCandidateRuntime.updateKey: Data(repeating: 1, count: 32).base64EncodedString(),
            "CFBundleIdentifier": CatalogCandidateRuntime.bundleID,
            "CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills"]]],
            "LSMinimumSystemVersion": "14.0", "LSUIElement": true, "LSMultipleInstancesProhibited": true,
            "CFBundleShortVersionString": "0.0.21", "CFBundleVersion": "21",
            "SUFeedURL": CatalogCandidateRuntime.feedURL,
            "SUPublicEDKey": Data(repeating: 1, count: 32).base64EncodedString(),
            "SUSignedFeedFailureExpirationInterval": 0,
        ]
        for (key, flag) in CatalogCandidateRuntime.updatePolicy { value[key] = flag }
        return value
    }

    @Test func candidateRequiresBothBuildFlagAndCompleteMetadata() throws {
        let home = try Self.home()
        defer { try? FileManager.default.removeItem(at: home) }
        guard case .invalid = CatalogCandidateRuntime.mode(info: Self.info, home: home, allowed: false) else {
            Issue.record("Metadata alone enabled candidate"); return
        }
        guard case .invalid = CatalogCandidateRuntime.mode(info: [:], home: home, allowed: true) else {
            Issue.record("Candidate without metadata fell through"); return
        }
        for key in Self.info.keys {
            var info = Self.info
            info.removeValue(forKey: key)
            guard case .invalid = CatalogCandidateRuntime.mode(info: info, home: home, allowed: true) else {
                Issue.record("Accepted missing key: \(key)"); continue
            }
        }
        #if OMGSKILLS_CATALOG_CANDIDATE && !OMGSKILLS_SETUP_TEST
        #expect(CatalogCandidateRuntime.buildAllowed)
        #else
        #expect(!CatalogCandidateRuntime.buildAllowed)
        #endif
        if CatalogCandidateRuntime.buildRequested {
            guard case .invalid = CatalogCandidateRuntime.mode(info: [:], allowed: false) else {
                Issue.record("Candidate build fell through to ordinary startup"); return
            }
        } else {
            #expect(CatalogCandidateRuntime.mode(info: [:], allowed: false) == .disabled)
        }
    }

    @Test func candidateUsesProductIdentityAndExistingStorageWithoutWriting() throws {
        let home = try Self.home()
        defer { try? FileManager.default.removeItem(at: home) }
        let config = try Self.configuration(home: home)
        #expect(config.paths.claudeSkillsRoot.path == home.path + "/.claude/skills")
        #expect(config.paths.codexSkillsRoot.path == home.path + "/.codex/skills")
        #expect(config.paths.legacyRepoCacheRoot.path == home.path + "/Library/Application Support/omgskills/repos")
        #expect(config.managedRoot.path == home.path + "/Library/Application Support/omgskills/managed")
        #expect(try FileManager.default.contentsOfDirectory(atPath: home.path).isEmpty)
    }

    @Test func mixedIdentitiesProductionFeedsOverridesAndUnsafeFlagsAreRefused() throws {
        let home = try Self.home()
        defer { try? FileManager.default.removeItem(at: home) }
        var changes: [[String: Any]] = [
            ["CFBundleIdentifier": "com.jonslimak.omgskills.f1"],
            ["CFBundleIdentifier": SetupTestRuntime.bundleID],
            ["CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-f1"]]]],
            ["CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills", "other"]]]],
            [CatalogCandidateRuntime.enabledKey: 1], [CatalogCandidateRuntime.enabledKey: false],
            [AppRuntimeConfiguration.f1RootKey: "/private/tmp/old-test"],
            [AppRuntimeConfiguration.f1WebsiteKey: "http://localhost:5199"],
            [AppRuntimeConfiguration.catalogInstallEnabledKey: true],
            [SetupTestRuntime.websiteKey: CatalogCandidateRuntime.website.absoluteString],
            [SetupTestUpdateConfiguration.enabledKey: false],
            [AppRuntimeConfiguration.skillGroupsAuthEnabledKey: true],
            ["SUDefaultsDomain": "another.app"], ["SUScheduledCheckInterval": 5],
            ["SUSignedFeedFailureExpirationInterval": false], ["SUSignedFeedFailureExpirationInterval": 10],
            ["CFBundleShortVersionString": "../21"], ["CFBundleVersion": "0"],
        ]
        changes += ["https://omgskills.com/app/", "http://localhost:5199/app/",
                    CatalogCandidateRuntime.website.absoluteString + "?override=true"]
            .map { [CatalogCandidateRuntime.websiteKey: $0] }
        changes += ["https://omgskills.com/appcast.xml", SetupTestUpdateConfiguration.feedURL,
                    CatalogCandidateRuntime.feedURL + "?override=true"] .map { ["SUFeedURL": $0] }
        for (key, value) in CatalogCandidateRuntime.updatePolicy {
            changes.append([key: !value]); changes.append([key: value ? 1 : 0])
        }
        for key in ["", "invalid", Data(repeating: 0, count: 32).base64EncodedString()] {
            changes.append([CatalogCandidateRuntime.updateKey: key, "SUPublicEDKey": key])
        }
        changes.append(["SUPublicEDKey": Data(repeating: 2, count: 32).base64EncodedString()])
        for change in changes {
            guard case .invalid = CatalogCandidateRuntime.mode(info: Self.info.merging(change) { _, new in new }, home: home, allowed: true) else {
                Issue.record("Accepted unsafe metadata: \(change.keys)"); continue
            }
        }
    }

    @Test func candidateArchiveMustStayInItsExactChannel() {
        let url = CatalogCandidateRuntime.updateBase + "OMGSkills-Catalog-Candidate-0.0.22-22-arm64.zip"
        func accepts(_ raw: String?, build: String = "22", version: String = "0.0.22", kind: String = "application", delta: Bool = false) -> Bool {
            CatalogCandidateRuntime.acceptsArchive(url: raw.flatMap(URL.init(string:)), build: build, version: version,
                installationType: kind, isDelta: delta)
        }
        #expect(accepts(url))
        for other in [nil, "https://omgskills.com/OMGSkills.zip", url + "?override=1", url + "#fragment",
                      url.replacingOccurrences(of: "https:", with: "http:")] { #expect(!accepts(other)) }
        #expect(!accepts(url, build: "21"))
        #expect(!accepts(url, version: "0.0.21"))
        #expect(!accepts(url, kind: "package"))
        #expect(!accepts(url, delta: true))
    }

    @Test func candidateStartupCannotReachDiscoveryOrAutomaticUpdater() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/omgskills")
        let code = try String(contentsOf: root.appendingPathComponent("omgskillsApp.swift"), encoding: .utf8)
        let start = try #require(code.range(of: "switch catalogCandidateMode"))
        let end = try #require(code.range(of: "switch catalogInstallMode"))
        let branch = code[start.lowerBound..<end.lowerBound]
        #expect(branch.contains("CatalogInstallWindowController(candidate:"))
        #expect(branch.contains("controller.configureUpdates(updater)"))
        for unwanted in ["Analytics.start", "setupUpdater(", "showStatus()", "ContentView", "SkillsStore.shared", "PublicSkillInstallWindowController"] {
            #expect(!branch.contains(unwanted))
        }
        #expect(branch.contains("return"))
        #expect(code.contains("if catalogCandidateMode != .disabled { return CatalogCandidateRuntime.feedURL }"))
    }

    static func home() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("catalog-candidate-\(UUID())")
            .resolvingSymlinksInPath().standardizedFileURL
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        return root.standardizedFileURL
    }

    static func configuration(home: URL) throws -> CatalogCandidateRuntime.Configuration {
        switch CatalogCandidateRuntime.mode(info: info, home: home, allowed: true) {
        case .enabled(let configuration): return configuration
        case .invalid(let reason): throw ConfigurationFailure(reason: reason)
        case .disabled: throw ConfigurationFailure(reason: "Unexpected disabled candidate")
        }
    }
    private struct ConfigurationFailure: Error { let reason: String }
}

#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
struct CatalogCandidateRecordClientTests {
    @Test func fixedCandidateEndpointDoesNotUseProductionCookiesOrTokens() async throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        let config = try CatalogCandidateRuntimeTests.configuration(home: home)
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [CandidateRecordProtocol.self]
        let session = URLSession(configuration: sessionConfig)
        defer { session.invalidateAndCancel() }
        let client = CatalogInstallRecordClient(catalogCandidate: config, session: session)
        #expect(try await client.fetch(id: "owner/repo") == nil)
    }
}

private final class CandidateRecordProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        #expect(request.url?.absoluteString == CatalogCandidateRuntime.origin.absoluteString + "/api/catalog/install-record?id=owner/repo")
        #expect(!request.httpShouldHandleCookies)
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"version\":1,\"found\":false,\"skill\":null}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif
