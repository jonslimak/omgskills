import Foundation

struct SkillFilesystemPaths: Equatable, Sendable {
    let homeDirectory: URL
    let legacyRepoCacheRoot: URL

    var claudeSkillsRoot: URL {
        homeDirectory.appendingPathComponent(".claude/skills", isDirectory: true)
    }

    var codexSkillsRoot: URL {
        homeDirectory.appendingPathComponent(".codex/skills", isDirectory: true)
    }

    var agentsSkillsRoot: URL {
        homeDirectory.appendingPathComponent(".agents/skills", isDirectory: true)
    }

    var allSkillsRoots: [URL] {
        [claudeSkillsRoot, codexSkillsRoot, agentsSkillsRoot]
    }

    func skillsRoot(for target: SkillInstaller.Target) -> URL {
        switch target {
        case .claude: return claudeSkillsRoot
        case .codex: return codexSkillsRoot
        }
    }

    static func production(fileManager: FileManager = .default) -> SkillFilesystemPaths {
        SkillFilesystemPaths(
            homeDirectory: fileManager.homeDirectoryForCurrentUser,
            legacyRepoCacheRoot: fileManager.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            )[0].appendingPathComponent("omgskills/repos", isDirectory: true)
        )
    }

    static func isolated(testRoot: URL) -> SkillFilesystemPaths {
        SkillFilesystemPaths(
            homeDirectory: testRoot.appendingPathComponent("home", isDirectory: true),
            legacyRepoCacheRoot: testRoot.appendingPathComponent("legacy-repos", isDirectory: true)
        )
    }
}
