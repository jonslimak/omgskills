#if OMGSKILLS_CATALOG_CANDIDATE
import Foundation
import Testing
@testable import omgskills

struct CatalogCandidatePackageTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["OMGSKILLS_CATALOG_CANDIDATE_PACKAGE"] != nil))
    func packagedSettingsPassTheActualCandidateRuntimeWithoutLaunching() throws {
        let app = try #require(ProcessInfo.processInfo.environment["OMGSKILLS_CATALOG_CANDIDATE_PACKAGE"])
        let url = URL(fileURLWithPath: app).appendingPathComponent("Contents/Info.plist")
        let info = try #require(PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        guard case .enabled(let configuration) = CatalogCandidateRuntime.mode(info: info, home: home) else {
            Issue.record("Packaged metadata did not enable the candidate runtime"); return
        }
        #expect(CatalogCandidateRuntime.buildAllowed)
        #expect(info["CFBundleExecutable"] as? String == "omgskills")
        #expect(configuration.paths.codexSkillsRoot.path == home.path + "/.codex/skills")
        #expect(configuration.paths.claudeSkillsRoot.path == home.path + "/.claude/skills")
        #expect(try FileManager.default.contentsOfDirectory(atPath: home.path).isEmpty)
    }
}
#endif
