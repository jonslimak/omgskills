import Foundation
import Testing
@testable import omgskills

struct LocalSkillCrossInstallerTests {
    @Test func installsSymlinkToExistingLocalSkill() throws {
        let root = try temporaryDirectory()
        let source = root.appendingPathComponent("source-skill", isDirectory: true)
        let targetRoot = root.appendingPathComponent("codex", isDirectory: true)
        try writeSkill(at: source)

        let result = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(path: source.path, origin: "Claude"),
            targetRoot: targetRoot
        )

        let target = targetRoot.appendingPathComponent("source-skill", isDirectory: true)
        #expect(result == .installed)
        #expect(FileManager.default.fileExists(atPath: target.appendingPathComponent("SKILL.md").path))
        #expect((try? target.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true)
    }

    @Test func returnsAlreadyInstalledWhenTargetHasSkillFile() throws {
        let root = try temporaryDirectory()
        let source = root.appendingPathComponent("source-skill", isDirectory: true)
        let target = root.appendingPathComponent("codex/source-skill", isDirectory: true)
        try writeSkill(at: source)
        try writeSkill(at: target)

        let result = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(path: source.path, origin: "Claude"),
            targetRoot: root.appendingPathComponent("codex", isDirectory: true)
        )

        #expect(result == .alreadyInstalled)
    }

    @Test func symlinkSourceInstallsResolvedDestination() throws {
        let root = try temporaryDirectory()
        let realSource = root.appendingPathComponent("real-source", isDirectory: true)
        let linkedSource = root.appendingPathComponent("linked-source", isDirectory: true)
        let targetRoot = root.appendingPathComponent("codex", isDirectory: true)
        try writeSkill(at: realSource)
        try FileManager.default.createSymbolicLink(at: linkedSource, withDestinationURL: realSource)

        _ = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(path: linkedSource.path, origin: "Claude"),
            targetRoot: targetRoot
        )

        let target = targetRoot.appendingPathComponent("linked-source", isDirectory: true)
        #expect(target.resolvingSymlinksInPath().path == realSource.path)
    }

    @Test func resolvedSkillWritesProvenanceAndCreatesMetadataDirectory() throws {
        let root = try temporaryDirectory()
        let source = root.appendingPathComponent("source-skill", isDirectory: true)
        let targetRoot = root.appendingPathComponent("codex", isDirectory: true)
        try writeSkill(at: source)

        _ = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(
                path: source.path,
                origin: "Claude",
                githubUrl: "https://github.com/owner/repo",
                catalogSkillId: "owner/repo:skills/source-skill",
                identityStatus: .resolved(method: .git)
            ),
            targetRoot: targetRoot
        )

        let metadataURL = targetRoot.appendingPathComponent(".omgskills/source-skill.json")
        let provenance = try JSONDecoder().decode(
            SkillInstallProvenance.self,
            from: Data(contentsOf: metadataURL)
        )
        #expect(provenance.catalogSkillId == "owner/repo:skills/source-skill")
        #expect(provenance.githubUrl == "https://github.com/owner/repo")
        let skillData = try Data(contentsOf: source.appendingPathComponent("SKILL.md"))
        #expect(provenance.skillMdSha == SkillIdentityResolver.gitBlobSHA(for: skillData))
    }

    @Test func localEditChangesCurrentShaWithoutRewritingInstallProvenance() throws {
        let root = try temporaryDirectory()
        let source = root.appendingPathComponent("source-skill", isDirectory: true)
        let targetRoot = root.appendingPathComponent("codex", isDirectory: true)
        try writeSkill(at: source)

        _ = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(
                path: source.path,
                origin: "Claude",
                githubUrl: "https://github.com/owner/repo",
                catalogSkillId: "owner/repo:skills/source-skill",
                identityStatus: .resolved(method: .git)
            ),
            targetRoot: targetRoot
        )

        let installedProvenance = try #require(SkillInstallProvenanceStore.read(
            targetRoot: targetRoot,
            targetName: "source-skill"
        ))
        try """
        ---
        name: source-skill
        description: Edited locally.
        ---
        """.write(
            to: source.appendingPathComponent("SKILL.md"),
            atomically: true,
            encoding: .utf8
        )

        let scan = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: targetRoot, origin: "Codex")
        ])
        let currentSha = try #require(scan.installations.first?.skillMdSha)
        let persistedProvenance = try #require(SkillInstallProvenanceStore.read(
            targetRoot: targetRoot,
            targetName: "source-skill"
        ))

        #expect(currentSha != installedProvenance.skillMdSha)
        #expect(persistedProvenance.skillMdSha == installedProvenance.skillMdSha)
    }

    @Test func ambiguousAndLocalOnlySkillsDoNotWriteProvenance() throws {
        let root = try temporaryDirectory()
        let targetRoot = root.appendingPathComponent("codex", isDirectory: true)

        let ambiguousSource = root.appendingPathComponent("ambiguous", isDirectory: true)
        try writeSkill(at: ambiguousSource)
        _ = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(
                path: ambiguousSource.path,
                origin: "Claude",
                identityStatus: .ambiguous(skillIds: ["owner/repo:a", "owner/repo:b"])
            ),
            targetRoot: targetRoot
        )

        let localSource = root.appendingPathComponent("local", isDirectory: true)
        try writeSkill(at: localSource)
        _ = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(path: localSource.path, origin: "Claude", identityStatus: .localOnly),
            targetRoot: targetRoot
        )

        #expect(!FileManager.default.fileExists(atPath: targetRoot.appendingPathComponent(".omgskills/ambiguous.json").path))
        #expect(!FileManager.default.fileExists(atPath: targetRoot.appendingPathComponent(".omgskills/local.json").path))
    }

    @Test func provenanceFailureRemovesNewSymlink() throws {
        let root = try temporaryDirectory()
        let source = root.appendingPathComponent("source-skill", isDirectory: true)
        let targetRoot = root.appendingPathComponent("codex", isDirectory: true)
        try writeSkill(at: source)
        try FileManager.default.createDirectory(at: targetRoot, withIntermediateDirectories: true)
        try Data("not a directory".utf8).write(to: targetRoot.appendingPathComponent(".omgskills"))

        #expect(throws: (any Error).self) {
            try LocalSkillCrossInstaller.install(
                makeInstalledSkill(
                    path: source.path,
                    origin: "Claude",
                    catalogSkillId: "owner/repo:source-skill",
                    identityStatus: .resolved(method: .sha)
                ),
                targetRoot: targetRoot
            )
        }

        #expect(!FileManager.default.fileExists(atPath: targetRoot.appendingPathComponent("source-skill").path))
    }

    @Test func crossInstalledSkillResolvesFromWrittenProvenance() throws {
        let root = try temporaryDirectory()
        let source = root.appendingPathComponent("source-skill", isDirectory: true)
        let targetRoot = root.appendingPathComponent("codex", isDirectory: true)
        try writeSkill(at: source)
        let catalogSkillId = "owner/repo:skills/source-skill"

        _ = try LocalSkillCrossInstaller.install(
            makeInstalledSkill(
                path: source.path,
                origin: "Claude",
                githubUrl: "https://github.com/owner/repo",
                catalogSkillId: catalogSkillId,
                identityStatus: .resolved(method: .git)
            ),
            targetRoot: targetRoot
        )

        let scan = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: targetRoot, origin: "Codex")
        ])
        let installed = try #require(scan.installations.first)
        let catalog = makeCatalogSkill(id: catalogSkillId)
        let result = SkillIdentityResolver(catalogSkills: [catalog], shaHistory: nil).resolve(installed)

        #expect(result.catalogSkillId == catalogSkillId)
        #expect(result.status == .resolved(method: .provenance))
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writeSkill(at directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let content = """
        ---
        name: source-skill
        description: Example skill.
        ---
        """
        try content.write(to: directory.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
    }

    private func makeInstalledSkill(
        path: String,
        origin: String,
        githubUrl: String = "",
        catalogSkillId: String? = nil,
        identityStatus: SkillIdentityStatus? = nil
    ) -> Skill {
        Skill(
            id: "installed:\(path)",
            name: "source-skill",
            description: "Example skill.",
            githubUrl: githubUrl,
            installCmd: path,
            authorHandle: "",
            tags: [],
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: "",
            firstSeen: "",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: origin,
            isSymlink: nil,
            isLocalOnly: nil,
            catalogSkillId: catalogSkillId,
            identityStatus: identityStatus
        )
    }

    private func makeCatalogSkill(id: String) -> Skill {
        Skill(
            id: id,
            name: "source-skill",
            description: "Example skill.",
            githubUrl: "https://github.com/owner/repo",
            installCmd: "",
            authorHandle: "owner",
            tags: [],
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: "",
            firstSeen: "",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: nil,
            isSymlink: nil,
            isLocalOnly: nil
        )
    }
}
