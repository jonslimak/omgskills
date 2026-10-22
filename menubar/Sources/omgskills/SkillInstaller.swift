import Foundation

enum SkillInstaller {
    enum Target: String, Equatable, Sendable {
        case claude = "Claude"
        case codex = "Codex"

        var skillsRoot: URL {
            SkillFilesystemPaths.production().skillsRoot(for: self)
        }
    }

    enum InstallResult: Equatable, Sendable {
        case installed
        case alreadyInstalled
    }

    struct InstallationSpec: Equatable, Sendable {
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
        case destinationConflict
        case cleanupFailed(String)

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
            case .destinationConflict:
                return "Another skill or record already uses this destination"
            case .cleanupFailed(let path):
                return "Installation failed and cleanup was incomplete at \(path)"
            }
        }
    }

    static func isInstalled(
        _ skill: Skill,
        target: Target,
        filesystemPaths: SkillFilesystemPaths = .production()
    ) -> Bool {
        guard let spec = try? installationSpec(for: skill) else { return false }
        return FileManager.default.fileExists(
            atPath: filesystemPaths.skillsRoot(for: target)
                .appendingPathComponent(spec.targetName)
                .appendingPathComponent("SKILL.md").path
        )
    }

    static func install(
        _ skill: Skill,
        target: Target,
        filesystemPaths: SkillFilesystemPaths = .production(),
        policy: SkillInstallPolicy = .existingBehavior,
        gitRunner: (any GitCommandRunning)? = nil,
        writeNewRecord: @Sendable (Skill, URL, String, String) throws -> Void = { skill, root, name, sha in
            try SkillInstallProvenanceStore.writeNew(catalogSkillId: skill.id, githubUrl: skill.githubUrl,
                skillMdSha: sha, targetRoot: root, targetName: name)
        }
    ) async throws -> InstallResult {
        let spec = try installationSpec(for: skill)
        let fm = FileManager.default
        let targetRoot = filesystemPaths.skillsRoot(for: target)
        let targetURL = targetRoot.appendingPathComponent(spec.targetName, isDirectory: true)
        let targetSkill = targetURL.appendingPathComponent("SKILL.md")

        if policy == .newOnly {
            try Task.checkCancellation()
            try validateNewInstallationSpec(for: skill)
            try CatalogInstallFilesystem.requireDirectoryChain(targetRoot, under: filesystemPaths.homeDirectory)
            try CatalogInstallFilesystem.requireDirectoryChain(targetRoot.appendingPathComponent(".omgskills"), under: targetRoot)
            try CatalogInstallFilesystem.requireVacant(root: targetRoot, name: spec.targetName)
        } else if fm.fileExists(atPath: targetSkill.path) {
            if let skillMdSha = try? SkillInstallProvenanceStore.skillMdSha(at: targetSkill) {
                try? SkillInstallProvenanceStore.write(
                    catalogSkillId: skill.id,
                    githubUrl: skill.githubUrl,
                    skillMdSha: skillMdSha,
                    targetRoot: targetRoot,
                    targetName: spec.targetName
                )
            }
            return .alreadyInstalled
        }

        try fm.createDirectory(at: targetRoot, withIntermediateDirectories: true)
        if policy == .newOnly {
            try CatalogInstallFilesystem.requireDirectoryChain(filesystemPaths.legacyRepoCacheRoot,
                under: filesystemPaths.legacyRepoCacheRoot.deletingLastPathComponent())
        }
        try fm.createDirectory(at: filesystemPaths.legacyRepoCacheRoot, withIntermediateDirectories: true)

        let repoDir = filesystemPaths.legacyRepoCacheRoot
            .appendingPathComponent(spec.repoCacheName, isDirectory: true)
        if policy == .newOnly {
            let runner: any GitCommandRunning
            if let gitRunner { runner = gitRunner } else { runner = try await usableGitRunner() }
            try CatalogInstallFilesystem.requireDirectoryChain(repoDir, under: filesystemPaths.legacyRepoCacheRoot)
            if !CatalogInstallFilesystem.exists(repoDir) {
                try fm.createDirectory(at: repoDir, withIntermediateDirectories: false)
                let identity = try CatalogInstallFilesystem.identity(repoDir)
                do {
                    _ = try await runner.run(arguments: ["clone", spec.repoURL, repoDir.path], maximumOutputBytes: 1024 * 1024)
                } catch {
                    do {
                        guard try CatalogInstallFilesystem.identity(repoDir) == identity else {
                            throw InstallError.cleanupFailed(repoDir.path)
                        }
                        try fm.removeItem(at: repoDir)
                    } catch { throw InstallError.cleanupFailed(repoDir.path) }
                    throw error
                }
            } else {
                // A partial clone can have .git but no usable checkout. Never adopt it on retry.
                _ = try await runner.run(arguments: ["-C", repoDir.path, "rev-parse", "--verify", "HEAD"], maximumOutputBytes: 1024)
                let remote = try await runner.run(arguments: ["-C", repoDir.path, "config", "--get", "remote.origin.url"], maximumOutputBytes: 4096)
                guard let url = String(data: remote, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      validatedRepositorySlug(from: url)?.lowercased() == validatedRepositorySlug(from: spec.repoURL)?.lowercased() else {
                    throw InstallError.invalidGitHubURL
                }
            }
        } else if !fm.fileExists(atPath: repoDir.appendingPathComponent(".git").path) {
            let runner: any GitCommandRunning
            if let gitRunner { runner = gitRunner } else { runner = try await usableGitRunner() }
            _ = try await runner.run(arguments: ["clone", spec.repoURL, repoDir.path], maximumOutputBytes: 1024 * 1024)
        }

        let source = spec.skillRelativePath == "."
            ? repoDir
            : repoDir.appendingPathComponent(spec.skillRelativePath, isDirectory: true)

        let sourceSkill = source.appendingPathComponent("SKILL.md")
        if policy == .newOnly {
            let resolved = source.resolvingSymlinksInPath().standardizedFileURL
            let cache = repoDir.resolvingSymlinksInPath().standardizedFileURL
            guard resolved == cache || resolved.path.hasPrefix(cache.path + "/") else {
                throw InstallError.invalidInstallCommand
            }
            try CatalogInstallFilesystem.requireDirectoryChain(targetRoot, under: filesystemPaths.homeDirectory)
            try CatalogInstallFilesystem.requireVacant(root: targetRoot, name: spec.targetName)
        }
        guard fm.fileExists(atPath: sourceSkill.path) else {
            throw InstallError.missingSkillFile
        }
        let skillMdSha = try SkillInstallProvenanceStore.skillMdSha(at: sourceSkill)
        if policy == .newOnly { try Task.checkCancellation() }

        if fm.fileExists(atPath: targetURL.path) {
            throw InstallError.invalidInstallCommand
        }

        do { try fm.createSymbolicLink(at: targetURL, withDestinationURL: source) }
        catch {
            if policy == .newOnly, CatalogInstallFilesystem.exists(targetURL) { throw InstallError.destinationConflict }
            throw error
        }
        if policy == .newOnly {
            let identity = try CatalogInstallFilesystem.identity(targetURL)
            do { try writeNewRecord(skill, targetRoot, spec.targetName, skillMdSha) }
            catch {
                let originalError = error
                do {
                    guard try CatalogInstallFilesystem.identity(targetURL) == identity,
                          try fm.destinationOfSymbolicLink(atPath: targetURL.path) == source.path else {
                        throw InstallError.cleanupFailed(targetURL.path)
                    }
                    try fm.removeItem(at: targetURL)
                } catch { throw InstallError.cleanupFailed(targetURL.path) }
                throw originalError
            }
            return .installed
        }
        try SkillInstallProvenanceStore.write(
            catalogSkillId: skill.id,
            githubUrl: skill.githubUrl,
            skillMdSha: skillMdSha,
            targetRoot: targetRoot,
            targetName: spec.targetName
        )
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

    static func validateNewInstallationSpec(for skill: Skill) throws {
        let spec = try installationSpec(for: skill)
        guard validatedRepositorySlug(from: skill.githubUrl) != nil,
              spec.targetName.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]*$", options: .regularExpression) != nil,
              spec.skillRelativePath == "." || (!spec.skillRelativePath.hasPrefix("/")
                && !spec.skillRelativePath.contains("\\")
                && !spec.skillRelativePath.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
                && spec.skillRelativePath.split(separator: "/", omittingEmptySubsequences: false)
                    .allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && $0.lowercased() != ".git" }))
        else { throw InstallError.invalidInstallCommand }
    }

    static func validatedRepositorySlug(from githubURL: String) -> String? {
        guard let url = URLComponents(string: githubURL), url.scheme == "https", url.host == "github.com",
              url.user == nil, url.password == nil, url.port == nil, url.query == nil, url.fragment == nil,
              let repo = repoParts(from: githubURL) else { return nil }
        return GitHubRepositorySlug.normalized("\(repo.owner)/\(repo.name)")
    }

    static func usableGitRunner() async throws -> any GitCommandRunning {
        let url = try gitExecutableURL()
        return try await checkedGitRunner(executableURL: url, runner: GitCommandRunner(executableURL: url))
    }

    static func checkedGitRunner(executableURL url: URL, runner: any GitCommandRunning,
                                developerTools: any GitCommandRunning = GitCommandRunner(executableURL: URL(fileURLWithPath: "/usr/bin/xcode-select"))) async throws -> any GitCommandRunning {
        if url.path == "/usr/bin/git" {
            // Do not invoke Apple's install-tools prompt just to discover that Git is absent.
            do {
                let data = try await developerTools.run(arguments: ["-p"], maximumOutputBytes: 4096)
                guard let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      path.hasPrefix("/"), FileManager.default.isExecutableFile(atPath: path + "/usr/bin/git") else {
                    throw InstallError.missingGit
                }
            } catch { throw InstallError.missingGit }
        }
        do { _ = try await runner.run(arguments: ["--version"], maximumOutputBytes: 4096) }
        catch { throw InstallError.missingGit }
        return runner
    }

    static func gitExecutableURL() throws -> URL {
        for path in ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"] {
            if FileManager.default.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }
        throw InstallError.missingGit
    }
}
