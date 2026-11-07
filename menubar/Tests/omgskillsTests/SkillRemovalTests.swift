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

    @Test func deleteEverywhereUsesTheAccountsSavedSkills() {
        // Before this Mac's first cloud save pass: a spec in a "last30days" folder is saved as "last30days@codex".
        var spec = copy("last30days", "Codex")
        spec = Skill(id: spec.id, name: "last30days-v3-spec", description: "", githubUrl: "", installCmd: spec.installCmd,
            authorHandle: "", tags: [], readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: nil,
            installs: nil, trendingRank: nil, trendingSource: nil, origin: "Codex", isSymlink: false, isLocalOnly: true)
        let records = [CloudSaveKeys.Record(key: "last30days", name: "last30days"),
                       CloudSaveKeys.Record(key: "last30days@codex", name: "last30days-v3-spec")]
        #expect(SkillRemovalController.keys([spec], among: [spec], records: records) == ["last30days@codex"])
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
        #expect(removal.state == .done(title: "Removed 2 skills", message: "Moved to the Trash. To undo, put them back from the Trash."))
    }

    @Test func deleteEverywhereAsksTwiceTrashesThenForgetsTheSkill() async {
        var trashed: [String] = [], forgotten: [[String]] = [], reported = 0
        let library = Skill(id: "l", name: "pdf", description: "", githubUrl: "", installCmd: "/Users/me/.codex/skills/PDF",
            authorHandle: "", tags: [], readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: nil,
            installs: nil, trendingRank: nil, trendingSource: nil, origin: "Codex", isSymlink: false, isLocalOnly: false,
            catalogSkillId: "anthropics/skills:pdf")
        let removal = SkillRemovalController(installations: { [self] in [copy("pdf", "Claude"), library] },
            trash: { trashed.append($0.origin!); return .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        removal.onRemoved = { reported += 1 }
        #expect(!removal.canDeleteEverywhere)
        removal.forget = { keys, ids in forgotten.append(keys + ids) }
        removal.setCount = { _ in 2 }
        _ = removal.receive(URL(string: "omgskills://remove?name=pdf")!)
        removal.chooseEverywhere()
        guard case .confirmEverywhere(let names, _, _) = removal.state else { Issue.record("expected second question"); return }
        #expect(names == ["pdf"] && trashed.isEmpty && forgotten.isEmpty, "Nothing happens before the second yes")
        await Task.yield()
        await removal.confirmEverywhere()
        #expect(trashed.sorted() == ["Claude", "Codex"])
        #expect(forgotten == [["pdf", "anthropics/skills:pdf"]])
        #expect(reported == 1)
        #expect(removal.state == .done(title: "Deleted pdf",
            message: "Removed from My skills and moved to the Trash. Copies on other Macs stay there."))
        #expect(SkillRemoval.everywhereWarning(count: 1, sets: 2).hasSuffix("It's also taken out of 2 Sets; people keep what they installed."))
        #expect(!SkillRemoval.everywhereWarning(count: 1, sets: 0).contains("Set"))
        #expect(SkillRemoval.everywhereWarning(count: 2, sets: 3).hasSuffix("taken out of the Sets they're in; people keep what they installed."))

        var allowed = false
        let offline = SkillRemovalController(installations: { [self] in [copy("pdf", "Claude")] },
            trash: { _ in Issue.record("must not trash"); return .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        offline.forget = { _, _ in Issue.record("must not forget") }
        offline.mayForget = { allowed }
        #expect(!offline.canDeleteEverywhere, "No permission, no Delete everywhere")
        allowed = true
        _ = offline.receive(URL(string: "omgskills://remove?name=pdf")!)
        offline.chooseEverywhere()
        allowed = false
        await offline.confirmEverywhere()
        #expect(offline.state == .failed(message: "Reconnect this Mac to your account to delete everywhere. Nothing was deleted."))
    }

    @Test func deleteEverywhereKeepsMySkillsWhenACopyStaysOrTheAccountFails() async {
        struct Blocked: Error {}
        var forgot = 0
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let stuck = root.appendingPathComponent("pdf")
        try? FileManager.default.createDirectory(at: stuck, withIntermediateDirectories: true)
        let stuckCopy = Skill(id: "s", name: "pdf", description: "", githubUrl: "", installCmd: stuck.path, authorHandle: "",
            tags: [], readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: nil, installs: nil,
            trendingRank: nil, trendingSource: nil, origin: "Codex", isSymlink: false, isLocalOnly: true)
        let removal = SkillRemovalController(installations: { [self] in [copy("pdf", "Claude"), stuckCopy] },
            trash: { if $0.origin == "Codex" { throw Blocked() }; return .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        removal.forget = { _, _ in forgot += 1 }
        _ = removal.receive(URL(string: "omgskills://remove?name=pdf")!)
        removal.chooseEverywhere()
        await removal.confirmEverywhere()
        #expect(forgot == 0, "A copy still here keeps it in My skills")
        #expect(removal.state == .failed(message: "Couldn't delete 1 copy (Codex). Other copies were moved to the Trash. My skills still has it."))

        let failing = SkillRemovalController(installations: { [self] in [copy("pdf", "Claude")] },
            trash: { _ in .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        failing.forget = { _, _ in throw Blocked() }
        _ = failing.receive(URL(string: "omgskills://remove?name=pdf")!)
        failing.chooseEverywhere()
        await failing.confirmEverywhere()
        #expect(failing.state == .failed(message: "Moved to the Trash, but couldn't remove pdf from My skills. Delete it on the web."))
    }
}
