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

    @Test func acceptsOnlyOneNamedSkill() {
        #expect(SkillRemoval.name(from: URL(string: "omgskills://remove?name=humanizer")!) == "humanizer")
        #expect(SkillRemoval.name(from: URL(string: "omgskills://remove?name=ship%20it")!) == "ship it")
        for bad in ["omgskills://remove", "omgskills://remove?name=", "omgskills://remove?name=a&name=b",
                    "omgskills://remove/x?name=a", "omgskills://install?name=a", "https://remove?name=a",
                    "omgskills://remove?name=a%0Ab", "omgskills://remove?skill=a"] {
            #expect(SkillRemoval.name(from: URL(string: bad)!) == nil, "\(bad)")
        }
    }

    @Test func findsEveryCopyByNameLinksFirst() {
        let all = [copy("Humanizer", "Agents"), copy("humanizer", "Claude", link: true),
                   copy("humanizer", "Codex"), copy("other", "Claude")]
        let found = SkillRemoval.copies(named: " HUMANIZER ", in: all)
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
        guard case .confirm(_, let copies) = removal.state else { Issue.record("expected confirmation"); return }
        #expect(copies.count == 2 && trashed.isEmpty, "A link alone never deletes")
        removal.confirm()
        #expect(trashed.sorted() == ["Claude", "Codex"])
        #expect(reported == 1)
        guard case .done = removal.state else { Issue.record("expected done"); return }
        removal.close()
        #expect(!removal.isActive)
    }

    @Test func reportsMissingInvalidAndPartialFailures() {
        struct Blocked: Error {}
        let removal = SkillRemovalController(
            installations: { [self] in [copy("humanizer", "Claude"), copy("humanizer", "Codex")] },
            trash: { if $0.origin == "Codex" { throw Blocked() }; return .init(provenanceRemoved: false, provenanceCleanupWarning: nil) })
        #expect(removal.receive(URL(string: "omgskills://remove?name=pdf")!))
        #expect(removal.state == .notFound(name: "pdf"))
        removal.close()
        #expect(removal.receive(URL(string: "omgskills://remove?name=")!))
        guard case .failed = removal.state else { Issue.record("expected invalid"); return }
        removal.close()
        #expect(!removal.receive(URL(string: "omgskills://install?id=x")!))
        _ = removal.receive(URL(string: "omgskills://remove?name=humanizer")!)
        removal.confirm()
        #expect(removal.state == .failed(name: "humanizer",
            message: "Couldn't delete the Codex copy. Other copies were moved to the Trash."))
    }
}
