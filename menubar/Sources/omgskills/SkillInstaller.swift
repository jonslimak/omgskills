import Foundation

enum SkillInstaller {
    enum Target: String, Equatable {
        case claude = "Claude"
        case codex = "Codex"

        var skillsRoot: URL {
            let home = FileManager.default.homeDirectoryForCurrentUser
            switch self {
            case .claude: return home.appendingPathComponent(".claude/skills", isDirectory: true)
            case .codex: return home.appendingPathComponent(".codex/skills", isDirectory: true)
            }
        }
    }

    enum InstallResult: Equatable {
        case installed
        case alreadyInstalled
    }

    struct InstallationSpec: Equatable {
        let repoURL: String
        let repoCacheName: String
        let skillRelativePath: String
        let targetName: String
    }

    enum InstallError: LocalizedError, Equatable {
        case invalidGitHubURL
        case invalidInstallCommand
        case missingGit
        case processFailed(String)
        case missingSkillFile

        var errorDescription: String? {
            switch self {
            case .invalidGitHubURL:
                return "Invalid GitHub URL"
            case .invalidInstallCommand:
                return "Could not read install path"
            case .missingGit:
                return "Git is not available"
            case .processFailed(let message):
                return message.isEmpty ? "Install failed" : message
            case .missingSkillFile:
                return "Installed repo has no SKILL.md"
            }
        }
    }

    static func isInstalled(_ skill: Skill, target: Target) -> Bool {
        guard let spec = try? installationSpec(for: skill) else { return false }
        return FileManager.default.fileExists(atPath: target.skillsRoot.appendingPathComponent(spec.targetName).appendingPathComponent("SKILL.md").path)
    }

    static func install(_ skill: Skill, target: Target) async throws -> InstallResult {
        let spec = try installationSpec(for: skill)
        let fm = FileManager.default
        let targetRoot = target.skillsRoot
        let targetURL = targetRoot.appendingPathComponent(spec.targetName, isDirectory: true)
        let targetSkill = targetURL.appendingPathComponent("SKILL.md")

        if fm.fileExists(atPath: targetSkill.path) {
            return .alreadyInstalled
        }

        try fm.createDirectory(at: targetRoot, withIntermediateDirectories: true)
        try fm.createDirectory(at: repoCacheRoot, withIntermediateDirectories: true)

        let repoDir = repoCacheRoot.appendingPathComponent(spec.repoCacheName, isDirectory: true)
        if !fm.fileExists(atPath: repoDir.appendingPathComponent(".git").path) {
            try await runGit(["clone", spec.repoURL, repoDir.path])
        }

        let source = spec.skillRelativePath == "."
            ? repoDir
            : repoDir.appendingPathComponent(spec.skillRelativePath, isDirectory: true)

        guard fm.fileExists(atPath: source.appendingPathComponent("SKILL.md").path) else {
            throw InstallError.missingSkillFile
        }

        if fm.fileExists(atPath: targetURL.path) {
            throw InstallError.invalidInstallCommand
        }

        try fm.createSymbolicLink(at: targetURL, withDestinationURL: source)
        return .installed
    }

    static func installationSpec(for skill: Skill) throws -> InstallationSpec {
        guard let repo = repoParts(from: skill.githubUrl) else {
            throw InstallError.invalidGitHubURL
        }

        guard let targetName = targetName(from: skill.installCmd) else {
            throw InstallError.invalidInstallCommand
        }

        return InstallationSpec(
            repoURL: "https://github.com/\(repo.owner)/\(repo.name)",
            repoCacheName: "\(repo.owner)--\(repo.name)",
            skillRelativePath: skillRelativePath(from: skill.installCmd, repoName: repo.name),
            targetName: targetName
        )
    }

    private static var repoCacheRoot: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("omgskills/repos", isDirectory: true)
    }

    private static func repoParts(from githubURL: String) -> (owner: String, name: String)? {
        guard let url = URL(string: githubURL) else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count >= 2 else { return nil }
        let owner = parts[0]
        var name = parts[1]
        if name.hasSuffix(".git") { name.removeLast(4) }
        return owner.isEmpty || name.isEmpty ? nil : (owner, name)
    }

    private static func targetName(from installCmd: String) -> String? {
        let marker = "~/.claude/skills/"
        guard let range = installCmd.range(of: marker) else { return nil }
        let tail = installCmd[range.upperBound...]
        let raw = tail.split(whereSeparator: { $0.isWhitespace || $0 == "'" || $0 == "\"" }).first
        return raw.map(String.init).flatMap { $0.isEmpty ? nil : $0 }
    }

    private static func skillRelativePath(from installCmd: String, repoName: String) -> String {
        let marker = "/tmp/\(repoName)/"
        guard let start = installCmd.range(of: marker) else { return "." }
        let tail = installCmd[start.upperBound...]
        guard let raw = tail.split(whereSeparator: { $0.isWhitespace }).first else { return "." }
        let path = String(raw).trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        return path.isEmpty ? "." : path
    }

    private static func runGit(_ arguments: [String]) async throws {
        let gitURL = try gitExecutableURL()
        let process = Process()
        process.executableURL = gitURL
        process.arguments = arguments

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            throw InstallError.processFailed(error.localizedDescription)
        }

        guard process.terminationStatus == 0 else {
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? ""
            throw InstallError.processFailed(output.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    private static func gitExecutableURL() throws -> URL {
        for path in ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"] {
            if FileManager.default.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }
        throw InstallError.missingGit
    }
}
