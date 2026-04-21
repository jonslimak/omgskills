import Foundation
import Yams

enum InstalledSkillsScanner {
    private struct Root {
        let url: URL
        let origin: String
    }

    static func scan() -> [Skill] {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        let roots: [Root] = [
            Root(url: home.appendingPathComponent(".claude/skills"), origin: "Claude"),
            Root(url: home.appendingPathComponent(".codex/skills"), origin: "Codex"),
            Root(url: home.appendingPathComponent(".agents/skills"), origin: "Agents"),
        ]

        var seen = Set<String>()
        var skills: [Skill] = []

        for root in roots {
            guard let entries = try? fm.contentsOfDirectory(
                at: root.url,
                includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles]
            ) else { continue }

            for entry in entries {
                let skillMd = entry.appendingPathComponent("SKILL.md")
                guard fm.fileExists(atPath: skillMd.path) else { continue }

                let resolved = skillMd.resolvingSymlinksInPath().path
                if seen.contains(resolved) { continue }
                seen.insert(resolved)

                if let skill = parse(skillMd: skillMd, dir: entry, origin: root.origin) {
                    skills.append(skill)
                }
            }
        }

        return skills
    }

    private static func parse(skillMd: URL, dir: URL, origin: String) -> Skill? {
        guard let content = try? String(contentsOf: skillMd, encoding: .utf8) else { return nil }
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

        let mod = (try? skillMd.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]

        let githubUrl = resolveGithubUrl(dir: dir)
        let authorHandle = githubUrl.split(separator: "/").dropLast().last.map(String.init) ?? ""

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
            skillMdSha: nil,
            origin: origin
        )
    }

    private static func parseFrontmatter(_ content: String) -> [String: Any]? {
        guard content.hasPrefix("---") else { return nil }
        let after = content.dropFirst(3)
        guard let endRange = after.range(of: "\n---") else { return nil }
        let block = String(after[..<endRange.lowerBound])
        return (try? Yams.load(yaml: block)) as? [String: Any]
    }

    private static func resolveGithubUrl(dir: URL) -> String {
        let resolved = dir.resolvingSymlinksInPath()
        let gitConfig = resolved.appendingPathComponent(".git/config")
        guard let content = try? String(contentsOf: gitConfig, encoding: .utf8) else { return "" }
        for line in content.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("url = ") else { continue }
            var url = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            if url.hasPrefix("git@github.com:") {
                url = url.replacingOccurrences(of: "git@github.com:", with: "https://github.com/")
            }
            if url.hasSuffix(".git") { url = String(url.dropLast(4)) }
            if url.contains("github.com") { return url }
        }
        return ""
    }

    private static func normalize(_ s: String) -> String {
        s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
