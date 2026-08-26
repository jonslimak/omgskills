import Foundation
import Testing
@testable import omgskills

struct InstalledSkillUninstallerTests {
    private enum TestError: Error {
        case trashFailed
    }

    @Test func symlinkUninstallRemovesMatchingProvenance() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let skillsRoot = root.appendingPathComponent("codex", isDirectory: true)
        let source = root.appendingPathComponent("source", isDirectory: true)
        let installation = skillsRoot.appendingPathComponent("example", isDirectory: true)
        try writeSkill(at: source)
        try FileManager.default.createDirectory(at: skillsRoot, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: installation, withDestinationURL: source)
        try writeProvenance(targetRoot: skillsRoot, targetName: "example")

        let result = try InstalledSkillUninstaller.uninstall(
            installedSkill(at: installation, isSymlink: true),
            allowedRoots: [skillsRoot]
        )

        #expect(result == .init(provenanceRemoved: true, provenanceCleanupWarning: nil))
        #expect(!FileManager.default.fileExists(atPath: installation.path))
        #expect(!FileManager.default.fileExists(
            atPath: SkillInstallProvenanceStore.metadataURL(
                targetRoot: skillsRoot,
                targetName: "example"
            ).path
        ))
    }

    @Test func directoryUninstallRemovesMatchingProvenanceAfterTrashSucceeds() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let skillsRoot = root.appendingPathComponent("claude", isDirectory: true)
        let installation = skillsRoot.appendingPathComponent("example", isDirectory: true)
        try writeSkill(at: installation)
        try writeProvenance(targetRoot: skillsRoot, targetName: "example")
        var trashedPath: String?

        let result = try InstalledSkillUninstaller.uninstall(
            installedSkill(at: installation, isSymlink: false),
            allowedRoots: [skillsRoot],
            trashItem: { url in
                trashedPath = url.path
                try FileManager.default.removeItem(at: url)
            }
        )

        #expect(trashedPath == installation.path)
        #expect(result.provenanceRemoved)
        #expect(result.provenanceCleanupWarning == nil)
    }

    @Test func liveInstallationKeepsProvenance() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let skillsRoot = root.appendingPathComponent("codex", isDirectory: true)
        let installation = skillsRoot.appendingPathComponent("example", isDirectory: true)
        try writeSkill(at: installation)
        try writeProvenance(targetRoot: skillsRoot, targetName: "example")

        let removed = try SkillInstallProvenanceStore.removeIfOrphaned(
            targetRoot: skillsRoot,
            targetName: "example",
            installationURL: installation
        )

        #expect(!removed)
        #expect(FileManager.default.fileExists(
            atPath: SkillInstallProvenanceStore.metadataURL(
                targetRoot: skillsRoot,
                targetName: "example"
            ).path
        ))
    }

    @Test func uninstallOnlyRemovesProvenanceFromMatchingRoot() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let codexRoot = root.appendingPathComponent("codex", isDirectory: true)
        let claudeRoot = root.appendingPathComponent("claude", isDirectory: true)
        let codexInstallation = codexRoot.appendingPathComponent("example", isDirectory: true)
        try writeSkill(at: codexInstallation)
        try writeSkill(at: claudeRoot.appendingPathComponent("example", isDirectory: true))
        try writeProvenance(targetRoot: codexRoot, targetName: "example")
        try writeProvenance(targetRoot: claudeRoot, targetName: "example")

        _ = try InstalledSkillUninstaller.uninstall(
            installedSkill(at: codexInstallation, isSymlink: false),
            allowedRoots: [codexRoot, claudeRoot],
            trashItem: { try FileManager.default.removeItem(at: $0) }
        )

        #expect(!FileManager.default.fileExists(
            atPath: SkillInstallProvenanceStore.metadataURL(
                targetRoot: codexRoot,
                targetName: "example"
            ).path
        ))
        #expect(FileManager.default.fileExists(
            atPath: SkillInstallProvenanceStore.metadataURL(
                targetRoot: claudeRoot,
                targetName: "example"
            ).path
        ))
    }

    @Test func blockedUninstallLeavesInstallationAndProvenance() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let allowedRoot = root.appendingPathComponent("allowed", isDirectory: true)
        let outsideRoot = root.appendingPathComponent("outside", isDirectory: true)
        let installation = outsideRoot.appendingPathComponent("example", isDirectory: true)
        try writeSkill(at: installation)
        try writeProvenance(targetRoot: outsideRoot, targetName: "example")

        #expect(throws: InstalledSkillUninstaller.UninstallError.unexpectedSkillPath) {
            try InstalledSkillUninstaller.uninstall(
                installedSkill(at: installation, isSymlink: false),
                allowedRoots: [allowedRoot]
            )
        }
        #expect(FileManager.default.fileExists(
            atPath: installation.appendingPathComponent("SKILL.md").path
        ))
        #expect(FileManager.default.fileExists(
            atPath: SkillInstallProvenanceStore.metadataURL(
                targetRoot: outsideRoot,
                targetName: "example"
            ).path
        ))
    }

    @Test func failedTrashOperationLeavesInstallationAndProvenance() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let skillsRoot = root.appendingPathComponent("claude", isDirectory: true)
        let installation = skillsRoot.appendingPathComponent("example", isDirectory: true)
        try writeSkill(at: installation)
        try writeProvenance(targetRoot: skillsRoot, targetName: "example")

        #expect(throws: TestError.trashFailed) {
            try InstalledSkillUninstaller.uninstall(
                installedSkill(at: installation, isSymlink: false),
                allowedRoots: [skillsRoot],
                trashItem: { _ in throw TestError.trashFailed }
            )
        }
        #expect(FileManager.default.fileExists(
            atPath: installation.appendingPathComponent("SKILL.md").path
        ))
        #expect(FileManager.default.fileExists(
            atPath: SkillInstallProvenanceStore.metadataURL(
                targetRoot: skillsRoot,
                targetName: "example"
            ).path
        ))
    }

    @Test func scanningDoesNotCleanManuallyOrphanedProvenance() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let skillsRoot = root.appendingPathComponent("codex", isDirectory: true)
        try writeProvenance(targetRoot: skillsRoot, targetName: "manually-deleted")
        let metadataURL = SkillInstallProvenanceStore.metadataURL(
            targetRoot: skillsRoot,
            targetName: "manually-deleted"
        )

        _ = InstalledSkillsScanner.scan(roots: [
            .init(url: skillsRoot, origin: "Codex")
        ])

        #expect(FileManager.default.fileExists(atPath: metadataURL.path))
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writeSkill(at directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try """
        ---
        name: example
        description: Example skill.
        ---
        """.write(
            to: directory.appendingPathComponent("SKILL.md"),
            atomically: true,
            encoding: .utf8
        )
    }

    private func writeProvenance(targetRoot: URL, targetName: String) throws {
        try SkillInstallProvenanceStore.write(
            catalogSkillId: "owner/repo:example",
            githubUrl: "https://github.com/owner/repo",
            skillMdSha: String(repeating: "a", count: 40),
            targetRoot: targetRoot,
            targetName: targetName
        )
    }

    private func installedSkill(at url: URL, isSymlink: Bool) -> Skill {
        Skill(
            id: "installed:\(url.path)",
            name: "example",
            description: "Example skill.",
            githubUrl: "",
            installCmd: url.path,
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
            origin: "Codex",
            isSymlink: isSymlink,
            isLocalOnly: false
        )
    }
}
