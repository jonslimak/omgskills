import Foundation
import Yams

struct InstalledSkillSummary: Equatable, Sendable {
    struct RecentSkill: Identifiable, Equatable, Sendable {
        let id: String
        let name: String
        let origin: String
        let installedAt: Date
    }

    var totalInstallations = 0
    var codexCount = 0
    var claudeCount = 0
    var agentsCount = 0
    var symlinkCount = 0
    var localOnlyCount = 0
    var recentSkills: [RecentSkill] = []
}

enum InstalledSkillsScanner {
    private static let recentSkillLimit = 10

    private struct GitLocation {
        let githubURL: String
        let relativePath: String
    }

    struct ScanResult: Equatable, Sendable {
        let skills: [Skill]
        let installations: [Skill]
        let summary: InstalledSkillSummary
        var issues: [ScanIssue] = []
    }

    enum ScanIssue: Equatable, Sendable {
        case unreadableRoot(source: String)
        case skippedSkill(source: String, folder: String)
    }

    struct Root {
        let url: URL
        let origin: String
    }

    static func scan(
        filesystemPaths: SkillFilesystemPaths = .production()
    ) -> [Skill] {
        scanWithSummary(filesystemPaths: filesystemPaths).skills
    }

    static func scanWithSummary(
        filesystemPaths: SkillFilesystemPaths = .production(),
        pathAnchor: URL? = nil
    ) -> ScanResult {
        let roots: [Root] = [
            Root(url: filesystemPaths.claudeSkillsRoot, origin: "Claude"),
            Root(url: filesystemPaths.codexSkillsRoot, origin: "Codex"),
            Root(url: filesystemPaths.agentsSkillsRoot, origin: "Agents"),
        ]
        return scan(roots: roots, pathAnchor: pathAnchor)
    }

    static func scanForPresence(filesystemPaths: SkillFilesystemPaths, pathAnchor: URL? = nil) async throws -> ScanResult {
        // A child task keeps synchronous filesystem work off the UI actor.
        try await withThrowingTaskGroup(of: ScanResult.self) { group in
            group.addTask {
                try Task.checkCancellation()
                let scan = scanWithSummary(filesystemPaths: filesystemPaths, pathAnchor: pathAnchor)
                var issues = scan.issues
                let installations = scan.installations.filter { skill in
                    do {
                        _ = try SkillSyncService.presencePayloadSkill(skill)
                        return true
                    } catch {
                        issues.append(.skippedSkill(source: skill.origin ?? "Unknown",
                            folder: URL(fileURLWithPath: skill.installCmd).lastPathComponent))
                        return false
                    }
                }
                try Task.checkCancellation()
                return ScanResult(skills: scan.skills, installations: installations, summary: scan.summary, issues: issues)
            }
            return try await group.next()!
        }
    }

