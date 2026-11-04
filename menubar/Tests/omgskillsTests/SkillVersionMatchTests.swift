import Foundation
import Testing
@testable import omgskills

@MainActor
struct SkillVersionMatchTests {
    private func copy(_ name: String, _ origin: String, sha: String?, path: String? = nil) -> Skill {
        Skill(id: "\(origin):\(name)", name: name, description: "", githubUrl: "",
            installCmd: path ?? "/Users/me/.\(origin.lowercased())/skills/\(name)", authorHandle: "", tags: [],
            readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: sha, installs: nil,
            trendingRank: nil, trendingSource: nil, origin: origin, isSymlink: false, isLocalOnly: true)
    }

    @Test func acceptsOnlyOneNamedSkill() {
        #expect(SkillVersionMatch.name(from: URL(string: "omgskills://match?name=humanizer")!) == "humanizer")
        for bad in ["omgskills://match", "omgskills://match?name=", "omgskills://match?name=a&name=b",
                    "omgskills://remove?name=a", "omgskills://match/x?name=a", "omgskills://match?name=a%0Ab"] {
            #expect(SkillVersionMatch.name(from: URL(string: bad)!) == nil, "\(bad)")
        }
    }

    @Test func groupsCopiesByVersionNewestFirst() {
        let old = Date(timeIntervalSince1970: 1_000), new = Date(timeIntervalSince1970: 2_000)
        let all = [copy("humanizer", "Claude", sha: "aa"), copy("humanizer", "Agents", sha: "AA"),
                   copy("humanizer", "Codex", sha: "bb"), copy("humanizer", "Other", sha: nil), copy("pdf", "Codex", sha: "cc")]
        let versions = SkillVersionMatch.versions(named: "humanizer", in: all) { $0.origin == "Codex" ? old : new }
        #expect(versions.map(\.sha) == ["aa", "bb"])
        #expect(SkillRemoval.agents(versions[0].copies) == "Agents, Claude")
        #expect(SkillVersionMatchView.caption(versions[0], newest: true).hasSuffix("· newest"))
    }

    @Test func asksFirstThenReplacesOnlyTheOtherCopies() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        func folder(_ agent: String, _ text: String) throws -> String {
            let dir = root.appendingPathComponent("\(agent)/humanizer")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try text.write(to: dir.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
            return dir.path
        }
        let claude = copy("humanizer", "Claude", sha: "new", path: try folder("claude", "new"))
        let codex = copy("humanizer", "Codex", sha: "old", path: try folder("codex", "old"))
        var trashed: [String] = [], changed = 0
        let match = SkillVersionMatchController(installations: { [claude, codex] }, trash: { skill in
            trashed.append(skill.origin!)
            try FileManager.default.removeItem(atPath: skill.installCmd)
        })
        match.onChanged = { changed += 1 }
        #expect(match.receive(URL(string: "omgskills://match?name=humanizer")!))
        guard case .choose(_, let versions) = match.state else { Issue.record("expected a choice"); return }
        #expect(versions.count == 2 && trashed.isEmpty, "A link alone changes nothing")
        match.selected = "new"
        match.confirm()
        #expect(trashed == ["Codex"])
        #expect(try String(contentsOfFile: codex.installCmd + "/SKILL.md", encoding: .utf8) == "new")
        #expect(try String(contentsOfFile: claude.installCmd + "/SKILL.md", encoding: .utf8) == "new")
        #expect(changed == 1)
        guard case .done = match.state else { Issue.record("expected done"); return }
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("codex").path)
        #expect(leftovers == ["humanizer"], "No staged copy left behind")
    }

    @Test func aFailedTrashKeepsTheOldCopyAndLeavesNothingStaged() throws {
        struct Blocked: Error {}
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("claude/humanizer"), target = root.appendingPathComponent("codex/humanizer")
        for (dir, text) in [(source, "new"), (target, "old")] {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try text.write(to: dir.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        }
        #expect(throws: Blocked.self) {
            try SkillVersionMatch.replace(copy("humanizer", "Codex", sha: "old", path: target.path), with: source) { _ in throw Blocked() }
        }
        #expect(try String(contentsOf: target.appendingPathComponent("SKILL.md"), encoding: .utf8) == "old")
        #expect(try FileManager.default.contentsOfDirectory(atPath: target.deletingLastPathComponent().path) == ["humanizer"])
    }

    @Test func oneVersionOrNoneSaysSo() {
        let same = SkillVersionMatchController(installations: { [self] in
            [copy("pdf", "Claude", sha: "aa"), copy("pdf", "Codex", sha: "aa")] }, trash: { _ in })
        _ = same.receive(URL(string: "omgskills://match?name=pdf")!)
        #expect(same.state == .alreadyMatching(name: "pdf"))
        _ = same.receive(URL(string: "omgskills://match?name=gone")!)
        #expect(same.state == .notFound(name: "gone"))
        #expect(!same.receive(URL(string: "omgskills://remove?name=pdf")!))
    }
}
