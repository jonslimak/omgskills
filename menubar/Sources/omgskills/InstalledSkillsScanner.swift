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
    }

    struct Root {
        let url: URL
        let origin: String
    }

    static func scan() -> [Skill] {
        scanWithSummary().skills
    }

    static func scanWithSummary() -> ScanResult {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        let roots: [Root] = [
            Root(url: home.appendingPathComponent(".claude/skills"), origin: "Claude"),
            Root(url: home.appendingPathComponent(".codex/skills"), origin: "Codex"),
            Root(url: home.appendingPathComponent(".agents/skills"), origin: "Agents"),
        ]
        return scan(roots: roots)
    }

    static func scan(roots: [Root]) -> ScanResult {
        let fm = FileManager.default
        var seen = Set<String>()
        var skills: [Skill] = []
        var installations: [Skill] = []
        var summary = InstalledSkillSummary()
        var recent: [InstalledSkillSummary.RecentSkill] = []

        for root in roots {
            guard let entries = try? fm.contentsOfDirectory(
                at: root.url,
                includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles]
            ) else { continue }

            for entry in entries {
                let skillMd = entry.appendingPathComponent("SKILL.md")
                guard fm.fileExists(atPath: skillMd.path) else { continue }
                let isSymlink = (try? entry.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) ?? false
                let provenance = SkillInstallProvenanceStore.read(
                    targetRoot: root.url,
                    targetName: entry.lastPathComponent
                )
                guard let skill = parse(skillMd: skillMd, dir: entry, origin: root.origin, isSymlink: isSymlink, provenance: provenance) else { continue }

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
        return ScanResult(skills: skills, installations: installations, summary: summary)
    }

    private static func parse(skillMd: URL, dir: URL, origin: String, isSymlink: Bool, provenance: SkillInstallProvenance?) -> Skill? {
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

        let gitLocation = resolveGitLocation(dir: dir)
        let githubUrl = gitLocation?.githubURL ?? ""
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

    private static func resolveGitLocation(dir: URL) -> GitLocation? {
        let resolved = dir.resolvingSymlinksInPath()
        guard let gitRoot = enclosingGitRoot(from: resolved) else { return nil }
        let gitConfig = gitRoot.appendingPathComponent(".git/config")
        guard let content = try? String(contentsOf: gitConfig, encoding: .utf8) else { return nil }
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

    private static func enclosingGitRoot(from directory: URL) -> URL? {
        var current = directory
        let fm = FileManager.default
        for _ in 0..<64 {
            if fm.fileExists(atPath: current.appendingPathComponent(".git/config").path) {
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
