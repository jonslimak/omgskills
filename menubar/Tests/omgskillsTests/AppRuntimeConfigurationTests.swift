import Foundation
import Testing
@testable import omgskills

struct AppRuntimeConfigurationTests {
    @Test func reconciliationRequiresAnExplicitValidatedConnectedDebugApp() throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-f1-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("home"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        var info = connectedInfo(root: root)
        guard case .enabled(let baseline) = AppRuntimeConfiguration.connectedInventoryMode(info: info, debugAllowed: true) else {
            Issue.record("Expected connected baseline"); return
        }
        #expect(!baseline.inventoryReconciliation)
        info[AppRuntimeConfiguration.inventoryReconciliationKey] = true
        guard case .enabled(let enabled) = AppRuntimeConfiguration.connectedInventoryMode(info: info, debugAllowed: true) else {
            Issue.record("Expected reconciliation configuration"); return
        }
        #expect(enabled.inventoryReconciliation)
        for invalid in [info.merging([AppRuntimeConfiguration.connectedInventoryKey: false]) { _, new in new },
                        [AppRuntimeConfiguration.inventoryReconciliationKey: true],
                        [AppRuntimeConfiguration.inventoryReconciliationKey: "true"]] {
            guard case .invalid = AppRuntimeConfiguration.connectedInventoryMode(info: invalid, debugAllowed: true) else {
                Issue.record("Expected orphan/malformed flag refusal"); continue
            }
        }
        guard case .invalid = AppRuntimeConfiguration.connectedInventoryMode(info: info, debugAllowed: false) else {
            Issue.record("Release must refuse reconciliation"); return
        }
    }

    @Test func connectedInventoryRequiresCompleteLocalDebugConfiguration() throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-f1-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("home"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let info = connectedInfo(root: root)
        guard case .enabled(let configuration) = AppRuntimeConfiguration.connectedInventoryMode(info: info, debugAllowed: true) else {
            Issue.record("Expected validated isolated connected configuration"); return
        }
        #expect(configuration.root == root.resolvingSymlinksInPath())
        #expect(configuration.filesystemPaths == .isolated(testRoot: root.resolvingSymlinksInPath()))
        #expect(configuration.connectURL.absoluteString == "http://127.0.0.1:5201/app/connect")
        #expect(configuration.uploadURL.absoluteString == "http://127.0.0.1:8888/api/portal/sync-upload")
        #expect(configuration.keychainService != DeviceCredentialStore.defaultService)
        #expect(AppRuntimeConfiguration.connectedInventoryMode(info: [:], debugAllowed: false) == .disabled)
        for key in ["OMGSkillsPortalConnectURL", "OMGSkillsSyncEndpoint", DeviceCredentialStore.serviceInfoKey,
                    AppRuntimeConfiguration.catalogInstallEnabledKey, AppRuntimeConfiguration.f1RootKey] {
            var missing = info
            missing.removeValue(forKey: key)
            guard case .invalid = AppRuntimeConfiguration.connectedInventoryMode(info: missing, debugAllowed: true) else {
                Issue.record("Missing \(key) must fail closed"); continue
            }
        }
        guard case .invalid = AppRuntimeConfiguration.connectedInventoryMode(info: info, debugAllowed: false) else {
            Issue.record("Release build cannot opt in"); return
        }
    }

