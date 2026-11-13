import Foundation
import Testing
@testable import omgskills

private func credential(scopes: Set<DeviceScope> = Set(DeviceScope.allCases)) -> StoredDeviceCredential {
    StoredDeviceCredential(credential: "device_secret", connection: DeviceConnectionInfo(
        deviceID: "device-1", accountLabel: "jon@example.com", expiresAt: .distantFuture, grantedScopes: scopes))
}

private func temporaryRoot() throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("cloud-save-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
}

@discardableResult
private func makeSkill(_ root: URL, _ name: String, skillMd: String = "---\nname: x\ndescription: y\n---\n",
                       files: [String: String] = [:], executable: Set<String> = []) throws -> URL {
    let directory = root.appendingPathComponent(name, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data(skillMd.utf8).write(to: directory.appendingPathComponent("SKILL.md"))
    for (path, text) in files {
        let url = directory.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url)
        if executable.contains(path) {
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        }
    }
    return directory
}

private func installation(_ directory: URL, modified: String = "2026-11-01T00:00:00Z", name: String? = nil,
                          origin: String = "Claude") -> Skill {
    Skill(id: "installed:\(directory.path)", name: name ?? directory.lastPathComponent, description: "", githubUrl: "",
          installCmd: directory.path, authorHandle: "", tags: [], readmeSnippet: nil, stars: 0, lastUpdated: modified,
          firstSeen: "", skillMdSha: nil, installs: nil, trendingRank: nil, trendingSource: nil, origin: origin,
          isSymlink: false, isLocalOnly: true)
}

struct CloudSaveFolderTests {
    @Test func readsAFolderAsAPackageThatValidates() throws {
        let root = try temporaryRoot()
        let directory = try makeSkill(root, "My-Notes", files: ["scripts/run.sh": "echo hi\n", ".DS_Store": "x"],
                                      executable: ["scripts/run.sh"])
        let folder = try CloudSaveFolder.read(directory: directory)
        #expect(folder.key == "my-notes")
        #expect(folder.entries.map(\.path) == ["SKILL.md", "scripts/run.sh"])
        #expect(folder.entries.map(\.mode) == ["100644", "100755"])
        #expect(folder.coordinates.commitSha == folder.treeSha)
        let package = SkillPackage(coordinates: folder.coordinates, entries: folder.entries)
        #expect(try SkillPackageValidator.validate(package, expected: folder.coordinates).fileCount == 2)
    }

    @Test func refusesLinksAndMissingSkillFile() throws {
        let root = try temporaryRoot()
        let directory = try makeSkill(root, "linked")
        try FileManager.default.createSymbolicLink(at: directory.appendingPathComponent("shared"),
                                                   withDestinationURL: root)
        #expect(throws: CloudSaveFolder.ReadError.containsLink("shared")) { try CloudSaveFolder.read(directory: directory) }

        let empty = root.appendingPathComponent("empty", isDirectory: true)
        try FileManager.default.createDirectory(at: empty, withIntermediateDirectories: true)
        try Data("x".utf8).write(to: empty.appendingPathComponent("README.md"))
        #expect(throws: CloudSaveFolder.ReadError.invalid(.missingSkillMd)) { try CloudSaveFolder.read(directory: empty) }
    }

