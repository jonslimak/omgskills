import Foundation
import Testing
@testable import omgskills

@MainActor
struct SkillRemovalTests {
    private func copy(_ name: String, _ origin: String, link: Bool = false) -> Skill {
        Skill(id: "installed:\(origin):\(name)", name: name, description: "", githubUrl: "",
            installCmd: "/Users/me/.\(origin.lowercased())/skills/\(name)", authorHandle: "", tags: [],
            readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: nil, installs: nil,
            trendingRank: nil, trendingSource: nil, origin: origin, isSymlink: link, isLocalOnly: true)
    }

    @Test func acceptsOneOrMoreNamedSkills() {
        #expect(SkillRemoval.names(from: URL(string: "omgskills://remove?name=humanizer")!) == ["humanizer"])
        #expect(SkillRemoval.names(from: URL(string: "omgskills://remove?name=ship%20it")!) == ["ship it"])
        #expect(SkillRemoval.names(from: URL(string: "omgskills://remove?name=a&name=b&name=A")!) == ["a", "b"])
        let tooMany = (0...SkillRemoval.maximumSkills).map { "name=s\($0)" }.joined(separator: "&")
        for bad in ["omgskills://remove", "omgskills://remove?name=", "omgskills://remove?name=a&name=",
                    "omgskills://remove?name=a&skill=b", "omgskills://remove?" + tooMany,
                    "omgskills://remove/x?name=a", "omgskills://install?name=a", "https://remove?name=a",
                    "omgskills://remove?name=a%0Ab", "omgskills://remove?skill=a"] {
            #expect(SkillRemoval.names(from: URL(string: bad)!) == nil, "\(bad)")
        }
    }

    @Test func findsEveryCopyByNameLinksFirst() {
        let all = [copy("Humanizer", "Agents"), copy("humanizer", "Claude", link: true),
                   copy("humanizer", "Codex"), copy("other", "Claude")]
        let found = SkillRemoval.copies(named: [" HUMANIZER "], in: all)
        #expect(found.map(\.origin) == ["Claude", "Agents", "Codex"])
        #expect(SkillRemoval.agents(found) == "Agents, Claude, Codex")
    }