    static func scan(roots: [Root], pathAnchor: URL? = nil) -> ScanResult {
        let fm = FileManager.default
        var seen = Set<String>()
        var skills: [Skill] = []
        var installations: [Skill] = []
        var summary = InstalledSkillSummary()
        var recent: [InstalledSkillSummary.RecentSkill] = []
        var issues: [ScanIssue] = []

        for root in roots {
            guard isWithinPathAnchor(root.url, pathAnchor: pathAnchor) else {
                issues.append(.unreadableRoot(source: root.origin))
                continue
            }
            let entries: [URL]
            do {
                entries = try fm.contentsOfDirectory(at: root.url,
                    includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey, .contentModificationDateKey],
                    options: [.skipsHiddenFiles])
            } catch {
                let failure = error as NSError
                let isLink = (try? fm.attributesOfItem(atPath: root.url.path)[.type] as? FileAttributeType) == .typeSymbolicLink
                if fm.fileExists(atPath: root.url.path) || isLink || failure.domain != NSCocoaErrorDomain
                    || ![NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(failure.code) {
                    issues.append(.unreadableRoot(source: root.origin))
                }
                continue
            }

            for entry in entries {
                let skillMd = entry.appendingPathComponent("SKILL.md")
                if let pathAnchor {
                    guard isWithinPathAnchor(entry, pathAnchor: pathAnchor),
                          isWithinPathAnchor(skillMd, pathAnchor: pathAnchor) else {
                        issues.append(.skippedSkill(source: root.origin, folder: entry.lastPathComponent))
                        continue
                    }
                    let metadata = SkillInstallProvenanceStore.metadataURL(targetRoot: root.url, targetName: entry.lastPathComponent)
                    let managedMetadata = SkillInstallProvenanceStore.managedMetadataURL(for: entry)
                    guard isWithinPathAnchor(metadata, pathAnchor: pathAnchor),
                          managedMetadata.map({ isWithinPathAnchor($0, pathAnchor: pathAnchor) }) ?? true else {
                        issues.append(.skippedSkill(source: root.origin, folder: entry.lastPathComponent))
                        continue
                    }
                }
                let isSymlink = (try? entry.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) ?? false
                guard fm.fileExists(atPath: skillMd.path) else {
                    if isSymlink || (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                        issues.append(.skippedSkill(source: root.origin, folder: entry.lastPathComponent))
                    }
                    continue
                }
                let provenance = SkillInstallProvenanceStore.read(
                    targetRoot: root.url,
                    targetName: entry.lastPathComponent
                )
                guard let skill = parse(skillMd: skillMd, dir: entry, origin: root.origin, isSymlink: isSymlink,
                    provenance: provenance, pathAnchor: pathAnchor) else {
                    issues.append(.skippedSkill(source: root.origin, folder: entry.lastPathComponent))
                    continue
                }

                installations.append(skill)
                summary.totalInstallations += 1
                switch root.origin {
                case "Claude": summary.claudeCount += 1
                case "Codex": summary.codexCount += 1
                default: summary.agentsCount += 1
                }
                if isSymlink { summary.symlinkCount += 1 }
                if !isSymlink && skill.githubUrl.isEmpty { summary.localOnlyCount += 1 }
                if let installedAt = Self.installedAt(entry: entry, skillMd: skillMd) {
                    recent.append(InstalledSkillSummary.RecentSkill(
                        id: skill.id,
                        name: skill.name,
                        origin: root.origin,
                        installedAt: installedAt
                    ))
                }

                let resolved = skillMd.resolvingSymlinksInPath().path
                if seen.contains(resolved) { continue }
                seen.insert(resolved)
                skills.append(skill)
            }
        }

        summary.recentSkills = Array(recent.sorted { $0.installedAt > $1.installedAt }.prefix(recentSkillLimit))
        return ScanResult(skills: skills, installations: installations, summary: summary, issues: issues)
    }

    private static func parse(skillMd: URL, dir: URL, origin: String, isSymlink: Bool,
                              provenance: SkillInstallProvenance?, pathAnchor: URL?) -> Skill? {
        guard let data = try? Data(contentsOf: skillMd),
              let content = String(data: data, encoding: .utf8) else { return nil }
        guard let fm = parseFrontmatter(content) else { return nil }
        guard let name = (fm["name"] as? String).map(normalize), !name.isEmpty,
              let rawDesc = fm["description"] as? String else { return nil }

        let description = normalize(rawDesc)
        let tags: [String]
        if let arr = fm["tags"] as? [String] {
            tags = arr
        } else if let str = fm["tags"] as? String {
            tags = str.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        } else {
            tags = []
        }

        let mod = modifiedAt(skillMd: skillMd) ?? Date()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]

        let gitLocation = resolveGitLocation(dir: dir, pathAnchor: pathAnchor)
        let githubUrl = provenance?.githubUrl ?? gitLocation?.githubURL ?? ""
        let authorHandle = githubUrl.split(separator: "/").dropLast().last.map(String.init) ?? ""
        let isLocalOnly = !isSymlink && githubUrl.isEmpty