    @Test func followsLinksToYourOwnFilesAndTheOldLibraryButNotPrivatePlaces() throws {
        let home = try temporaryRoot()
        let fm = FileManager.default
        let library = home.appendingPathComponent("Library/Application Support/omgskills/repos", isDirectory: true)
        let policy = CloudSaveFolder.LinkPolicy(home: home, libraryRoot: library)
        let skills = home.appendingPathComponent(".claude/skills", isDirectory: true)
        try fm.createDirectory(at: skills, withIntermediateDirectories: true)
        func link(_ name: String, in folder: URL, to target: URL) throws {
            try fm.createSymbolicLink(at: folder.appendingPathComponent(name), withDestinationURL: target)
        }

        // An older omgskills install: the files live in its library folder, and are saved as if they were here.
        let repo = try makeSkill(library.appendingPathComponent("garrytan--gstack"), "ship", files: ["sections/a.md": "a"])
        let ship = skills.appendingPathComponent("ship", isDirectory: true)
        try fm.createDirectory(at: ship, withIntermediateDirectories: true)
        try link("SKILL.md", in: ship, to: repo.appendingPathComponent("SKILL.md"))
        try link("sections", in: ship, to: repo.appendingPathComponent("sections"))
        let repoTree = try CloudSaveFolder.read(directory: repo).treeSha
        #expect(try CloudSaveFolder.read(directory: ship, links: policy).treeSha == repoTree)
        try link("gstack-ship", in: skills, to: repo)
        #expect(try CloudSaveFolder.read(directory: skills.appendingPathComponent("gstack-ship"), links: policy).treeSha == repoTree)

        // Your own skill kept elsewhere in your home folder, linked as a whole, is saved as if the files were here.
        let project = try makeSkill(home.appendingPathComponent("Projects/notes"), "skill",
                                    files: ["docs/guide.md": "guide", "run.sh": "echo hi\n"], executable: ["run.sh"])
        try link("mine", in: skills, to: project)
        let mine = skills.appendingPathComponent("mine")
        let followed = try CloudSaveFolder.read(directory: mine, links: policy)
        #expect(followed.entries.map(\.path) == ["SKILL.md", "docs/guide.md", "run.sh"])
        #expect(followed.entries.map(\.mode) == ["100644", "100644", "100755"])
        #expect(followed.treeSha == (try CloudSaveFolder.read(directory: project)).treeSha)
        // Without a policy, links still stop a folder being saved.
        // Links inside a skill may not leave it, except to another installed skill: a skill copied from someone
        // else could otherwise reach your files. Per-file links out to a project aren't followed.
        let perFile = skills.appendingPathComponent("per-file", isDirectory: true)
        try fm.createDirectory(at: perFile, withIntermediateDirectories: true)
        try link("SKILL.md", in: perFile, to: project.appendingPathComponent("SKILL.md"))
        #expect(throws: CloudSaveFolder.ReadError.privateLink("SKILL.md")) { try CloudSaveFolder.read(directory: perFile, links: policy) }
        #expect(throws: CloudSaveFolder.ReadError.containsLink("SKILL.md")) { try CloudSaveFolder.read(directory: perFile) }

        // Keys, settings and other apps' data are never followed.
        // Agents keep sign-in and settings files beside their skills folder; those are private too.
        for (name, target) in [("keys", ".ssh/id_ed25519"), ("env", "Projects/app/.env"), ("prefs", "Library/Preferences/x.plist"),
                               ("codex-auth", ".codex/auth.json"), ("claude-settings", ".claude/settings.json"),
                               ("claude-history", ".claude/projects/p/chat.jsonl"), ("cursor-mcp", ".cursor/mcp.json"),
                               ("agents-config", ".agents/config.toml")] {
            let file = home.appendingPathComponent(target)
            try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("secret".utf8).write(to: file)
            let skill = try makeSkill(skills, "private-\(name)")
            try link(name, in: skill, to: file)
            #expect(throws: CloudSaveFolder.ReadError.privateLink(name)) { try CloudSaveFolder.read(directory: skill, links: policy) }
        }
        // Another skill's files in an agent's skills folder are still followed.
        let codexSkill = try makeSkill(home.appendingPathComponent(".codex/skills/shared"), "skill", files: ["ref.md": "r"])
        let usesShared = try makeSkill(skills, "uses-shared")
        try link("ref.md", in: usesShared, to: codexSkill.appendingPathComponent("ref.md"))
        #expect(try CloudSaveFolder.read(directory: usesShared, links: policy).entries.map(\.path) == ["SKILL.md", "ref.md"])
        // A skill copied from someone else may carry links out to your files; only other skills are followed.
        for (name, target) in [("docs-file", "Documents/taxes.pdf"), ("downloads", "Downloads/report.csv"),
                               ("project-config", "Projects/app/config/credentials.json")] {
            let file = home.appendingPathComponent(target)
            try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("private".utf8).write(to: file)
            let skill = try makeSkill(skills, "cloned-\(name)")
            try link(name, in: skill, to: file)
            #expect(throws: CloudSaveFolder.ReadError.privateLink(name)) { try CloudSaveFolder.read(directory: skill, links: policy) }
        }
        let desktop = home.appendingPathComponent("Desktop", isDirectory: true)
        try fm.createDirectory(at: desktop, withIntermediateDirectories: true)
        try Data("x".utf8).write(to: desktop.appendingPathComponent("notes.txt"))
        let clonedFolder = try makeSkill(skills, "cloned-folder")
        try link("ref", in: clonedFolder, to: desktop)
        #expect(throws: CloudSaveFolder.ReadError.privateLink("ref")) { try CloudSaveFolder.read(directory: clonedFolder, links: policy) }
        // A skill folder that is itself a link to a folder without a SKILL.md isn't read either.
        try link("whole-desktop", in: skills, to: desktop)
        #expect(throws: CloudSaveFolder.ReadError.privateLink("whole-desktop")) {
            try CloudSaveFolder.read(directory: skills.appendingPathComponent("whole-desktop"), links: policy)
        }
        // Not even to a project that has a SKILL.md of its own.
        let myapp = try makeSkill(home.appendingPathComponent("Projects"), "myapp", files: ["config/credentials.json": "{}"])
        try fm.createDirectory(at: myapp.appendingPathComponent(".git"), withIntermediateDirectories: true)
        let cloned = try makeSkill(skills, "cloned-repo")
        try fm.createDirectory(at: cloned.appendingPathComponent(".git"), withIntermediateDirectories: true)
        try link("ref", in: cloned, to: myapp)
        #expect(throws: CloudSaveFolder.ReadError.privateLink("ref")) { try CloudSaveFolder.read(directory: cloned, links: policy) }
        // A folder shared by several skills in one repository is outside each skill, so isn't followed.
        let multi = home.appendingPathComponent("Projects/multi", isDirectory: true)
        try fm.createDirectory(at: multi.appendingPathComponent(".git"), withIntermediateDirectories: true)
        let shared = multi.appendingPathComponent("scripts", isDirectory: true)
        try fm.createDirectory(at: shared, withIntermediateDirectories: true)
        try Data("echo\n".utf8).write(to: shared.appendingPathComponent("run.sh"))
        let foo = try makeSkill(multi.appendingPathComponent("skills"), "foo")
        try fm.createSymbolicLink(atPath: foo.appendingPathComponent("scripts").path, withDestinationPath: "../../scripts")
        try link("foo", in: skills, to: foo)
        #expect(throws: CloudSaveFolder.ReadError.privateLink("scripts")) {
            try CloudSaveFolder.read(directory: skills.appendingPathComponent("foo"), links: policy)
        }
        // Links within the skill's own folder are fine.
        let inner = try makeSkill(skills, "inner", files: ["docs/a.md": "a"])
        try link("alias.md", in: inner, to: inner.appendingPathComponent("docs/a.md"))
        #expect(try CloudSaveFolder.read(directory: inner, links: policy).entries.map(\.path) == ["SKILL.md", "alias.md", "docs/a.md"])
        // Hidden files in a linked folder, such as a project's .env, are never read.
        let app = try makeSkill(home.appendingPathComponent("Projects/app-skill"), "skill",
                                files: [".env": "TOKEN=secret", ".config/keys.json": "{}", "docs/.env": "x", "docs/a.md": "a"])
        try link("app-skill", in: skills, to: app)
        let viaRoot = try CloudSaveFolder.read(directory: skills.appendingPathComponent("app-skill"), links: policy)
        #expect(viaRoot.entries.map(\.path) == ["SKILL.md", "docs/a.md"])
        // A skill folder that is itself a link to a private place isn't read.
        let sshFolder = home.appendingPathComponent(".ssh", isDirectory: true)
        try Data("# s".utf8).write(to: sshFolder.appendingPathComponent("SKILL.md"))
        try link("keys-skill", in: skills, to: sshFolder)
        #expect(throws: CloudSaveFolder.ReadError.privateLink("keys-skill")) {
            try CloudSaveFolder.read(directory: skills.appendingPathComponent("keys-skill"), links: policy)
        }
        // A parent directory can be a link even when the skill folder itself is not.
        let privateChild = try makeSkill(sshFolder, "nested")
        try link("private-parent", in: skills, to: sshFolder)
        #expect(throws: CloudSaveFolder.ReadError.privateLink("nested")) {
            try CloudSaveFolder.read(directory: skills.appendingPathComponent("private-parent/nested"), links: policy)
        }
        #expect(FileManager.default.fileExists(atPath: privateChild.appendingPathComponent("SKILL.md").path))
        let projectParent = home.appendingPathComponent("Projects/app-skill")
        try link("project-parent", in: skills, to: projectParent)
        let viaParent = try CloudSaveFolder.read(directory: skills.appendingPathComponent("project-parent/skill"), links: policy)
        #expect(viaParent.entries.map(\.path) == ["SKILL.md", "docs/a.md"])

        let outside = try makeSkill(skills, "outside")
        try link("hosts", in: outside, to: URL(fileURLWithPath: "/etc/hosts"))
        #expect(throws: CloudSaveFolder.ReadError.privateLink("hosts")) { try CloudSaveFolder.read(directory: outside, links: policy) }

        // A link back up the tree, or to nothing, isn't followed.
        let loop = try makeSkill(skills, "loop")
        try link("again", in: loop, to: loop)
        #expect(throws: CloudSaveFolder.ReadError.containsLink("again")) { try CloudSaveFolder.read(directory: loop, links: policy) }
        let broken = try makeSkill(skills, "broken")
        try link("gone", in: broken, to: home.appendingPathComponent("Projects/missing.md"))
        #expect(throws: CloudSaveFolder.ReadError.containsLink("gone")) { try CloudSaveFolder.read(directory: broken, links: policy) }
    }

    @Test func aLinkedSkillFolderIsReadThroughItsLink() throws {
        let root = try temporaryRoot()
        let target = try makeSkill(root, "real")
        let link = root.appendingPathComponent("alias")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        let folder = try CloudSaveFolder.read(directory: link)
        #expect(folder.key == "alias")
        let direct = try CloudSaveFolder.read(directory: target)
        #expect(folder.treeSha == direct.treeSha)
    }
}

private actor FakeCloudSave: CloudSaveServing {
    var state: CloudSaveState
    var stored: Set<String> = []
    var held: [String: [CloudSaveFinding]] = [:]
    var saved: [String: String] = [:]
    /// The SKILL.md name sent with each save, by key.
    var names: [String: String] = [:]
    /// Keys another Mac's different skill holds.
    var takenKeys: Set<String> = []
    var deleted: [String: Bool] = [:]
    var calls: [String] = []
    var additions: [String] = []

    func add(_ ids: [String]) { additions = ids }
    func take(_ key: String) { takenKeys.insert(key) }
    var leftOut: [String]?
    func setExcluded(_ keys: [String], credential: StoredDeviceCredential) async throws { leftOut = keys }
    func mySkillAdditions(credential: StoredDeviceCredential) async throws -> [String] { additions }

    init(enabled: Bool = true, excluded: [String] = [], skills: [CloudSaveState.SavedSkill] = []) {
        state = CloudSaveState(settings: .init(enabled: enabled, excludedSkillKeys: excluded),
                               usage: .init(bytes: 0, limitBytes: 1_000), skills: skills, needsReview: [])
    }

    func hold(_ sha: String) { held[sha] = [CloudSaveFinding(rule: "github_token", kind: "GitHub token", line: 1)] }
    func release(_ sha: String) { held[sha] = nil }
    func waiting(_ reviews: [CloudSaveState.Review]) {
        state = CloudSaveState(settings: state.settings, usage: state.usage, skills: state.skills, needsReview: reviews)
    }

    func state(credential: StoredDeviceCredential) async throws -> CloudSaveState { calls.append("state"); return state }
    func setEnabled(_ enabled: Bool, credential: StoredDeviceCredential) async throws {
        calls.append("enabled:\(enabled)")
        state = CloudSaveState(settings: .init(enabled: enabled, excludedSkillKeys: state.settings.excludedSkillKeys),
                               usage: state.usage, skills: state.skills, needsReview: state.needsReview)
    }
    func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws {
        calls.append("upload:\(entry.path)")
        if let findings = held[entry.blobSha], !confirmSecrets { throw CloudSaveAPIError.needsReview(findings) }
        stored.insert(entry.blobSha)
    }
    func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult {
        calls.append("version:\(folder.key)")
        if takenKeys.contains(folder.key) { throw CloudSaveAPIError.nameTaken }
        names[folder.key] = folder.name
        let missing = Array(Set(folder.entries.map(\.blobSha)).subtracting(stored)).sorted()
        if !missing.isEmpty { return .missingFiles(missing) }
        let created = saved[folder.key] != folder.treeSha
        saved[folder.key] = folder.treeSha
        return .saved(created: created)
    }
    func markDeletedLocally(key: String, deleted: Bool, credential: StoredDeviceCredential) async throws {
        calls.append("deleted:\(key):\(deleted)")
        self.deleted[key] = deleted
    }
    var withdrawn: [String] = []
    func withdrawReview(key: String, credential: StoredDeviceCredential) async throws { withdrawn.append(key) }
    var reported: [[String: CloudSaveSkipReason]] = []
    func reportSkipped(_ skipped: [String: CloudSaveSkipReason], credential: StoredDeviceCredential) async throws {
        reported.append(skipped)
    }
}

