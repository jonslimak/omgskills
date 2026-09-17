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

    @Test func debugGroupInstallRootIsIsolatedAndRequiresAnAbsolutePath() {
        let paths = AppRuntimeConfiguration.groupInstallRuntimePaths(infoDictionary: [:], environment: [
            AppRuntimeConfiguration.debugGroupInstallRootEnvironmentKey: "/tmp/omgskills-group-test"
        ])
        #expect(paths.homeDirectory.path == "/tmp/omgskills-group-test/home")
        #expect(paths.managedRoot.path == "/tmp/omgskills-group-test/managed")
        #expect(paths.pathAnchor == paths.homeDirectory)

        #expect(
            AppRuntimeConfiguration.groupInstallRuntimePaths(infoDictionary: [:], environment: [
                AppRuntimeConfiguration.debugGroupInstallRootEnvironmentKey: "relative/path"
            ]) == .production
        )
    }

    @Test func debugGroupInstallRootCanBeBundledForSafeManualTesting() {
        let paths = AppRuntimeConfiguration.groupInstallRuntimePaths(
            infoDictionary: [
                AppRuntimeConfiguration.debugGroupInstallRootInfoKey: "/tmp/omgskills-bundled-group-test"
            ],
            environment: [:]
        )
        #expect(paths.homeDirectory.path == "/tmp/omgskills-bundled-group-test/home")
        #expect(paths.managedRoot.path == "/tmp/omgskills-bundled-group-test/managed")
        #expect(paths.pathAnchor == paths.homeDirectory)
    }
}
