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
        #expect(!AppRuntimeConfiguration.skillGroupsAuthEnabled(
            infoDictionary: [:],
            environment: [:]
        ))
        #expect(!AppRuntimeConfiguration.skillGroupsAuthEnabled(
            infoDictionary: [AppRuntimeConfiguration.skillGroupsAuthEnabledKey: "true"],
            environment: [:]
        ))
        #expect(AppRuntimeConfiguration.skillGroupsAuthEnabled(
            infoDictionary: [AppRuntimeConfiguration.skillGroupsAuthEnabledKey: true],
            environment: [:]
        ))
    }

    @Test func skillGroupsAuthAllowsOnlyTheExplicitPrivatePreviewValue() {
        #expect(!AppRuntimeConfiguration.skillGroupsAuthEnabled(
            infoDictionary: [:],
            environment: [AppRuntimeConfiguration.skillGroupsAuthPreviewEnvironmentKey: "true"]
        ))
        #expect(AppRuntimeConfiguration.skillGroupsAuthEnabled(
            infoDictionary: [:],
            environment: [AppRuntimeConfiguration.skillGroupsAuthPreviewEnvironmentKey: "1"]
        ))
    }
}