struct CloudSaveSyncTests {
    private func sync(_ api: FakeCloudSave) -> CloudSaveSync { CloudSaveSync(api: api, pace: {}) }

    @Test func doesNothingWhileCloudSaveIsOff() async throws {
        let root = try temporaryRoot()
        let api = FakeCloudSave(enabled: false)
        let summary = try await sync(api).run(installations: [installation(try makeSkill(root, "notes"))],
            localFolderKeys: [], deviceID: "device-1", credential: credential())
        #expect(summary.status == .off)
        #expect(await api.calls == ["state"])
    }

    @Test func asksToReconnectWithoutTheUploadPermission() async throws {
        let api = FakeCloudSave()
        let summary = try await sync(api).run(installations: [], localFolderKeys: [], deviceID: "device-1",
            credential: credential(scopes: [.syncWrite, .selfRevoke, .contentRead]))
        #expect(summary.status == .permissionRequired)
    }

    @Test func savesNewSkillsUploadingOnlyMissingFilesAndSkipsUnchangedOnes() async throws {
        let root = try temporaryRoot()
        let notes = try makeSkill(root, "notes", files: ["a.txt": "a"])
        let api = FakeCloudSave()
        let first = try await sync(api).run(installations: [installation(notes)], localFolderKeys: [],
            deviceID: "device-1", credential: credential())
        #expect(first.status == .upToDate)
        #expect(first.uploadedCount == 1)
        let calls = await api.calls
        #expect(calls.first == "state" && calls[1] == "version:notes" && calls.last == "version:notes")
        #expect(Set(calls[2..<4]) == ["upload:SKILL.md", "upload:a.txt"])

        // Once the server's copy matches, a later pass sends nothing.
        let folder = try CloudSaveFolder.read(directory: notes)
        let synced = FakeCloudSave(skills: [.init(key: "notes", currentVersion: .init(id: "r1", treeSha: folder.treeSha,
            deviceId: "device-1", savedAt: "2026-01-01T00:00:00.000Z", labels: []), deletedLocallyAt: nil)])
        let second = try await sync(synced).run(installations: [installation(notes)], localFolderKeys: ["notes"],
            deviceID: "device-1", credential: credential())
        #expect(second.savedCount == 1 && second.uploadedCount == 0)
        #expect(await synced.calls == ["state"])
    }

    @Test func summaryLineCountsEverySkillThenWhatNeedsALook() async throws {
        let root = try temporaryRoot()
        let notes = try makeSkill(root, "notes")
        let left = try makeSkill(root, "left")
        let folder = try CloudSaveFolder.read(directory: notes)
        let version = { (id: String, tree: String) in
            CloudSaveState.Version(id: id, treeSha: tree, deviceId: "device-1", savedAt: "2026-01-01T00:00:00.000Z", labels: []) }
        let api = FakeCloudSave(excluded: ["left"], skills: [
            .init(key: "notes", currentVersion: version("r1", folder.treeSha), deletedLocallyAt: nil),
            .init(key: "gone", currentVersion: version("r2", "x"), deletedLocallyAt: "2026-01-02T00:00:00.000Z"),
        ])
        let summary = try await sync(api).run(installations: [installation(notes), installation(left)], localFolderKeys: ["notes", "left"],
            deviceID: "device-1", credential: credential())
        #expect(summary.skillCount == 3 && summary.notOnThisMacCount == 1 && summary.leftOutCount == 1)
        #expect(summary.hereCount == 2 && summary.mySkillsCount == 3)
        #expect(CloudSaveController.statusText(summary) == "2 on this Mac · 1 left out")

        var clean = CloudSaveSummary(status: .upToDate)
        clean.hereCount = 21
        #expect(CloudSaveController.statusText(clean) == "21 on this Mac · all synced")
        clean.needsReview = ["a"]
        clean.skipped = ["b": .links, "c": .tooLarge]
        #expect(CloudSaveController.statusText(clean) == "21 on this Mac · 3 can't sync")
        #expect(CloudSaveController.statusText(CloudSaveSummary(status: .off)) == "Not synced")
    }

    @Test func mySkillsCountAddsLibrarySkillsNothingElseStandsFor() async throws {
        let root = try temporaryRoot()
        let notes = try makeSkill(root, "notes")
        let pdf = try makeSkill(root, "pdf")
        try markInstalled(pdf)
        let api = FakeCloudSave(skills: [.init(key: "docx", currentVersion: .init(id: "r1", treeSha: "x", deviceId: "device-2",
            savedAt: "2026-01-01T00:00:00.000Z", labels: []), deletedLocallyAt: nil)])
        // pdf is installed here (by catalog ID); docx is saved from another Mac; only xlsx and a duplicate are new.
        await api.add(["o/r:pdf", "anthropics/skills:docx", "anthropics/skills:xlsx", "anthropics/skills:xlsx"])
        var pdfInstall = installation(pdf)
        pdfInstall = Skill(id: pdfInstall.id, name: "pdf", description: "", githubUrl: "", installCmd: pdf.path, authorHandle: "",
            tags: [], readmeSnippet: nil, stars: 0, lastUpdated: pdfInstall.lastUpdated, firstSeen: "", skillMdSha: nil,
            installs: nil, trendingRank: nil, trendingSource: nil, origin: "Claude", isSymlink: false, isLocalOnly: false,
            catalogSkillId: "o/r:pdf")
        let summary = try await sync(api).run(installations: [installation(notes), pdfInstall], localFolderKeys: ["notes", "pdf"],
            deviceID: "device-1", credential: credential())
        #expect(summary.hereCount == 2 && summary.skillCount == 3 && summary.addedCount == 1 && summary.mySkillsCount == 4)
        #expect(ConnectedInventoryView.headerText(here: 2, summary: summary) == "4 skills")
        #expect(ConnectedInventoryView.lineText(here: 2, summary: CloudSaveSummary(status: .off)) == "2 on this Mac · Not synced")
        #expect(ConnectedInventoryView.headerText(here: 2, summary: CloudSaveSummary(status: .off)) == "2 skills")
    }

