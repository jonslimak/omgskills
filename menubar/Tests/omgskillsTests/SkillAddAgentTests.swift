import Foundation
import Testing
@testable import omgskills

@MainActor
struct SkillAddAgentTests {
    private func copy(_ name: String, _ origin: String, sha: String? = "aa", path: String? = nil) -> Skill {
        Skill(id: "\(origin):\(name)", name: name, description: "", githubUrl: "",
            installCmd: path ?? "/Users/me/.\(origin.lowercased())/skills/\(name)", authorHandle: "", tags: [],
            readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: sha, installs: nil,
            trendingRank: nil, trendingSource: nil, origin: origin, isSymlink: false, isLocalOnly: true)
    }

    @Test func acceptsOnlyOneNamedSkill() {
        #expect(SkillAddAgent.name(from: URL(string: "omgskills://add-agent?name=notes")!) == "notes")
        for bad in ["omgskills://add-agent", "omgskills://add-agent?name=", "omgskills://add-agent?name=a&name=b",
                    "omgskills://add-agent?to=codex", "omgskills://add-agent/x?name=a", "omgskills://add-agent?name=a%0Ab",
                    "omgskills://match?name=a"] {
            #expect(SkillAddAgent.name(from: URL(string: bad)!) == nil, "\(bad)")
        }
    }

    @Test func offersOnlyTheMissingAgentsAndLinksTheNewestCopy() {
        #expect(SkillAddAgent.missing([copy("notes", "Claude")]) == [.codex])
        #expect(SkillAddAgent.missing([copy("notes", "Agents")]) == [.claude, .codex])
        #expect(SkillAddAgent.missing([copy("notes", "Claude"), copy("notes", "Codex")]).isEmpty)
        let old = copy("notes", "Claude"), new = copy("notes", "Agents"), unreadable = copy("notes", "Codex", sha: nil)
        let picked = SkillAddAgent.source([old, new, unreadable]) { $0.origin == "Claude" ? Date(timeIntervalSince1970: 1) : Date(timeIntervalSince1970: 2) }
        #expect(picked?.origin == "Agents")
        #expect(SkillAddAgent.source([unreadable]) == nil)
    }

    @Test func asksFirstThenLinksTheOtherAgentsFolder() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let dir = root.appendingPathComponent("claude/notes")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try "notes".write(to: dir.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        let claude = copy("notes", "Claude", path: dir.path)
        let codexRoot = root.appendingPathComponent("codex")
        var changed = 0
        let controller = SkillAddAgentController(installations: { [claude] },
            install: { skill, _ in try LocalSkillCrossInstaller.install(skill, targetRoot: codexRoot) })
        controller.onChanged = { changed += 1 }
        #expect(controller.receive(URL(string: "omgskills://add-agent?name=notes")!))
        #expect(controller.state == .choose(name: "notes", have: "Claude", targets: [.codex]))
        #expect(!FileManager.default.fileExists(atPath: codexRoot.path), "A link alone changes nothing")
        await controller.add(to: .claude)
        #expect(!FileManager.default.fileExists(atPath: codexRoot.path), "Never adds to an agent that has it")
        await controller.add(to: .codex)
        #expect(try String(contentsOf: codexRoot.appendingPathComponent("notes/SKILL.md"), encoding: .utf8) == "notes")
        #expect(changed == 1)
        #expect(controller.state == .done(name: "notes", message: "Added to Codex."))
    }

    @Test func refusesAFolderAlreadyThereAndUnknownSkills() async throws {
        let controller = SkillAddAgentController(installations: { [] }, install: { _, _ in .installed })
        _ = controller.receive(URL(string: "omgskills://add-agent?name=ghost")!)
        #expect(controller.state == .notFound(name: "ghost"))
        let both = SkillAddAgentController(installations: { [self.copy("pdf", "Claude"), self.copy("pdf", "Codex")] },
            install: { _, _ in .installed })
        _ = both.receive(URL(string: "omgskills://add-agent?name=pdf")!)
        #expect(both.state == .everywhere(name: "pdf"))
        // A Codex folder linked to ~/.agents: its copy dedupes away by location but Codex still has the skill.
        let linked = SkillAddAgentController(installations: { [self.copy("pdf", "Agents", path: "/x/pdf"),
            self.copy("pdf", "Codex", path: "/x/pdf"), self.copy("pdf", "Claude")] }, install: { _, _ in .installed })
        _ = linked.receive(URL(string: "omgskills://add-agent?name=pdf")!)
        #expect(linked.state == .everywhere(name: "pdf"))
        let occupied = SkillAddAgentController(installations: { [self.copy("pdf", "Claude")] }, install: { _, _ in .alreadyInstalled })
        _ = occupied.receive(URL(string: "omgskills://add-agent?name=pdf")!)
        await occupied.add(to: .codex)
        #expect(occupied.state == .failed(message: "Codex already has a folder named pdf. Nothing was changed."))
        let taken = SkillAddAgentController(installations: { [self.copy("pdf", "Claude")] },
            install: { _, _ in throw LocalSkillCrossInstaller.InstallError.targetExists })
        _ = taken.receive(URL(string: "omgskills://add-agent?name=pdf")!)
        await taken.add(to: .codex)
        #expect(taken.state == .failed(message: "Codex already has a folder named pdf. Nothing was changed."))
    }
}