    @Test func asksFirstThenTrashesEveryCopy() {
        var trashed: [String] = [], reported = 0
        let removal = SkillRemovalController(
            installations: { [self] in [copy("humanizer", "Claude"), copy("humanizer", "Codex"), copy("pdf", "Codex")] },
            trash: { trashed.append($0.origin!); return .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        removal.onRemoved = { reported += 1 }
        #expect(removal.receive(URL(string: "omgskills://remove?name=humanizer")!))
        guard case .confirm(_, let copies, _) = removal.state else { Issue.record("expected confirmation"); return }
        #expect(copies.count == 2 && trashed.isEmpty, "A link alone never deletes")
        removal.confirm()
        #expect(trashed.sorted() == ["Claude", "Codex"])
        #expect(reported == 1)
        guard case .done = removal.state else { Issue.record("expected done"); return }
        removal.close()
        #expect(!removal.isActive)
    }

    @Test func reportsMissingInvalidAndPartialFailures() throws {
        struct Blocked: Error {}
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let codex = root.appendingPathComponent("codex/humanizer")
        try FileManager.default.createDirectory(at: codex, withIntermediateDirectories: true)
        let codexCopy = Skill(id: "c", name: "humanizer", description: "", githubUrl: "", installCmd: codex.path,
            authorHandle: "", tags: [], readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: nil,
            installs: nil, trendingRank: nil, trendingSource: nil, origin: "Codex", isSymlink: false, isLocalOnly: true)
        let removal = SkillRemovalController(
            installations: { [self] in [copy("humanizer", "Claude"), codexCopy] },
            trash: { if $0.origin == "Codex" { throw Blocked() }; return .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        #expect(removal.receive(URL(string: "omgskills://remove?name=pdf")!))
        #expect(removal.state == .notFound(names: ["pdf"]))
        removal.close()
        #expect(removal.receive(URL(string: "omgskills://remove?name=")!))
        guard case .failed = removal.state else { Issue.record("expected invalid"); return }
        removal.close()
        #expect(!removal.receive(URL(string: "omgskills://install?id=x")!))
        _ = removal.receive(URL(string: "omgskills://remove?name=humanizer")!)
        removal.confirm()
        #expect(removal.state == .failed(message: "Couldn't delete 1 copy (Codex). Other copies were moved to the Trash."))
    }

    @Test func aNewerLinkReplacesAnOpenQuestion() {
        let removal = SkillRemovalController(installations: { [self] in [copy("a", "Claude"), copy("b", "Codex")] },
            trash: { _ in .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        _ = removal.receive(URL(string: "omgskills://remove?name=a")!)
        _ = removal.receive(URL(string: "omgskills://remove?name=b")!)
        guard case .confirm(let names, _, _) = removal.state else { Issue.record("expected confirmation"); return }
        #expect(names == ["b"])
    }

    @Test func oneFolderReachedThroughTwoAgentFoldersIsTrashedOnce() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let agents = root.appendingPathComponent("agents")
        try FileManager.default.createDirectory(at: agents.appendingPathComponent("pdf"), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("claude"), withDestinationURL: agents)
        func at(_ folder: String, _ origin: String) -> Skill {
            Skill(id: origin, name: "pdf", description: "", githubUrl: "", installCmd: root.appendingPathComponent("\(folder)/pdf").path,
                authorHandle: "", tags: [], readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: nil,
                installs: nil, trendingRank: nil, trendingSource: nil, origin: origin, isSymlink: false, isLocalOnly: true)
        }
        #expect(SkillRemoval.copies(named: ["pdf"], in: [at("agents", "Agents"), at("claude", "Claude")]).count == 1)
    }

    @Test func confirmingTrashesOnlyCopiesThatWereShown() {
        var current = [copy("pdf", "Claude")], trashed: [String] = []
        let removal = SkillRemovalController(installations: { current },
            trash: { trashed.append($0.origin!); return .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        _ = removal.receive(URL(string: "omgskills://remove?name=pdf")!)
        current.append(copy("pdf", "Codex"))
        removal.confirm()
        #expect(trashed == ["Claude"], "A copy added after the question is left alone")
        _ = removal.receive(URL(string: "omgskills://remove?name=pdf")!)
        current = []
        removal.confirm()
        #expect(removal.state == .notFound(names: ["pdf"]), "Nothing left to delete is not reported as deleted")
    }

    @Test func oneQuestionForSeveralSkillsTrashesThemAll() {
        var trashed: [String] = [], reported = 0
        let removal = SkillRemovalController(
            installations: { [self] in [copy("a", "Claude"), copy("a", "Codex"), copy("b", "Codex"), copy("keep", "Claude")] },
            trash: { trashed.append("\($0.name)/\($0.origin!)"); return .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        removal.onRemoved = { reported += 1 }
        _ = removal.receive(URL(string: "omgskills://remove?name=a&name=b&name=gone")!)
        guard case .confirm(let names, let copies, let missing) = removal.state else { Issue.record("expected confirmation"); return }
        #expect(names == ["a", "b"] && copies.count == 3 && missing == ["gone"])
        let grouped = SkillRemoval.grouped(names: names, copies: copies)
        #expect(grouped.map(\.name) == ["a", "b"])
        #expect(grouped.map { SkillRemoval.agents($0.copies) } == ["Claude, Codex", "Codex"])
        #expect(trashed.isEmpty)
        removal.confirm()
        #expect(trashed.sorted() == ["a/Claude", "a/Codex", "b/Codex"])
        #expect(reported == 1, "One rescan for the whole batch")
        #expect(removal.state == .done(title: "Deleted 2 skills", message: "Moved to the Trash. To undo, put them back from the Trash."))
    }
}