    @Test func libraryInstallsAreSavedAndExcludedSkillsAreNot() async throws {
        let root = try temporaryRoot()
        let mine = try makeSkill(root, "private-notes")
        let library = try makeSkill(root, "pdf")
        let tree = try CloudSaveFolder.read(directory: library).treeSha
        let metadata = SkillInstallProvenanceStore.metadataURL(targetRoot: root, targetName: "pdf")
        try FileManager.default.createDirectory(at: metadata.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"installedAt":"2026-11-01T00:00:00Z","treeSha":"\#(tree)","catalogSkillId":"anthropics/skills:pdf"}"#.utf8)
            .write(to: metadata)

        let api = FakeCloudSave(excluded: ["private-notes"])
        let summary = try await sync(api).run(installations: [installation(mine), installation(library)],
            localFolderKeys: [], deviceID: "device-1", credential: credential())
        // The exact version installed from the library is saved; the left-out skill isn't.
        #expect(summary.uploadedCount == 1 && summary.savedCount == 1)
        let calls = await api.calls
        #expect(calls.contains("version:pdf") && !calls.contains("version:private-notes"))
        #expect(await api.reported == [[:]])

        // Editing it saves the user's version too.
        try Data("---\nname: pdf\ndescription: mine\n---\n".utf8).write(to: library.appendingPathComponent("SKILL.md"))
        let edited = try await sync(api).run(installations: [installation(library)], localFolderKeys: [],
            deviceID: "device-1", credential: credential())
        #expect(edited.uploadedCount == 1)
    }

    private func markInstalled(_ folder: URL) throws {
        let tree = try CloudSaveFolder.read(directory: folder).treeSha
        let metadata = SkillInstallProvenanceStore.metadataURL(targetRoot: folder.deletingLastPathComponent(), targetName: folder.lastPathComponent)
        try FileManager.default.createDirectory(at: metadata.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"installedAt":"2026-11-01T00:00:00Z","treeSha":"\#(tree)","catalogSkillId":"o/r:\#(folder.lastPathComponent)"}"#.utf8)
            .write(to: metadata)
    }

    @Test func unchangedInstallsGoLastAFewPerPassAndNeverReplaceAnotherMacsSave() async throws {
        let root = try temporaryRoot()
        let own = try makeSkill(root, "zz-own")
        var installs: [URL] = []
        for index in 0..<(CloudSaveSync.installUploadsPerPass + 2) {
            let folder = try makeSkill(root, String(format: "a-lib-%02d", index))
            try markInstalled(folder)
            installs.append(folder)
        }
        let api = FakeCloudSave()
        let summary = try await sync(api).run(installations: ([own] + installs).map { installation($0) }, localFolderKeys: [],
            deviceID: "device-1", credential: credential())
        let saves = await api.calls.filter { $0.hasPrefix("version:") }
        #expect(saves.first == "version:zz-own", "Your own skill is saved before any install")
        #expect(summary.notSavedYetCount == 2)
        #expect(CloudSaveController.statusText(summary).contains("2 not synced yet"))

        // Another Mac saved an edit; this Mac's unchanged install of the same skill must not replace it.
        let pdf = try makeSkill(root, "pdf")
        try markInstalled(pdf)
        let edited = FakeCloudSave(skills: [.init(key: "pdf", currentVersion: .init(id: "r1", treeSha: "edited", deviceId: "device-2",
            savedAt: "2000-01-01T00:00:00.000Z", labels: []), deletedLocallyAt: nil)])
        let second = try await sync(edited).run(installations: [installation(pdf)], localFolderKeys: ["pdf"],
            deviceID: "device-1", credential: credential())
        #expect(second.olderHereCount == 1 && second.uploadedCount == 0)
    }

