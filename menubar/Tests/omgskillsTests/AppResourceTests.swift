import Foundation
import Testing
@testable import omgskills

struct AppResourceTests {
    @Test func shadowSkillsURLUsesEnvironmentOverride() throws {
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("json")
        try "{}".write(to: tempURL, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: tempURL) }

        let resolved = AppResource.shadowSkillsURL(
            environment: ["OMGSKILLS_SHADOW_LIBRARY_PATH": tempURL.path]
        )

        #expect(resolved == tempURL)
    }

    @Test func shadowSkillsURLCandidatesIncludeRepoShadowPath() {
        let paths = AppResource.shadowSkillsURLCandidates().map(\.path)
        #expect(paths.contains { $0.hasSuffix("/index/shadow/\(AppResource.inspectableShadowSkillsFilename)") })
    }
}
