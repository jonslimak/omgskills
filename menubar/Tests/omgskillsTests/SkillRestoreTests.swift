import Foundation
import Testing
@testable import omgskills

@MainActor
struct SkillRestoreTests {
    let versionID = "22222222-2222-4222-8222-222222222222"
    let credential = StoredDeviceCredential(credential: "c", connection: DeviceConnectionInfo(
        deviceID: "d", accountLabel: "jon@example.com", expiresAt: Date(timeIntervalSince1970: 4_000_000_000)))

    private func copy(_ name: String, _ origin: String, path: String, sha: String = "current") -> Skill {
        Skill(id: "\(origin):\(name)", name: name, description: "", githubUrl: "", installCmd: path, authorHandle: "",
            tags: [], readmeSnippet: nil, stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: sha, installs: nil,
            trendingRank: nil, trendingSource: nil, origin: origin, isSymlink: false, isLocalOnly: true)
    }

    private var savedVersion: CloudSavedVersion {
        CloudSavedVersion(id: versionID, sourceId: "s", commitSha: String(repeating: "a", count: 40),
            treeSha: String(repeating: "b", count: 40), skillMdSha: "saved", savedAt: "2026-11-01T09:00:00.000Z")
    }

    private func package(_ text: String) -> SkillPackage {
        SkillPackage(coordinates: .init(commitSha: "a", treeSha: "b", skillMdSha: "saved"),
            entries: [.init(path: "SKILL.md", mode: "100644", data: Data(text.utf8), blobSha: "x"),
                      .init(path: "scripts/run.sh", mode: "100755", data: Data("echo".utf8), blobSha: "y")])
    }

    @Test func acceptsOnlyACompleteRestoreLink() {
        let good = "omgskills://restore?name=notes&key=notes&version=\(versionID)"
        #expect(SkillRestore.request(from: URL(string: good)!) == .init(name: "notes", key: "notes", versionID: versionID))
        for bad in ["omgskills://restore?name=notes&key=notes", good + "&name=x", "omgskills://restore?name=notes&key=../x&version=\(versionID)",
                    "omgskills://restore?name=notes&key=notes&version=not-an-id", "omgskills://match?name=notes&key=notes&version=\(versionID)"] {
            #expect(SkillRestore.request(from: URL(string: bad)!) == nil, "\(bad)")
        }
    }

    @Test func asksFirstThenPutsTheSavedVersionInEveryCopy() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let agents = root.appendingPathComponent("agents/notes"), codex = root.appendingPathComponent("codex/notes")
        let claude = root.appendingPathComponent("claude/notes")
        for dir in [agents, codex] {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try "current".write(to: dir.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        }
        try FileManager.default.createDirectory(at: claude.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: claude, withDestinationURL: agents)
        let copies = [copy("notes", "Claude", path: claude.path), copy("notes", "Agents", path: agents.path),
                      copy("notes", "Codex", path: codex.path)]
        var downloads = 0, changed = 0
        let restore = SkillRestoreController(installations: { copies }, credential: { [credential] in credential },
            versions: { [savedVersion] key, _ in #expect(key == "notes"); return [savedVersion] },
            download: { [self] _, release, _ in downloads += 1; #expect(release.id == versionID); return package("saved") },
            trash: { try FileManager.default.removeItem(atPath: $0.installCmd) })
        restore.onChanged = { changed += 1 }
        #expect(restore.receive(URL(string: "omgskills://restore?name=notes&key=notes&version=\(versionID)")!))
        for _ in 0..<50 where !{ if case .confirm = restore.state { true } else { false } }() { await Task.yield() }
        guard case .confirm(_, let version, let shown) = restore.state else { Issue.record("expected confirmation: \(restore.state)"); return }
        #expect(version.savedAt == "2026-11-01T09:00:00.000Z" && shown.count == 3)
        #expect(downloads == 0, "Nothing is downloaded or changed before confirming")
        await restore.confirm()
        guard case .done = restore.state else { Issue.record("expected done: \(restore.state)"); return }
        for dir in [agents, codex, claude] {
            #expect(try String(contentsOf: dir.appendingPathComponent("SKILL.md"), encoding: .utf8) == "saved")
        }
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: claude.path) == agents.path, "The link still links")
        let mode = try FileManager.default.attributesOfItem(atPath: codex.appendingPathComponent("scripts/run.sh").path)[.posixPermissions] as? Int
        #expect(mode == 0o755)
        #expect(changed == 1)
    }

    @Test func refusesVersionsThatArentThisAccountsAndSaysWhenNothingToDo() async {
        let restore = SkillRestoreController(installations: { [self] in [copy("notes", "Codex", path: "/x/notes", sha: "saved")] },
            credential: { [credential] in credential }, versions: { [savedVersion] _, _ in [savedVersion] },
            download: { _, _, _ in Issue.record("must not download"); throw CancellationError() }, trash: { _ in })
        _ = restore.receive(URL(string: "omgskills://restore?name=notes&key=notes&version=33333333-3333-4333-8333-333333333333")!)
        for _ in 0..<50 { await Task.yield() }
        #expect(restore.state == .failed(message: "That saved version wasn't found. Nothing was changed."))
        _ = restore.receive(URL(string: "omgskills://restore?name=notes&key=notes&version=\(versionID)")!)
        for _ in 0..<50 { await Task.yield() }
        #expect(restore.state == .alreadyRestored(name: "notes"))
        // Another skill's saved files can never land on this one.
        _ = restore.receive(URL(string: "omgskills://restore?name=notes&key=other&version=\(versionID)")!)
        for _ in 0..<50 { await Task.yield() }
        #expect(restore.state == .failed(message: "notes isn't on this Mac, so there's nothing to restore into."))
        _ = restore.receive(URL(string: "omgskills://restore?name=gone&key=gone&version=\(versionID)")!)
        for _ in 0..<50 { await Task.yield() }
        #expect(restore.state == .failed(message: "gone isn't on this Mac, so there's nothing to restore into."))
    }
}