    @Test func aLinkIntoTheLibraryNeverReadsARepoHiddenFiles() throws {
        let home = try temporaryRoot()
        let fm = FileManager.default
        let library = home.appendingPathComponent("Library/Application Support/omgskills/repos", isDirectory: true)
        let repo = try makeSkill(library.appendingPathComponent("o--r"), "ship")
        let git = library.appendingPathComponent("o--r/.git", isDirectory: true)
        try fm.createDirectory(at: git, withIntermediateDirectories: true)
        try Data("[remote]".utf8).write(to: git.appendingPathComponent("config"))
        try fm.createSymbolicLink(at: repo.appendingPathComponent("cfg"), withDestinationURL: git.appendingPathComponent("config"))
        let skills = home.appendingPathComponent(".claude/skills", isDirectory: true)
        try fm.createDirectory(at: skills, withIntermediateDirectories: true)
        try fm.createSymbolicLink(at: skills.appendingPathComponent("ship"), withDestinationURL: repo)
        let policy = CloudSaveFolder.LinkPolicy(home: home, libraryRoot: library)
        #expect(throws: CloudSaveFolder.ReadError.privateLink("cfg")) {
            try CloudSaveFolder.read(directory: skills.appendingPathComponent("ship"), links: policy)
        }
    }

    @Test func skillsLinkedIntoTheOldLibraryFolderAreSaved() async throws {
        let home = try temporaryRoot()
        let library = home.appendingPathComponent("Library/Application Support/omgskills/repos", isDirectory: true)
        let repo = try makeSkill(library.appendingPathComponent("garrytan--gstack"), "ship")
        let skills = home.appendingPathComponent(".claude/skills", isDirectory: true)
        let ship = skills.appendingPathComponent("ship", isDirectory: true)
        try FileManager.default.createDirectory(at: ship, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: ship.appendingPathComponent("SKILL.md"),
                                                   withDestinationURL: repo.appendingPathComponent("SKILL.md"))
        let api = FakeCloudSave()
        var sync = CloudSaveSync(api: api, pace: {})
        sync.links = CloudSaveFolder.LinkPolicy(home: home, libraryRoot: library)
        let summary = try await sync.run(installations: [installation(ship)], localFolderKeys: [], deviceID: "device-1",
                                         credential: credential())
        #expect(summary.uploadedCount == 1 && summary.skipped.isEmpty)
        #expect(await api.reported == [[:]])
    }

    @Test func tellsTheWebWhySkillsWereNotSavedOnlyAfterAFinishedPass() async throws {
        let root = try temporaryRoot()
        let linked = try makeSkill(root, "ship")
        try FileManager.default.createSymbolicLink(at: linked.appendingPathComponent("extra.md"),
                                                   withDestinationURL: root.appendingPathComponent("elsewhere.md"))
        let big = try makeSkill(root, "big", files: ["data.bin": String(repeating: "x", count: CloudSaveFolder.limits.maximumFileBytes + 1)])
        let api = FakeCloudSave()
        let summary = try await sync(api).run(installations: [installation(linked), installation(big)],
            localFolderKeys: [], deviceID: "device-1", credential: credential())
        #expect(summary.skipped == ["ship": .links, "big": .tooLarge])
        #expect(await api.reported == [["ship": .links, "big": .tooLarge]])

        // A pass that stops early leaves the last full report in place.
        struct Offline: CloudSaveServing {
            func state(credential: StoredDeviceCredential) async throws -> CloudSaveState { throw CloudSaveAPIError.unavailable }
            func setEnabled(_ enabled: Bool, credential: StoredDeviceCredential) async throws {}
            func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws {}
            func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult {
                .saved(created: false)
            }
            func markDeletedLocally(key: String, deleted: Bool, credential: StoredDeviceCredential) async throws {}
            func withdrawReview(key: String, credential: StoredDeviceCredential) async throws {}
            func reportSkipped(_ skipped: [String: CloudSaveSkipReason], credential: StoredDeviceCredential) async throws {
                Issue.record("a stopped pass must not report")
            }
        }
        _ = try await CloudSaveSync(api: Offline(), pace: {}).run(installations: [installation(linked)],
            localFolderKeys: [], deviceID: "device-1", credential: credential())
    }

    @Test func heldFilesLeaveTheSkillForReviewWhileOthersSave() async throws {
        let root = try temporaryRoot()
        let deploy = try makeSkill(root, "deploy", files: ["config.env": "TOKEN=x"])
        let notes = try makeSkill(root, "notes")
        let api = FakeCloudSave()
        let entries = try CloudSaveFolder.read(directory: deploy).entries
        let secret = try #require(entries.first { $0.path == "config.env" })
        await api.hold(secret.blobSha)
        let summary = try await sync(api).run(installations: [installation(deploy), installation(notes)],
            localFolderKeys: [], deviceID: "device-1", credential: credential())
        #expect(summary.status == .incomplete)
        #expect(summary.needsReview == ["deploy"])
        #expect(summary.uploadedCount == 1)
        #expect(await api.saved["notes"] != nil)
        #expect(await api.saved["deploy"] == nil)
    }

    @Test func marksSkillsThisMacSavedAndNoLongerHasAsDeleted() async throws {
        let api = FakeCloudSave(skills: [
            .init(key: "gone", currentVersion: .init(id: "r1", treeSha: "a", deviceId: "device-1", savedAt: "2026-01-01T00:00:00.000Z", labels: nil), deletedLocallyAt: nil),
            .init(key: "other-mac", currentVersion: .init(id: "r2", treeSha: "b", deviceId: "device-2", savedAt: "2026-01-01T00:00:00.000Z", labels: nil), deletedLocallyAt: nil)
        ])
        _ = try await sync(api).run(installations: [], localFolderKeys: nil, deviceID: "device-1", credential: credential())
        #expect(await api.deleted.isEmpty, "an incomplete scan never marks deletions")
        _ = try await sync(api).run(installations: [], localFolderKeys: [], deviceID: "device-1", credential: credential())
        #expect(await api.deleted == ["gone": true])
    }

    @Test func theSameSkillOnTwoAgentsIsSavedOnceFromTheNewestCopy() async throws {
        let claude = try temporaryRoot(), codex = try temporaryRoot()
        let older = try makeSkill(claude, "notes", skillMd: "---\nname: notes\ndescription: old\n---\n")
        let newer = try makeSkill(codex, "Notes", skillMd: "---\nname: notes\ndescription: new\n---\n",
                                  files: ["run.sh": "echo new"])
        // SKILL.md says the Claude copy is newer, but the Codex copy has the latest edit (to run.sh).
        try touch(older.appendingPathComponent("SKILL.md"), "2026-10-20T00:00:00Z")
        try touch(newer.appendingPathComponent("SKILL.md"), "2026-10-01T00:00:00Z")
        try touch(newer.appendingPathComponent("run.sh"), "2026-10-30T00:00:00Z")
        let api = FakeCloudSave()
        _ = try await sync(api).run(installations: [installation(older, modified: "2026-10-01T00:00:00Z"),
            installation(newer, modified: "2026-11-01T00:00:00Z")], localFolderKeys: [], deviceID: "device-1", credential: credential())
        let newest = try CloudSaveFolder.read(directory: newer).treeSha
        #expect(await api.saved == ["notes": newest])
    }

    @Test func differentSkillsInSameNameFoldersAreSavedApart() async throws {
        let claude = try temporaryRoot(), codex = try temporaryRoot()
        let library = try makeSkill(claude, "last30days", skillMd: "---\nname: last30days\ndescription: research\n---\n",
                                    files: ["scripts/run.py": "print(1)"])
        let spec = try makeSkill(codex, "last30days", skillMd: "---\nname: last30days-v3-spec\ndescription: spec\n---\n")
        // The cloud copy under the folder name is the Codex spec, saved by this Mac before the fix.
        let specTree = try CloudSaveFolder.read(directory: spec).treeSha
        let api = FakeCloudSave(skills: [.init(key: "last30days", currentVersion: .init(id: "r1", treeSha: specTree,
            deviceId: "device-1", savedAt: "2026-11-03T00:00:00.000Z", labels: nil), deletedLocallyAt: nil)])
        let installs = [installation(library, name: "last30days"),
                        installation(spec, name: "last30days-v3-spec", origin: "Codex")]
        let summary = try await sync(api).run(installations: installs, localFolderKeys: ["last30days"], deviceID: "device-1",
                                              credential: credential())
        #expect(await api.saved == ["last30days": try CloudSaveFolder.read(directory: library).treeSha,
                                    "last30days@codex": specTree])
        #expect(await api.names == ["last30days": "last30days", "last30days@codex": "last30days-v3-spec"])
        #expect(summary.hereCount == 2)
        #expect(summary.skillCount == 2)
        #expect(await api.deleted.isEmpty, "The spec's own key is on this Mac, so it isn't marked deleted")
        #expect(summary.keys == [library.path: "last30days", spec.path: "last30days@codex"])
    }

    @Test func aSkillKeepsItsKeyWhenTheOtherSameNameSkillIsDeleted() async throws {
        let claude = try temporaryRoot(), codex = try temporaryRoot()
        let spec = try makeSkill(codex, "last30days", skillMd: "---\nname: last30days-v3-spec\ndescription: spec\n---\n")
        let specTree = try CloudSaveFolder.read(directory: spec).treeSha
        let version = { (tree: String) in CloudSaveState.Version(id: "r", treeSha: tree, deviceId: "device-1",
                                                                 savedAt: "2026-11-03T00:00:00.000Z", labels: nil) }
        let api = FakeCloudSave(skills: [
            .init(key: "last30days", name: "last30days", currentVersion: version("a"), deletedLocallyAt: nil),
            .init(key: "last30days@codex", name: "last30days-v3-spec", currentVersion: version(specTree), deletedLocallyAt: nil),
        ])
        // The library copy in Claude was deleted; only the spec is left, in a folder named like the library's key.
        _ = claude
        let summary = try await sync(api).run(installations: [installation(spec, name: "last30days-v3-spec", origin: "Codex")],
            localFolderKeys: ["last30days"], lastKeys: [spec.path: "last30days@codex"], deviceID: "device-1",
            credential: credential())
        #expect(await api.saved.isEmpty, "Nothing is saved over the library skill")
        #expect(await api.deleted == ["last30days": true], "The library skill is kept, marked deleted on this Mac")
        #expect(summary.keys == [spec.path: "last30days@codex"])
    }

    @Test func aSkillLeftOutUnderItsFolderNameStaysLeftOutUnderItsOwnKey() async throws {
        let claude = try temporaryRoot(), codex = try temporaryRoot()
        let library = try makeSkill(claude, "last30days", skillMd: "---\nname: last30days\ndescription: research\n---\n")
        let spec = try makeSkill(codex, "last30days", skillMd: "---\nname: last30days-v3-spec\ndescription: spec\n---\n")
        let api = FakeCloudSave(excluded: ["last30days"])
        let summary = try await sync(api).run(installations: [installation(library, name: "last30days"),
            installation(spec, name: "last30days-v3-spec", origin: "Codex")], localFolderKeys: ["last30days"],
            deviceID: "device-1", credential: credential())
        #expect(await api.leftOut == ["last30days@codex"])
        #expect(await api.saved.isEmpty)
        #expect(summary.leftOutCount == 2)
    }

    @Test func aDifferentSkillSavedFromAnotherMacMovesToItsOwnKey() async throws {
        let codex = try temporaryRoot()
        let spec = try makeSkill(codex, "last30days", skillMd: "---\nname: last30days-v3-spec\ndescription: spec\n---\n")
        let api = FakeCloudSave()
        await api.take("last30days")
        let first = try await sync(api).run(installations: [installation(spec, name: "last30days-v3-spec", origin: "Codex")],
            localFolderKeys: ["last30days"], deviceID: "device-1", credential: credential())
        #expect(first.skipped.isEmpty, "Nothing is reported under the other skill's key")
        #expect(first.keys.isEmpty, "The refused key isn't remembered")
    }

    @Test func cloudKeysMatchTheServerRule() {
        let root = URL(fileURLWithPath: "/tmp/agents")
        func copy(_ agent: String, _ folder: String, _ name: String) -> Skill {
            installation(root.appendingPathComponent(agent).appendingPathComponent(folder), name: name, origin: agent)
        }
        let library = copy("Claude", "last30days", "last30days"), spec = copy("Codex", "last30days", "last30days-v3-spec")
        var keys = CloudSaveKeys.keys(for: [spec, library])
        #expect(keys[library.installCmd] == "last30days")
        #expect(keys[spec.installCmd] == "last30days@codex")

        let a = copy("Claude", "pdf", "PDF"), b = copy("Codex", "pdf", "pdf"), c = copy("Agents", "PDF", "PDF")
        keys = CloudSaveKeys.keys(for: [a, b, c])
        #expect([a, b, c].map { keys[$0.installCmd] } == ["pdf", "pdf", "pdf"], "Same name, any case, is one skill")

        let x = copy("Codex", "notes", "Writer"), y = copy("Agents", "notes", "Editor"), z = copy("Claude", "notes", "Editor")
        keys = CloudSaveKeys.keys(for: [x, y, z])
        #expect([y, z, x].map { keys[$0.installCmd] } == ["notes", "notes", "notes@codex"],
                "No copy named like the folder: the first agent's keeps it")

        // Long keys keep whole characters, counted as the server counts them (UTF-16).
        let long = String(repeating: "é", count: 191) + "😀😀"
        #expect(CloudSaveKeys.candidate(folder: long, agent: "codex", index: 1) == String(repeating: "é", count: 191) + "😀@codex")
        // A saved key whose folder part was cut to fit still belongs to its skill.
        let cut = CloudSaveKeys.candidate(folder: long, agent: "codex", index: 2)
        let longSpec = copy("Codex", long, "other")
        #expect(CloudSaveKeys.keys(for: [longSpec], records: [.init(key: long, name: long), .init(key: cut, name: "other")])[longSpec.installCmd] == cut)

        // Saved skills are found by name, on any Mac and in any agent.
        let records = [CloudSaveKeys.Record(key: "last30days", name: "last30days", deviceID: "mac-a"),
                       CloudSaveKeys.Record(key: "last30days@codex", name: "last30days-v3-spec", deviceID: "mac-a")]
        let elsewhere = copy("Agents", "last30days", "Last30days-v3-spec")
        #expect(CloudSaveKeys.keys(for: [elsewhere], records: records, deviceID: "mac-b")[elsewhere.installCmd] == "last30days@codex")
        // A Mac with only a new, different skill never takes a key another skill holds.
        let other = copy("Codex", "last30days", "something-else")
        #expect(CloudSaveKeys.keys(for: [other], records: records, deviceID: "mac-b")[other.installCmd] == "last30days@codex-2")

        // A remembered key stays put when another skill with that folder name shows up.
        let remembered = [spec.installCmd: "last30days"]
        keys = CloudSaveKeys.keys(for: [spec, library], records: [.init(key: "last30days", name: nil)], remembered: remembered)
        #expect(keys[spec.installCmd] == "last30days")
        #expect(keys[library.installCmd] == "last30days@claude")

        // An edited SKILL.md name keeps the key only on the Mac that saved it last.
        let renamed = copy("Claude", "last30days", "renamed")
        let held = [renamed.installCmd: "last30days"]
        #expect(CloudSaveKeys.keys(for: [renamed], records: records, remembered: held, deviceID: "mac-a")[renamed.installCmd]
                == "last30days")
        #expect(CloudSaveKeys.keys(for: [renamed], records: records, remembered: held, deviceID: "mac-b")[renamed.installCmd]
                == "last30days@claude")
    }

    @Test func filesSentOneAtATimeArePacedLikeEveryOtherRequest() async throws {
        actor Counter { var count = 0; func tick() { count += 1 } }
        let root = try temporaryRoot()
        let api = FakeCloudSave()
        let paces = Counter()
        let skill = try makeSkill(root, "notes", files: ["a.md": "a", "b.md": "b"])
        _ = try await CloudSaveSync(api: api, pace: { await paces.tick() }).run(installations: [installation(skill)],
            localFolderKeys: ["notes"], deviceID: "device-1", credential: credential())
        // Without batch upload: the first version request, one per batch attempt, one per file, the final save,
        // the added library skills, and the report of skills not saved.
        #expect(await api.calls.filter { $0.hasPrefix("upload:") }.count == 3)
        #expect(await paces.count == 1 + 1 + 3 + 1 + 1 + 1)
    }

    @Test func stopsWhenTheServerIsUnavailable() async throws {
        struct Down: CloudSaveServing {
            func state(credential: StoredDeviceCredential) async throws -> CloudSaveState { throw CloudSaveAPIError.unavailable }
            func setEnabled(_ enabled: Bool, credential: StoredDeviceCredential) async throws {}
            func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws {}
            func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult { .saved(created: false) }
            func markDeletedLocally(key: String, deleted: Bool, credential: StoredDeviceCredential) async throws {}
            func withdrawReview(key: String, credential: StoredDeviceCredential) async throws {}
        }
        let summary = try await CloudSaveSync(api: Down(), pace: {}).run(installations: [], localFolderKeys: [],
            deviceID: "device-1", credential: credential())
        #expect(summary.status == .unavailable)
    }
}

