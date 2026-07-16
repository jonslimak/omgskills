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
}
