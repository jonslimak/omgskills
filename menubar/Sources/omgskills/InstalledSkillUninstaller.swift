import Foundation

enum InstalledSkillUninstaller {
    struct Result: Equatable {
        let provenanceRemoved: Bool
        let provenanceCleanupWarning: String?
    }

    enum UninstallError: LocalizedError, Equatable {
        case unexpectedSkillPath

        var errorDescription: String? {
            "Delete blocked: unexpected skill path"
        }
    }

    static var defaultAllowedRoots: [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return [
            home.appendingPathComponent(".codex/skills", isDirectory: true),
            home.appendingPathComponent(".claude/skills", isDirectory: true),
            home.appendingPathComponent(".agents/skills", isDirectory: true)
        ]
    }

    static func uninstall(
        _ skill: Skill,
        allowedRoots: [URL] = defaultAllowedRoots,
        fileManager: FileManager = .default,
        trashItem: ((URL) throws -> Void)? = nil
    ) throws -> Result {
        let installationURL = URL(fileURLWithPath: skill.installCmd, isDirectory: true)
        guard let targetRoot = allowedRoot(
            containing: installationURL,
            allowedRoots: allowedRoots
        ) else {
            throw UninstallError.unexpectedSkillPath
        }

        let isSymlink = skill.isSymlink == true ||
            ((try? installationURL.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) ?? false)
        if isSymlink {
            try fileManager.removeItem(at: installationURL)
        } else if let trashItem {
            try trashItem(installationURL)
        } else {
            var trashedURL: NSURL?
            try fileManager.trashItem(at: installationURL, resultingItemURL: &trashedURL)
        }

        do {
            let removed = try SkillInstallProvenanceStore.removeIfOrphaned(
                targetRoot: targetRoot,
                targetName: installationURL.lastPathComponent,
                installationURL: installationURL,
                fileManager: fileManager
            )
            return Result(provenanceRemoved: removed, provenanceCleanupWarning: nil)
        } catch {
            return Result(
                provenanceRemoved: false,
                provenanceCleanupWarning: "Skill removed, but install metadata could not be cleaned up: \(error.localizedDescription)"
            )
        }
    }

    private static func allowedRoot(containing installationURL: URL, allowedRoots: [URL]) -> URL? {
        let path = installationURL.standardizedFileURL.path
        return allowedRoots.first { root in
            path.hasPrefix(root.standardizedFileURL.path + "/")
        }
    }
}
