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

private func installation(_ directory: URL, modified: String = "2026-11-01T00:00:00Z") -> Skill {
    Skill(id: "installed:\(directory.path)", name: directory.lastPathComponent, description: "", githubUrl: "",
          installCmd: directory.path, authorHandle: "", tags: [], readmeSnippet: nil, stars: 0, lastUpdated: modified,
          firstSeen: "", skillMdSha: nil, installs: nil, trendingRank: nil, trendingSource: nil, origin: "Claude",
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
    var deleted: [String: Bool] = [:]
    var calls: [String] = []

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
    func setEnabled(_ enabled: Bool, credential: StoredDeviceCredential) async throws { calls.append("enabled:\(enabled)") }
    func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws {
        calls.append("upload:\(entry.path)")
        if let findings = held[entry.blobSha], !confirmSecrets { throw CloudSaveAPIError.needsReview(findings) }
        stored.insert(entry.blobSha)
    }
    func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult {
        calls.append("version:\(folder.key)")
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

    @Test func excludedSkillsAndUnchangedLibraryInstallsAreNotUploaded() async throws {
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
        #expect(summary.libraryCount == 1)
        #expect(summary.uploadedCount == 0)
        #expect(await api.calls == ["state"])

        // Editing the library skill makes it the user's own copy.
        try Data("---\nname: pdf\ndescription: mine\n---\n".utf8).write(to: library.appendingPathComponent("SKILL.md"))
        let edited = try await sync(api).run(installations: [installation(library)], localFolderKeys: [],
            deviceID: "device-1", credential: credential())
        #expect(edited.uploadedCount == 1)
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
