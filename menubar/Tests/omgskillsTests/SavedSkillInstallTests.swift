import Foundation
import Testing
@testable import omgskills

@MainActor
struct SavedSkillInstallTests {
    let credential = StoredDeviceCredential(credential: "c", connection: DeviceConnectionInfo(
        deviceID: "d", accountLabel: "jon@example.com", expiresAt: Date(timeIntervalSince1970: 4_000_000_000)))

    private var newest: CloudSavedVersion {
        CloudSavedVersion(id: "22222222-2222-4222-8222-222222222222", sourceId: "s", commitSha: String(repeating: "a", count: 40),
            treeSha: String(repeating: "b", count: 40), skillMdSha: "saved", savedAt: "2026-11-01T09:00:00.000Z")
    }

    private var package: SkillPackage {
        SkillPackage(coordinates: .init(commitSha: "a", treeSha: "b", skillMdSha: "saved"),
            entries: [.init(path: "SKILL.md", mode: "100644", data: Data("saved".utf8), blobSha: "x"),
                      .init(path: "scripts/run.sh", mode: "100755", data: Data("echo".utf8), blobSha: "y")])
    }

    private func copy(_ path: String) -> Skill {
        Skill(id: path, name: "notes", description: "", githubUrl: "", installCmd: path, authorHandle: "", tags: [],
            readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: nil, installs: nil,
            trendingRank: nil, trendingSource: nil, origin: "Codex", isSymlink: false, isLocalOnly: true)
    }

    private func settle(_ controller: SavedSkillInstallController) async {
        for _ in 0..<50 where { if case .checking = controller.state { true } else { false } }() { await Task.yield() }
    }

    @Test func acceptsOnlyALinkThatNamesOneFolder() {
        #expect(SavedSkillInstall.request(from: URL(string: "omgskills://install-saved?name=Notes&key=notes")!)
            == .init(name: "Notes", key: "notes"))
        for bad in ["omgskills://install-saved?name=notes", "omgskills://install-saved?name=n&key=../x",
                    "omgskills://install-saved?name=n&key=.hidden", "omgskills://install-saved?name=n&key=Notes",
                    "omgskills://install-saved?name=n&key=a%2Fb", "omgskills://install-saved?name=n&key=n&name=m",
                    "omgskills://restore?name=n&key=n"] {
            #expect(SavedSkillInstall.request(from: URL(string: bad)!) == nil, "\(bad)")
        }
    }

    @Test func asksWhichAgentThenInstallsTheNewestSavedVersion() async throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: home) }
        var downloads = 0, changed = 0
        let controller = SavedSkillInstallController(installations: { [] }, credential: { [credential] in credential },
            versions: { [newest] key, _ in #expect(key == "notes"); return [newest] },
            download: { [package] _, release, _ in downloads += 1; #expect(release.id == "22222222-2222-4222-8222-222222222222"); return package },
            root: { home.appendingPathComponent($0 == .claude ? ".claude/skills" : ".codex/skills") })
        controller.onChanged = { changed += 1 }
        #expect(controller.receive(URL(string: "omgskills://install-saved?name=notes&key=notes")!))
        await settle(controller)
        guard case .choose = controller.state else { Issue.record("expected agent choice: \(controller.state)"); return }
        #expect(downloads == 0, "Nothing is downloaded before choosing")
        await controller.install(for: .codex)
        #expect(controller.state == .done(name: "notes", message: "Installed for Codex."))
        let folder = home.appendingPathComponent(".codex/skills/notes")
        #expect(try String(contentsOf: folder.appendingPathComponent("SKILL.md"), encoding: .utf8) == "saved")
        let mode = try FileManager.default.attributesOfItem(atPath: folder.appendingPathComponent("scripts/run.sh").path)[.posixPermissions] as? Int
        #expect(mode == 0o755)
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: home.appendingPathComponent(".codex/skills").path)
        #expect(leftovers == ["notes"], "No staging folder is left behind")
        #expect(changed == 1)
    }

    @Test func neverReplacesWhatIsHereAndSaysWhenItIsntSaved() async throws {
        let here = SavedSkillInstallController(installations: { [self] in [copy("/Users/me/.codex/skills/Notes")] },
            credential: { [credential] in credential }, versions: { _, _ in Issue.record("must not ask"); return [] },
            download: { _, _, _ in throw CancellationError() }, root: { _ in URL(fileURLWithPath: "/nowhere") })
        _ = here.receive(URL(string: "omgskills://install-saved?name=notes&key=notes")!)
        await settle(here)
        #expect(here.state == .alreadyHere(name: "notes", agents: "Codex"))

        let unsaved = SavedSkillInstallController(installations: { [] }, credential: { [credential] in credential },
            versions: { _, _ in [] }, download: { _, _, _ in throw CancellationError() }, root: { _ in URL(fileURLWithPath: "/nowhere") })
        _ = unsaved.receive(URL(string: "omgskills://install-saved?name=notes&key=notes")!)
        await settle(unsaved)
        #expect(unsaved.state == .failed(message: "notes isn't saved in your account, so it can't be installed here."))

        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root.appendingPathComponent("notes"), withIntermediateDirectories: true)
        #expect(throws: (any Error).self) { try SavedSkillInstall.install(package, key: "notes", into: root) }
    }
}