        return Skill(
            id: "installed:\(dir.path)",
            name: name,
            description: description,
            githubUrl: githubUrl,
            installCmd: dir.path,
            authorHandle: authorHandle,
            tags: tags,
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: iso.string(from: mod),
            firstSeen: "",
            skillMdSha: SkillIdentityResolver.gitBlobSHA(for: data),
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: origin,
            isSymlink: isSymlink,
            isLocalOnly: isLocalOnly,
            gitRelativePath: gitLocation?.relativePath,
            catalogSkillId: provenance?.catalogSkillId
        )
    }

    private static func parseFrontmatter(_ content: String) -> [String: Any]? {
        guard content.hasPrefix("---") else { return nil }
        let after = content.dropFirst(3)
        guard let endRange = after.range(of: "\n---") else { return nil }
        let block = String(after[..<endRange.lowerBound])
        return (try? Yams.load(yaml: block)) as? [String: Any]
    }

    private static func resolveGitLocation(dir: URL, pathAnchor: URL?) -> GitLocation? {
        let resolved = dir.resolvingSymlinksInPath()
        guard let gitRoot = enclosingGitRoot(from: resolved, pathAnchor: pathAnchor) else { return nil }
        let gitConfig = gitRoot.appendingPathComponent(".git/config")
        guard isWithinPathAnchor(gitConfig, pathAnchor: pathAnchor),
              let content = try? String(contentsOf: gitConfig, encoding: .utf8) else { return nil }
        for line in content.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("url = ") else { continue }
            var url = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            if url.hasPrefix("git@github.com:") {
                url = url.replacingOccurrences(of: "git@github.com:", with: "https://github.com/")
            }
            if url.hasSuffix(".git") { url = String(url.dropLast(4)) }
            if url.contains("github.com"),
               let relativePath = relativePath(from: gitRoot, to: resolved) {
                return GitLocation(githubURL: url, relativePath: relativePath)
            }
        }
        return nil
    }

    private static func relativePath(from root: URL, to directory: URL) -> String? {
        let rootComponents = root.standardizedFileURL.pathComponents
        let directoryComponents = directory.standardizedFileURL.pathComponents
        guard directoryComponents.count >= rootComponents.count,
              Array(directoryComponents.prefix(rootComponents.count)) == rootComponents else {
            return nil
        }

        let relativeComponents = directoryComponents.dropFirst(rootComponents.count)
        return relativeComponents.isEmpty ? "." : relativeComponents.joined(separator: "/")
    }

    private static func enclosingGitRoot(from directory: URL, pathAnchor: URL?) -> URL? {
        var current = directory
        let fm = FileManager.default
        for _ in 0..<64 {
            guard isWithinPathAnchor(current, pathAnchor: pathAnchor) else { return nil }
            let config = current.appendingPathComponent(".git/config")
            guard isWithinPathAnchor(config, pathAnchor: pathAnchor) else { return nil }
            if fm.fileExists(atPath: config.path) {
                return current
            }
            let parent = current.deletingLastPathComponent()
            if parent.path == current.path {
                return nil
            }
            current = parent
        }
        return nil
    }

    private static func isWithinPathAnchor(_ url: URL, pathAnchor: URL?) -> Bool {
        guard let pathAnchor else { return true }
        // Keep the validated anchor fixed: resolving it anew could trust a redirected test root.
        let anchor = pathAnchor.standardizedFileURL
        guard anchor.resolvingSymlinksInPath().path == anchor.path,
              (try? anchor.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { return false }
        return relativePath(from: anchor, to: url.resolvingSymlinksInPath()) != nil
    }

    private static func normalize(_ s: String) -> String {
        s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func modifiedAt(skillMd: URL) -> Date? {
        try? skillMd.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
    }

    private static func installedAt(entry: URL, skillMd: URL) -> Date? {
        let creationDate = try? entry.resourceValues(forKeys: [.creationDateKey]).creationDate
        return creationDate ?? modifiedAt(skillMd: skillMd)
    }
}