    @Test func connectedInventoryCannotUseProductStorageOrRemoteEndpoints() throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-f1-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("home"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let invalidValues: [(String, Any)] = [
            ("CFBundleIdentifier", "com.jonslimak.omgskills"),
            (AppRuntimeConfiguration.connectedInventoryKey, "true"),
            (DeviceCredentialStore.serviceInfoKey, DeviceCredentialStore.defaultService),
            (DeviceCredentialStore.serviceInfoKey, "com.jonslimak.omgskills.inventory-test.another-run"),
            (AppRuntimeConfiguration.f1WebsiteKey, "http://127.0.0.1:5201/other/"),
            ("OMGSkillsPortalConnectURL", "https://omgskills.com/app/connect"),
            ("OMGSkillsPortalConnectURL", "http://127.0.0.1:5202/app/connect"),
            ("OMGSkillsPortalConnectURL", "http://127.0.0.1:5201/app/connect?callback=other"),
            ("OMGSkillsSyncEndpoint", "https://omgskills.com/api/portal/sync-upload"),
            ("OMGSkillsSyncEndpoint", "http://127.0.0.1:5201/api/portal/sync-upload"),
            ("OMGSkillsSyncEndpoint", "http://127.0.0.1:8888/api/portal/sync-upload#secret"),
            ("OMGSkillsSyncEndpoint", "http://user:secret@localhost:8888/api/portal/sync-upload"),
            ("OMGSkillsSyncEndpoint", "http://localhost:8888/other")
        ]
        for (key, value) in invalidValues {
            var info = connectedInfo(root: root)
            info[key] = value
            guard case .invalid = AppRuntimeConfiguration.connectedInventoryMode(info: info, debugAllowed: true) else {
                Issue.record("Unsafe \(key) must fail closed"); continue
            }
        }
        var disabled = connectedInfo(root: root)
        disabled[AppRuntimeConfiguration.connectedInventoryKey] = false
        #expect(AppRuntimeConfiguration.connectedInventoryMode(info: disabled, debugAllowed: true) == .disabled)
    }