private func touch(_ url: URL, _ iso: String) throws {
    try FileManager.default.setAttributes([.modificationDate: ISO8601DateFormatter().date(from: iso)!], ofItemAtPath: url.path)
}

struct CloudSaveReviewFixTests {
    private func sync(_ api: FakeCloudSave) -> CloudSaveSync { CloudSaveSync(api: api, pace: {}) }

    @Test func aStaleCopyDoesNotReplaceANewerCloudSave() async throws {
        let root = try temporaryRoot()
        let notes = try makeSkill(root, "notes", skillMd: "---\nname: notes\ndescription: old\n---\n")
        try touch(notes.appendingPathComponent("SKILL.md"), "2026-10-01T00:00:00Z")
        let api = FakeCloudSave(skills: [.init(key: "notes", currentVersion: .init(id: "r1", treeSha: String(repeating: "a", count: 40),
            deviceId: "device-2", savedAt: "2026-11-01T00:00:00.000Z", labels: []), deletedLocallyAt: nil)])
        let summary = try await sync(api).run(installations: [installation(notes)], localFolderKeys: ["notes"],
            deviceID: "device-1", credential: credential())
        #expect(summary.olderHereCount == 1 && summary.uploadedCount == 0)
        #expect(await api.calls == ["state"])

        // Edited here after that save: it is saved.
        try touch(notes.appendingPathComponent("SKILL.md"), "2026-11-02T00:00:00Z")
        let edited = try await sync(api).run(installations: [installation(notes)], localFolderKeys: ["notes"],
            deviceID: "device-1", credential: credential())
        #expect(edited.uploadedCount == 1)
    }

    @Test func oneSkillTheServerRefusesDoesNotStopTheOthers() async throws {
        actor Refusing: CloudSaveServing {
            var saved: [String] = []
            func state(credential: StoredDeviceCredential) async throws -> CloudSaveState {
                CloudSaveState(settings: .init(enabled: true, excludedSkillKeys: []), usage: .init(bytes: 0, limitBytes: 1),
                               skills: [], needsReview: [])
            }
            func setEnabled(_ enabled: Bool, credential: StoredDeviceCredential) async throws {}
            func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws {}
            func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult {
                if folder.key == "a-bad" { throw CloudSaveAPIError.rejected("Invalid skill key") }
                if folder.key == "b-odd" { throw CloudSaveAPIError.invalidResponse }
                saved.append(folder.key)
                return .saved(created: true)
            }
            func markDeletedLocally(key: String, deleted: Bool, credential: StoredDeviceCredential) async throws {}
            func withdrawReview(key: String, credential: StoredDeviceCredential) async throws {}
        }
        let root = try temporaryRoot()
        let api = Refusing()
        let summary = try await CloudSaveSync(api: api, pace: {}).run(
            installations: [installation(try makeSkill(root, "a-bad")), installation(try makeSkill(root, "b-odd")),
                            installation(try makeSkill(root, "c-good"))],
            localFolderKeys: nil, deviceID: "device-1", credential: credential())
        #expect(await api.saved == ["c-good"])
        #expect(summary.status == .incomplete)
        #expect(Set(summary.skipped.keys) == ["a-bad", "b-odd"])
    }

