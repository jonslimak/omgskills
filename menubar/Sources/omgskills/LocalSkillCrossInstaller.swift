import Foundation

enum LocalSkillCrossInstaller {
    enum InstallResult: Equatable {
        case installed
        case alreadyInstalled
    }

    enum InstallError: LocalizedError, Equatable {
        case missingSourceSkill
        case targetExists

        var errorDescription: String? {
            switch self {
            case .missingSourceSkill:
                return "Local skill is missing SKILL.md"
            case .targetExists:
                return "Skill already exists at target"
            }
        }
    }

    static func install(_ skill: Skill, target: SkillInstaller.Target) throws -> InstallResult {
        try install(skill, targetRoot: target.skillsRoot)
    }

    static func install(_ skill: Skill, targetRoot: URL) throws -> InstallResult {
        let fm = FileManager.default
        let sourceInstallURL = URL(fileURLWithPath: skill.installCmd, isDirectory: true)
        guard fm.fileExists(atPath: sourceInstallURL.appendingPathComponent("SKILL.md").path) else {
            throw InstallError.missingSourceSkill
        }

        let sourceURL = sourceInstallURL.resolvingSymlinksInPath()
        guard fm.fileExists(atPath: sourceURL.appendingPathComponent("SKILL.md").path) else {
            throw InstallError.missingSourceSkill
        }

        let targetURL = targetRoot.appendingPathComponent(sourceInstallURL.lastPathComponent, isDirectory: true)
        if fm.fileExists(atPath: targetURL.appendingPathComponent("SKILL.md").path) {
            return .alreadyInstalled
        }
        if fm.fileExists(atPath: targetURL.path) {
            throw InstallError.targetExists
        }

        try fm.createDirectory(at: targetRoot, withIntermediateDirectories: true)
        try fm.createSymbolicLink(at: targetURL, withDestinationURL: sourceURL)
        return .installed
    }
}
