import Foundation
import Testing
@testable import omgskills

struct AppRuntimeConfigurationTests {
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
        #expect(AppRuntimeConfiguration.skillGroupsAuthSupported(
            infoDictionary: [:],
            environment: [AppRuntimeConfiguration.skillGroupsAuthPreviewEnvironmentKey: "1"]
        ))
    }

    @Test func releaseConfigurationUsesSafeDebugOverrideOrProductionURL() {
        #expect(AppRuntimeConfiguration.skillGroupsReleaseConfigurationURL(environment: [:])
            == AppRuntimeConfiguration.productionReleaseConfigurationURL)
        #expect(AppRuntimeConfiguration.skillGroupsReleaseConfigurationURL(environment: [
            AppRuntimeConfiguration.debugReleaseConfigurationURLEnvironmentKey:
                " http://localhost:8123/app/release-config.json "
        ]).absoluteString == "http://localhost:8123/app/release-config.json")
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