    @Test func aHeldSkillIsReportedForReviewInTheSamePass() async throws {
        let root = try temporaryRoot()
        let deploy = try makeSkill(root, "deploy", files: ["config.env": "TOKEN=x"])
        let api = FakeCloudSave()
        let entries = try CloudSaveFolder.read(directory: deploy).entries
        await api.hold(try #require(entries.first { $0.path == "config.env" }).blobSha)
        _ = try await sync(api).run(installations: [installation(deploy)], localFolderKeys: ["deploy"],
            deviceID: "device-1", credential: credential())
        let versions = await api.calls.filter { $0 == "version:deploy" }
        #expect(versions.count == 2, "the second save asks the server to record the review")
    }

    @Test func deletionsUseFolderNamesAndOnlyTheSavingMacClearsTheMark() async throws {
        let api = FakeCloudSave(skills: [
            .init(key: "broken", currentVersion: .init(id: "r1", treeSha: "a", deviceId: "device-1",
                  savedAt: "2026-01-01T00:00:00.000Z", labels: nil), deletedLocallyAt: nil)
        ])
        // The folder is still there even though its SKILL.md no longer parses.
        _ = try await sync(api).run(installations: [], localFolderKeys: ["broken"], deviceID: "device-1", credential: credential())
        #expect(await api.deleted.isEmpty)

        let root = try temporaryRoot()
        let notes = try makeSkill(root, "notes")
        let tree = try CloudSaveFolder.read(directory: notes).treeSha
        let marked = FakeCloudSave(skills: [.init(key: "notes", currentVersion: .init(id: "r1", treeSha: tree,
            deviceId: "device-2", savedAt: "2026-01-01T00:00:00.000Z", labels: nil), deletedLocallyAt: "2026-11-01T00:00:00.000Z")])
        _ = try await sync(marked).run(installations: [installation(notes)], localFolderKeys: ["notes"],
            deviceID: "device-1", credential: credential())
        #expect(await marked.deleted.isEmpty, "another Mac's mark is left alone")
    }

    @Test func folderKeysAreUnknownWhenAFolderCantBeRead() throws {
        let root = try temporaryRoot()
        try makeSkill(root, "Notes")
        try FileManager.default.createDirectory(at: root.appendingPathComponent(".omgskills"), withIntermediateDirectories: true)
        #expect(CloudSaveController.folderKeys(in: [root, root.appendingPathComponent("missing")]) == ["notes"])
        #expect(CloudSaveController.folderKeys(in: [root.appendingPathComponent("Notes/SKILL.md")]) == nil)
    }

    @Test func thisMacsOwnEditsAlwaysSaveAndAnotherMacsSaveWaitsForAnEditHere() async throws {
        let root = try temporaryRoot()
        let notes = try makeSkill(root, "notes", files: ["a.txt": "a"])
        try touch(notes.appendingPathComponent("SKILL.md"), "2026-01-01T00:00:00Z")
        try touch(notes.appendingPathComponent("a.txt"), "2026-01-01T00:00:00Z")
        let other = String(repeating: "b", count: 40)
        func cloud(by device: String) -> FakeCloudSave {
            FakeCloudSave(skills: [.init(key: "notes", currentVersion: .init(id: "r1", treeSha: other, deviceId: device,
                savedAt: "2026-11-01T00:00:00.000Z", labels: []), deletedLocallyAt: nil)])
        }
        // Old file times, but the cloud copy is this Mac's own: a deletion or chmod here still saves.
        let mine = try await sync(cloud(by: "device-1")).run(installations: [installation(notes)], localFolderKeys: ["notes"],
            deviceID: "device-1", credential: credential())
        #expect(mine.uploadedCount == 1)

        let tree = try CloudSaveFolder.read(directory: notes).treeSha
        let unchanged = try await sync(cloud(by: "device-2")).run(installations: [installation(notes)], localFolderKeys: ["notes"],
            lastTrees: ["notes": tree], deviceID: "device-1", credential: credential())
        #expect(unchanged.olderHereCount == 1 && unchanged.uploadedCount == 0)
        #expect(unchanged.localTrees == ["notes": tree])

        // A file deleted here since the last pass changes the tree even though no file time moved on.
        try FileManager.default.removeItem(at: notes.appendingPathComponent("a.txt"))
        let deleted = try await sync(cloud(by: "device-2")).run(installations: [installation(notes)], localFolderKeys: ["notes"],
            lastTrees: ["notes": tree], deviceID: "device-1", credential: credential())
        #expect(deleted.uploadedCount == 1)
    }

    @Test func aHeldEditIsRetriedAfterConfirmationEvenOverAnotherMacsSave() async throws {
        let root = try temporaryRoot()
        let deploy = try makeSkill(root, "deploy", files: ["config.env": "TOKEN=x"])
        let api = FakeCloudSave(skills: [.init(key: "deploy", currentVersion: .init(id: "r1", treeSha: String(repeating: "c", count: 40),
            deviceId: "device-2", savedAt: "2026-11-01T00:00:00.000Z", labels: []), deletedLocallyAt: nil)])
        let secret = try #require(try CloudSaveFolder.read(directory: deploy).entries.first { $0.path == "config.env" })
        await api.hold(secret.blobSha)
        let previous = ["deploy": String(repeating: "d", count: 40)]
        let first = try await sync(api).run(installations: [installation(deploy)], localFolderKeys: ["deploy"],
            lastTrees: previous, deviceID: "device-1", credential: credential())
        #expect(first.needsReview == ["deploy"])
        #expect(first.localTrees == previous, "an unsettled copy keeps its earlier record")
        await api.release(secret.blobSha)
        let second = try await sync(api).run(installations: [installation(deploy)], localFolderKeys: ["deploy"],
            lastTrees: first.localTrees, deviceID: "device-1", credential: credential())
        #expect(second.uploadedCount == 1)
    }

    @Test func aReviewForASkillDeletedOnThisMacIsWithdrawnEvenWhenAnotherMacSavedIt() async throws {
        let api = FakeCloudSave(skills: [.init(key: "gone", currentVersion: .init(id: "r1", treeSha: "a", deviceId: "device-2",
            savedAt: "2026-11-01T00:00:00.000Z", labels: nil), deletedLocallyAt: nil)])
        await api.waiting([.init(key: "gone", deviceId: "device-1", files: [], confirmed: false),
                           .init(key: "elsewhere", deviceId: "device-2", files: [], confirmed: false)])
        _ = try await sync(api).run(installations: [], localFolderKeys: [], deviceID: "device-1", credential: credential())
        #expect(await api.withdrawn == ["gone"])
        #expect(await api.deleted.isEmpty, "the other Mac's saved copy isn't marked deleted")
    }

    @Test func keysMatchTheServerAndWebIncludingFinalSigma() {
        // Expected values come from JavaScript's toLowerCase(), which the server and web use.
        let names = ["ΟΔΟΣ\u{301}", "ΟΔΟΣ\u{301}Α", "ΟΔΟΣ", "ΟΔΟΣ-notes", "Σ", "ΑΣ'Β", "my ΣΟΦΙΑ", "İstanbul", "Straße", "ǅemal", "ΌΣΟΣ ΚΑΙ ΟΣΟΣ", "AΣ.b", "ΑΣ1"]
        let expected = ["οδος\u{301}", "οδοσ\u{301}α", "οδος", "οδος-notes", "σ", "ασ'β", "my σοφια", "i̇stanbul", "straße", "ǆemal", "όσος και οσος", "aσ.b", "ας1"]
        #expect(names.map(CloudSaveFolder.key(forFolderName:)) == expected)
    }

    @Test func keysAreNotTrimmed() {
        #expect(CloudSaveFolder.key(forFolderName: " Notes") == " notes")
        #expect(CloudSaveFolder.key(forFolderName: "Cafe\u{301}") == "café")
    }
}

private actor CloudSaveHTTPSession: DeviceHTTPSession {
    var responses: [(Int, String)]
    var requests: [URLRequest] = []
    init(_ responses: [(Int, String)]) { self.responses = responses }
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let (status, body) = responses.removeFirst()
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

struct CloudSaveAPITests {
    private let origin = URL(string: "https://omgskills.com")!

    @Test func savesAVersionAndReportsMissingFiles() async throws {
        let root = try temporaryRoot()
        let folder = try CloudSaveFolder.read(directory: try makeSkill(root, "My Notes"))
        let session = CloudSaveHTTPSession([(409, #"{"status":"missing_files","missing":["abc"]}"#), (201, #"{"status":"saved","created":true}"#)])
        let api = CloudSaveAPI(origin: origin, session: session)
        #expect(try await api.saveVersion(folder, credential: credential()) == .missingFiles(["abc"]))
        #expect(try await api.saveVersion(folder, credential: credential()) == .saved(created: true))
        let request = try #require(await session.requests.first)
        #expect(request.url?.absoluteString == "https://omgskills.com/api/portal/cloud-save/skills/my%20notes/versions")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer device_secret")
        let data = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["treeSha"] as? String == folder.treeSha)
        #expect((body["files"] as? [[String: Any]])?.first?["path"] as? String == "SKILL.md")
    }

    @Test func mapsHeldFilesAndRefusesUploadsWithoutPermission() async throws {
        let entry = SkillPackageEntry(path: "a", mode: "100644", data: Data("a".utf8),
                                      blobSha: SkillIdentityResolver.gitBlobSHA(for: Data("a".utf8)))
        let session = CloudSaveHTTPSession([(422, #"{"code":"needs_review","findings":[{"rule":"github_token","kind":"GitHub token","line":3}]}"#),
                                            (201, #"{"stored":true}"#)])
        let api = CloudSaveAPI(origin: origin, session: session)
        await #expect(throws: CloudSaveAPIError.needsReview([.init(rule: "github_token", kind: "GitHub token", line: 3)])) {
            try await api.uploadFile(entry, confirmSecrets: false, credential: credential())
        }
        try await api.uploadFile(entry, confirmSecrets: true, credential: credential())
        let confirmed = try #require(await session.requests.last)
        #expect(confirmed.value(forHTTPHeaderField: "X-Cloud-Save-Confirm") == "secrets-reviewed")
        #expect(confirmed.url?.path == "/api/portal/cloud-save/blobs/\(entry.blobSha)")
        await #expect(throws: CloudSaveAPIError.permissionRequired) {
            try await api.uploadFile(entry, confirmSecrets: false, credential: credential(scopes: [.syncWrite, .selfRevoke]))
        }
    }

    private func entry(_ path: String, _ data: Data) -> SkillPackageEntry {
        SkillPackageEntry(path: path, mode: "100644", data: data, blobSha: SkillIdentityResolver.gitBlobSHA(for: data))
    }

    @Test func uploadsASkillsFilesInOneRequestAndBigFilesOnTheirOwn() async throws {
        let small = [entry("a", Data("a".utf8)), entry("b", Data("b".utf8))]
        let big = entry("big", Data(repeating: 1, count: CloudSaveAPI.batchBytes + 1))
        let session = CloudSaveHTTPSession([
            (200, #"{"files":[{"blobSha":"x","status":"stored","labels":[]},{"blobSha":"y","status":"needs_review","findings":[{"rule":"github_token","kind":"GitHub token","line":2}]}]}"#),
            (201, #"{"stored":true}"#)
        ])
        let held = try await CloudSaveAPI(origin: origin, session: session).uploadFiles(small + [big], credential: credential())
        #expect(held == [.init(rule: "github_token", kind: "GitHub token", line: 2)])
        let requests = await session.requests
        #expect(requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" } == [
            "POST /api/portal/cloud-save/blobs", "PUT /api/portal/cloud-save/blobs/\(big.blobSha)"
        ])
        let sent = try #require(requests[0].httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: sent) as? [String: Any])
        let files = try #require(body["files"] as? [[String: String]])
        #expect(files.map { $0["blobSha"] } == small.map(\.blobSha))
        #expect(files.map { $0["data"] } == ["YQ==", "Yg=="])
    }

    @Test func aServerWithoutBatchUploadIsToldApartFromAFailingOne() async throws {
        let files = [entry("a", Data("a".utf8))]
        for (status, body) in [(404, #"{"error":"Not found"}"#), (200, "<!doctype html>")] {
            let session = CloudSaveHTTPSession([(status, body)])
            await #expect(throws: CloudSaveBatchUnsupported.self) {
                try await CloudSaveAPI(origin: origin, session: session).uploadFiles(files, credential: credential())
            }
        }
        let failing = CloudSaveHTTPSession([(422, #"{"error":"File contents do not match their hash","code":"blob_mismatch"}"#)])
        await #expect(throws: CloudSaveAPIError.rejected("File contents do not match their hash")) {
            try await CloudSaveAPI(origin: origin, session: failing).uploadFiles(files, credential: credential())
        }
    }

    @Test func decodesStateFromServersWithAndWithoutTheSafetyScan() async throws {
        let older = #"{"settings":{"enabled":true,"excludedSkillKeys":[]},"usage":{"bytes":1,"limitBytes":2},"skills":[]}"#
        let session = CloudSaveHTTPSession([(200, older), (503, #"{"error":"Cloud save is not available yet","code":"unavailable"}"#)])
        let api = CloudSaveAPI(origin: origin, session: session)
        #expect(try await api.state(credential: credential()).needsReview.isEmpty)
        await #expect(throws: CloudSaveAPIError.unavailable) { try await api.state(credential: credential()) }
    }
}

@MainActor
struct CloudSaveControllerTests {
    @Test func theSwitchShowsTheNewChoiceUntilThePassFinishes() async throws {
        let api = FakeCloudSave(enabled: false)
        let controller = CloudSaveController(api: api, credential: { credential() },
            scan: { InstalledSkillsScanner.ScanResult(skills: [], installations: [], summary: InstalledSkillSummary()) },
            folderKeys: { [] }, treeRecord: nil, pace: {})
        await controller.requestRun()?.value
        #expect(controller.summary?.status == .off && !controller.isEnabled)
        let change = controller.setEnabled(true)
        #expect(controller.isEnabled, "On right away, before the server answers")
        #expect(controller.shownSummary == nil, "No stale \"Not synced\" while turning on")
        await change?.value
        #expect(controller.pendingEnabled == nil && controller.isEnabled)
    }

    @Test func aPassOvertakenByANewerRequestDoesNotShowItsOldCount() async throws {
        actor Gate {
            var scans = 0
            var waiting: [CheckedContinuation<Void, Never>] = []
            func enter() async -> Int {
                scans += 1
                let n = scans
                await withCheckedContinuation { waiting.append($0) }
                return n
            }
            func open() { waiting.forEach { $0.resume() }; waiting = [] }
            func count() -> Int { scans }
        }
        let gate = Gate()
        let controller = CloudSaveController(api: FakeCloudSave(enabled: true), credential: { credential() },
            scan: {
                _ = await gate.enter()
                return InstalledSkillsScanner.ScanResult(skills: [], installations: [], summary: InstalledSkillSummary())
            },
            folderKeys: { [] }, treeRecord: nil, pace: {})
        let task = controller.requestRun()
        while await gate.count() < 1 { await Task.yield() }
        // A newer inventory report arrives while the first pass is still scanning.
        controller.requestRun()
        await gate.open()
        while await gate.count() < 2 { await Task.yield() }
        #expect(controller.summary == nil, "The overtaken pass must not publish its out-of-date summary")
        await gate.open()
        await task?.value
        #expect(controller.summary != nil, "The queued pass publishes")
    }

    @Test func aFailedPassAfterTurningOnKeepsTheSwitchOn() async throws {
        struct Flaky: CloudSaveServing {
            func state(credential: StoredDeviceCredential) async throws -> CloudSaveState { throw CloudSaveAPIError.unavailable }
            func setEnabled(_ enabled: Bool, credential: StoredDeviceCredential) async throws {}
            func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws {}
            func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult { .saved(created: false) }
            func markDeletedLocally(key: String, deleted: Bool, credential: StoredDeviceCredential) async throws {}
            func withdrawReview(key: String, credential: StoredDeviceCredential) async throws {}
        }
        let controller = CloudSaveController(api: Flaky(), credential: { credential() },
            scan: { InstalledSkillsScanner.ScanResult(skills: [], installations: [], summary: InstalledSkillSummary()) },
            folderKeys: { [] }, treeRecord: nil, pace: {})
        await controller.setEnabled(true)?.value
        #expect(controller.isEnabled, "The account is on even though the pass couldn't reach the server")
        await controller.setEnabled(false)?.value
        #expect(!controller.isEnabled && controller.shownSummary?.status == .off)
    }
}