    @Test func connectedInventoryRefusesRedirectedScanRoots() throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-f1-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("home/.codex"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let outside = root.appendingPathComponent("outside")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("home/.codex/skills"), withDestinationURL: outside)
        guard case .invalid = AppRuntimeConfiguration.connectedInventoryMode(info: connectedInfo(root: root), debugAllowed: true) else {
            Issue.record("Redirected agent root must not scan another home"); return
        }
    }

    private func connectedInfo(root: URL) -> [String: Any] {
        ["CFBundleIdentifier": AppRuntimeConfiguration.f1BundleID,
         "CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-f1"]]],
         AppRuntimeConfiguration.f1RootKey: root.path,
         AppRuntimeConfiguration.f1WebsiteKey: "http://127.0.0.1:5201/app/",
         AppRuntimeConfiguration.catalogInstallEnabledKey: true,
         AppRuntimeConfiguration.connectedInventoryKey: true,
         "OMGSkillsPortalConnectURL": "http://127.0.0.1:5201/app/connect",
         "OMGSkillsSyncEndpoint": "http://127.0.0.1:8888/api/portal/sync-upload",
         DeviceCredentialStore.serviceInfoKey: "com.jonslimak.omgskills.inventory-test.\(root.lastPathComponent.dropFirst("omgskills-f1-".count))"]
    }

    @Test func bundledLibraryPreviewRequiresExplicitBooleanFlag() {
        #expect(!AppRuntimeConfiguration.usesBundledLibraryPreview(infoDictionary: [:]))
        #expect(!AppRuntimeConfiguration.usesBundledLibraryPreview(
            infoDictionary: [AppRuntimeConfiguration.bundledLibraryPreviewKey: "true"]
        ))
        #expect(AppRuntimeConfiguration.usesBundledLibraryPreview(
            infoDictionary: [AppRuntimeConfiguration.bundledLibraryPreviewKey: true]
        ))
    }

    @Test func skillGroupsAuthDefaultsOffAndRequiresExplicitEnablement() {
        #expect(!AppRuntimeConfiguration.skillGroupsAuthSupported(
            infoDictionary: [:],
            environment: [:]
        ))
        #expect(!AppRuntimeConfiguration.skillGroupsAuthSupported(
            infoDictionary: [AppRuntimeConfiguration.skillGroupsAuthEnabledKey: "true"],
            environment: [:]
        ))
        #expect(AppRuntimeConfiguration.skillGroupsAuthSupported(
            infoDictionary: [AppRuntimeConfiguration.skillGroupsAuthEnabledKey: true],
            environment: [:]
        ))
    }

    @Test func skillGroupsAuthAllowsOnlyTheExplicitPrivatePreviewValue() {
        #expect(!AppRuntimeConfiguration.skillGroupsAuthSupported(
            infoDictionary: [:],
            environment: [AppRuntimeConfiguration.skillGroupsAuthPreviewEnvironmentKey: "true"]
        ))
        let previewEnabled = AppRuntimeConfiguration.skillGroupsAuthSupported(
            infoDictionary: [:],
            environment: [AppRuntimeConfiguration.skillGroupsAuthPreviewEnvironmentKey: "1"]
        )
        #if DEBUG
        #expect(previewEnabled)
        #else
        #expect(!previewEnabled)
        #endif
    }

    @Test func releaseConfigurationUsesSafeDebugOverrideOrProductionURL() {
        #expect(AppRuntimeConfiguration.skillGroupsReleaseConfigurationURL(environment: [:])
            == AppRuntimeConfiguration.productionReleaseConfigurationURL)
        let overrideURL = AppRuntimeConfiguration.skillGroupsReleaseConfigurationURL(environment: [
            AppRuntimeConfiguration.debugReleaseConfigurationURLEnvironmentKey:
                " http://localhost:8123/app/release-config.json "
        ])
        #if DEBUG
        #expect(overrideURL.absoluteString == "http://localhost:8123/app/release-config.json")
        #else
        #expect(overrideURL == AppRuntimeConfiguration.productionReleaseConfigurationURL)
        #endif
        #expect(AppRuntimeConfiguration.skillGroupsReleaseConfigurationURL(environment: [
            AppRuntimeConfiguration.debugReleaseConfigurationURLEnvironmentKey:
                "http://example.com/app/release-config.json"
        ]) == AppRuntimeConfiguration.productionReleaseConfigurationURL)
        #expect(AppRuntimeConfiguration.skillGroupsReleaseConfigurationURL(environment: [
            AppRuntimeConfiguration.debugReleaseConfigurationURLEnvironmentKey:
                "file:///tmp/release-config.json"
        ]) == AppRuntimeConfiguration.productionReleaseConfigurationURL)
    }

    @Test func catalogTestModeRequiresBothValidAbsolutePaths() {
        let rootOnly = AppRuntimeConfiguration.runtimeContext(
            infoDictionary: [:],
            environment: [
                AppRuntimeConfiguration.debugGroupInstallRootEnvironmentKey: "/tmp/omgskills-test"
            ],
            debugOverridesAllowed: true
        )
        guard case .invalid = rootOnly.catalogTestMode else {
            Issue.record("Expected a root-only override to fail closed")
            return
        }

        let catalogOnly = AppRuntimeConfiguration.runtimeContext(
            infoDictionary: [:],
            environment: [
                AppRuntimeConfiguration.debugCatalogPathEnvironmentKey: sharedCatalogFixtureURL.path
            ],
            debugOverridesAllowed: true
        )
        guard case .invalid = catalogOnly.catalogTestMode else {
            Issue.record("Expected a catalog-only override to fail closed")
            return
        }

        let relativeRoot = AppRuntimeConfiguration.runtimeContext(
            infoDictionary: [:],
            environment: [
                AppRuntimeConfiguration.debugGroupInstallRootEnvironmentKey: "relative/path",
                AppRuntimeConfiguration.debugCatalogPathEnvironmentKey: sharedCatalogFixtureURL.path
            ],
            debugOverridesAllowed: true
        )
        guard case .invalid = relativeRoot.catalogTestMode else {
            Issue.record("Expected a relative test root to fail closed")
            return
        }
    }

    #if !DEBUG
    @Test func compiledReleaseIgnoresCatalogOverridesWithoutTestInjection() {
        let context = AppRuntimeConfiguration.runtimeContext(
            infoDictionary: [:],
            environment: [
                AppRuntimeConfiguration.debugGroupInstallRootEnvironmentKey: "/tmp/omgskills-catalog-test",
                AppRuntimeConfiguration.debugCatalogPathEnvironmentKey: sharedCatalogFixtureURL.path
            ]
        )
        #expect(context.catalogTestMode == .disabled)
        #expect(context.testCatalogURL == nil)
        #expect(!context.usesBundledLibraryPreview)
        #expect(context.skillFilesystemPaths == .production())
    }
    #endif

    @Test func validCatalogTestModeUsesOneIsolatedRuntimeContext() {
        let root = URL(fileURLWithPath: "/tmp/omgskills-catalog-test", isDirectory: true)
        let context = AppRuntimeConfiguration.runtimeContext(
            infoDictionary: [:],
            environment: [
                AppRuntimeConfiguration.debugGroupInstallRootEnvironmentKey: root.path,
                AppRuntimeConfiguration.debugCatalogPathEnvironmentKey: sharedCatalogFixtureURL.path
            ],
            debugOverridesAllowed: true
        )

        #expect(context.catalogTestMode == .enabled(
            root: root.resolvingSymlinksInPath(),
            catalog: sharedCatalogFixtureURL.standardizedFileURL
        ))
        #expect(context.usesBundledLibraryPreview)
        #expect(context.testCatalogURL == sharedCatalogFixtureURL.standardizedFileURL)
        #expect(context.skillFilesystemPaths.homeDirectory == root.resolvingSymlinksInPath()
            .appendingPathComponent("home", isDirectory: true))
        #expect(context.skillFilesystemPaths.legacyRepoCacheRoot == root.resolvingSymlinksInPath()
            .appendingPathComponent("legacy-repos", isDirectory: true))
        #expect(context.groupInstallRuntimePaths.homeDirectory == context.skillFilesystemPaths.homeDirectory)
        #expect(context.groupInstallRuntimePaths.managedRoot == root.resolvingSymlinksInPath()
            .appendingPathComponent("managed", isDirectory: true))
        #expect(context.groupInstallRuntimePaths.pathAnchor == context.skillFilesystemPaths.homeDirectory)
    }

    @Test func malformedCatalogAndRootInsideRealHomeFailClosed() throws {
        let malformedCatalog = FileManager.default.temporaryDirectory
            .appendingPathComponent("omgskills-invalid-catalog-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: malformedCatalog) }
        try Data("{}".utf8).write(to: malformedCatalog)

        let malformed = AppRuntimeConfiguration.runtimeContext(
            infoDictionary: [:],
            environment: [
                AppRuntimeConfiguration.debugGroupInstallRootEnvironmentKey: "/tmp/omgskills-catalog-test",
                AppRuntimeConfiguration.debugCatalogPathEnvironmentKey: malformedCatalog.path
            ],
            debugOverridesAllowed: true
        )
        guard case .invalid = malformed.catalogTestMode else {
            Issue.record("Expected malformed test catalog to fail closed")
            return
        }

        let homeRoot = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("omgskills-unsafe-test-root", isDirectory: true)
        let insideHome = AppRuntimeConfiguration.runtimeContext(
            infoDictionary: [:],
            environment: [
                AppRuntimeConfiguration.debugGroupInstallRootEnvironmentKey: homeRoot.path,
                AppRuntimeConfiguration.debugCatalogPathEnvironmentKey: sharedCatalogFixtureURL.path
            ],
            debugOverridesAllowed: true
        )
        guard case .invalid = insideHome.catalogTestMode else {
            Issue.record("Expected a test root inside the real home to fail closed")
            return
        }
    }

    @Test func releaseBuildIgnoresAllCatalogTestOverrides() {
        let context = AppRuntimeConfiguration.runtimeContext(
            infoDictionary: [:],
            environment: [
                AppRuntimeConfiguration.debugGroupInstallRootEnvironmentKey: "/tmp/omgskills-catalog-test",
                AppRuntimeConfiguration.debugCatalogPathEnvironmentKey: sharedCatalogFixtureURL.path
            ],
            debugOverridesAllowed: false
        )

        #expect(context.catalogTestMode == AppRuntimeConfiguration.CatalogTestMode.disabled)
        #expect(!context.usesBundledLibraryPreview)
        #expect(context.testCatalogURL == nil)
        #expect(context.skillFilesystemPaths == SkillFilesystemPaths.production())
        #expect(context.groupInstallRuntimePaths == GroupInstallRuntimePaths.production)
    }

    private var sharedCatalogFixtureURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("index/scraper/new-crawl/fixtures/pinned-install-skills.json")
            .standardizedFileURL
    }
}
