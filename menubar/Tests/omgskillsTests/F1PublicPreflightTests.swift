#if DEBUG
import Foundation
import Testing
@testable import omgskills

struct F1PublicPreflightTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["OMGSKILLS_F1_PUBLIC_PREFLIGHT"] == "1"))
    func realPublicRevisionsResolveReviewAndApplyInTemporaryHome() async throws {
        let rawRoot = URL(fileURLWithPath: "/private/tmp/omgskills-f1-preflight-" + UUID().uuidString, isDirectory: true)
        let fm = FileManager.default
        try fm.createDirectory(at: rawRoot.appendingPathComponent("home"), withIntermediateDirectories: true)
        defer { removeFixture(rawRoot) }
        let info: [String: Any] = ["CFBundleIdentifier": AppRuntimeConfiguration.f1BundleID,
            "CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-f1"]]],
            AppRuntimeConfiguration.f1RootKey: rawRoot.path,
            AppRuntimeConfiguration.f1WebsiteKey: "http://127.0.0.1:5197/app/preview/unified/"]
        guard case .enabled(let root, _) = AppRuntimeConfiguration.f1Mode(info: info, debugAllowed: true) else {
            Issue.record("Public preflight runtime configuration was rejected"); return
        }
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let installer = ManagedSkillInstaller(managedRoot: root.appendingPathComponent("managed"), pathAnchor: paths.homeDirectory)
        let fetcher = GitPublicSkillPackageFetcher(temporaryRoot: root)
        let a = try PublicSkillInstallRequest(catalogID: "anthropics/skills:skills/frontend-design", repositorySlug: "anthropics/skills",
            skillMDPath: "skills/frontend-design/SKILL.md", commitSha: "2235be7c60b551f5de82ade908fd3816455afcda")
        let b = try PublicSkillInstallRequest(catalogID: a.catalogID, repositorySlug: a.repositorySlug, skillMDPath: a.skillMDPath,
            commitSha: "41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f")
        let packageA = try await fetcher.resolvePackage(a)
        let packageB = try await fetcher.resolvePackage(b)
        #expect(packageA.coordinates.treeSha != packageB.coordinates.treeSha)
        let reviewA = try await installer.preparePublicInstall(a, package: packageA, filesystemPaths: paths)
        #expect(reviewA.action == .install)
        _ = try await installer.applyPublicInstall(reviewID: reviewA.id)
        let reviewB = try await installer.preparePublicInstall(b, package: packageB, filesystemPaths: paths)
        #expect(reviewB.action == .update)
        #expect(reviewB.changes.map(\.path) == ["SKILL.md"])
        _ = try await installer.applyPublicInstall(reviewID: reviewB.id)
        for entry in packageB.entries {
            #expect(try Data(contentsOf: paths.codexSkillsRoot.appendingPathComponent("frontend-design").appendingPathComponent(entry.path)) == entry.data)
        }
        print("F1 public A: \(packageA.coordinates); B: \(packageB.coordinates); changed: SKILL.md; exact B bytes verified")
    }

    private func removeFixture(_ root: URL) {
        let fm = FileManager.default
        if let entries = fm.enumerator(at: root, includingPropertiesForKeys: nil) {
            for case let url as URL in entries {
                if (try? fm.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType) == .typeDirectory {
                    try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
                }
            }
        }
        try? fm.removeItem(at: root)
    }
}
#endif
