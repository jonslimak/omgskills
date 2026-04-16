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

        return Skill(
            id: "installed:\(dir.path)",
            name: name,
            description: description,
            githubUrl: "",
            installCmd: dir.path,  // Installed skills: installCmd holds the local folder path.
            authorHandle: "",
            tags: tags,
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: iso.string(from: mod),
            firstSeen: "",
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

    private static func normalize(_ s: String) -> String {
        s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
