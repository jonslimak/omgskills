import Foundation
import Testing
@testable import omgskills

struct CatalogInstallRuntimeTests {
    @Test func catalogFlowRequiresExplicitDebugF1Configuration() throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-f1-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        var info: [String: Any] = [
            "CFBundleIdentifier": AppRuntimeConfiguration.f1BundleID,
            "CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-f1"]]],
            AppRuntimeConfiguration.f1RootKey: root.path,
            AppRuntimeConfiguration.f1WebsiteKey: "http://127.0.0.1:5197/app/",
        ]
        #expect(AppRuntimeConfiguration.catalogInstallMode(info: info, debugAllowed: true) == .disabled)
        info[AppRuntimeConfiguration.catalogInstallEnabledKey] = false
        #expect(AppRuntimeConfiguration.catalogInstallMode(info: info, debugAllowed: true) == .disabled)
        info[AppRuntimeConfiguration.catalogInstallEnabledKey] = true
        guard case .enabled(let configuredRoot, let website) = AppRuntimeConfiguration.catalogInstallMode(info: info, debugAllowed: true) else {
            Issue.record("Explicit isolated Debug configuration must be accepted"); return
        }
        #expect(configuredRoot == root.resolvingSymlinksInPath())
        #expect(website.absoluteString == "http://127.0.0.1:5197/app/")
        guard case .invalid = AppRuntimeConfiguration.catalogInstallMode(info: info, debugAllowed: false) else {
            Issue.record("Release must not enable the catalog test"); return
        }
        for identity in ["com.jonslimak.omgskills", "com.jonslimak.omgskills.setuptest"] {
            var invalid = info
            invalid["CFBundleIdentifier"] = identity
            guard case .invalid = AppRuntimeConfiguration.catalogInstallMode(info: invalid, debugAllowed: true) else {
                Issue.record("Another app identity must not accept the test flag"); continue
            }
        }
        info[AppRuntimeConfiguration.catalogInstallEnabledKey] = "true"
        guard case .invalid = AppRuntimeConfiguration.catalogInstallMode(info: info, debugAllowed: true) else {
            Issue.record("Invalid test flags must not fall back to another installer"); return
        }
        #expect(AppRuntimeConfiguration.catalogInstallMode(info: [:], debugAllowed: false) == .disabled)
    }

    @Test func catalogStartupIsSeparateFromOldReviewAndDiscovery() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/omgskills/omgskillsApp.swift")
        let code = try String(contentsOf: file, encoding: .utf8)
        let catalog = try #require(code.range(of: "switch catalogInstallMode"))
        let old = try #require(code.range(of: "switch setupTestMode"))
        let branch = code[catalog.lowerBound..<old.lowerBound]
        #expect(branch.contains("CatalogInstallWindowController"))
        #expect(branch.contains("return"))
        #expect(!branch.contains("showStatus()"))
        #expect(!branch.contains("PublicSkillInstallWindowController"))
        #expect(!branch.contains("setupUpdater"))
        #expect(!branch.contains("Analytics.start"))
        #expect(!branch.contains("ContentView"))
        let open = try #require(code.range(of: "func application(_ application: NSApplication, open urls:"))
        let rest = code[open.lowerBound...]
        #expect(rest.range(of: "if catalogInstallMode")!.lowerBound < rest.range(of: "if setupTestMode")!.lowerBound)
        #expect(rest.contains("pendingCatalogInstallURL"))
    }
}
