import Foundation
import Testing
@testable import omgskills

struct AppResourceTests {
    @Test func skillOriginIconsAreAvailable() {
        #expect(AppResource.url(forResource: "claude-origin", withExtension: "png") != nil)
        #expect(AppResource.url(forResource: "codex-origin", withExtension: "png") != nil)
    }

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

    @Test func genericShadowAssetLookupResolvesCutoverSkillsFromRepoShadowPath() throws {
        let tempRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let shadowDir = tempRoot.appendingPathComponent("index/shadow", isDirectory: true)
        let fileURL = shadowDir.appendingPathComponent(AppResource.cutoverShadowSkillsFilename)
        try FileManager.default.createDirectory(at: shadowDir, withIntermediateDirectories: true)
        try "{}".write(to: fileURL, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: tempRoot) }

        let candidates = [
            fileURL,
            tempRoot.appendingPathComponent("missing.json"),
        ]
        let resolved = candidates.first { FileManager.default.fileExists(atPath: $0.path) }

        #expect(resolved == fileURL)
    }

    @Test func genericShadowAssetLookupResolvesCutoverSignalsFromRepoShadowPath() throws {
        let tempRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let shadowDir = tempRoot.appendingPathComponent("index/shadow", isDirectory: true)
        let fileURL = shadowDir.appendingPathComponent(AppResource.cutoverShadowSkillSignalsFilename)
        try FileManager.default.createDirectory(at: shadowDir, withIntermediateDirectories: true)
        try "{}".write(to: fileURL, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: tempRoot) }

        let candidates = [
            tempRoot.appendingPathComponent("missing.json"),
            fileURL,
        ]
        let resolved = candidates.first { FileManager.default.fileExists(atPath: $0.path) }

        #expect(resolved == fileURL)
    }

    @Test func shadowAssetURLCandidatesIncludeRepoShadowPathForAllSupportedAssets() {
        let inspectable = AppResource.shadowAssetURLCandidates(for: .inspectableSkills).map(\.path)
        let cutoverSkills = AppResource.shadowAssetURLCandidates(for: .cutoverSkills).map(\.path)
        let cutoverSignals = AppResource.shadowAssetURLCandidates(for: .cutoverSkillSignals).map(\.path)

        #expect(inspectable.contains { $0.hasSuffix("/index/shadow/\(AppResource.inspectableShadowSkillsFilename)") })
        #expect(cutoverSkills.contains { $0.hasSuffix("/index/shadow/\(AppResource.cutoverShadowSkillsFilename)") })
        #expect(cutoverSignals.contains { $0.hasSuffix("/index/shadow/\(AppResource.cutoverShadowSkillSignalsFilename)") })
    }
}
