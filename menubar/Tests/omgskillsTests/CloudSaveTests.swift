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
}

struct CloudSaveSyncTests {
    private func sync(_ api: FakeCloudSave) -> CloudSaveSync { CloudSaveSync(api: api, pace: {}) }

    @Test func doesNothingWhileCloudSaveIsOff() async throws {
        let root = try temporaryRoot()
        let api = FakeCloudSave(enabled: false)
        let summary = try await sync(api).run(installations: [installation(try makeSkill(root, "notes"))],
            scanComplete: true, deviceID: "device-1", credential: credential())
        #expect(summary.status == .off)
        #expect(await api.calls == ["state"])
    }

    @Test func asksToReconnectWithoutTheUploadPermission() async throws {
        let api = FakeCloudSave()
        let summary = try await sync(api).run(installations: [], scanComplete: true, deviceID: "device-1",
            credential: credential(scopes: [.syncWrite, .selfRevoke, .contentRead]))
        #expect(summary.status == .permissionRequired)
    }

    @Test func savesNewSkillsUploadingOnlyMissingFilesAndSkipsUnchangedOnes() async throws {
        let root = try temporaryRoot()
        let notes = try makeSkill(root, "notes", files: ["a.txt": "a"])
        let api = FakeCloudSave()
        let first = try await sync(api).run(installations: [installation(notes)], scanComplete: true,
            deviceID: "device-1", credential: credential())
        #expect(first.status == .upToDate)
        #expect(first.uploadedCount == 1)
        let calls = await api.calls
        #expect(calls.first == "state" && calls[1] == "version:notes" && calls.last == "version:notes")
        #expect(Set(calls[2..<4]) == ["upload:SKILL.md", "upload:a.txt"])

        // Once the server's copy matches, a later pass sends nothing.
        let folder = try CloudSaveFolder.read(directory: notes)
        let synced = FakeCloudSave(skills: [.init(key: "notes", currentVersion: .init(id: "r1", treeSha: folder.treeSha,
            deviceId: "device-1", labels: []), deletedLocallyAt: nil)])
        let second = try await sync(synced).run(installations: [installation(notes)], scanComplete: true,
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
            scanComplete: true, deviceID: "device-1", credential: credential())
        #expect(summary.libraryCount == 1)
        #expect(summary.uploadedCount == 0)
        #expect(await api.calls == ["state"])

        // Editing the library skill makes it the user's own copy.
        try Data("---\nname: pdf\ndescription: mine\n---\n".utf8).write(to: library.appendingPathComponent("SKILL.md"))
        let edited = try await sync(api).run(installations: [installation(library)], scanComplete: true,
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
            scanComplete: true, deviceID: "device-1", credential: credential())
        #expect(summary.status == .incomplete)
        #expect(summary.needsReview == ["deploy"])
        #expect(summary.uploadedCount == 1)
        #expect(await api.saved["notes"] != nil)
        #expect(await api.saved["deploy"] == nil)
    }

    @Test func marksSkillsThisMacSavedAndNoLongerHasAsDeleted() async throws {
        let api = FakeCloudSave(skills: [
            .init(key: "gone", currentVersion: .init(id: "r1", treeSha: "a", deviceId: "device-1", labels: nil), deletedLocallyAt: nil),
            .init(key: "other-mac", currentVersion: .init(id: "r2", treeSha: "b", deviceId: "device-2", labels: nil), deletedLocallyAt: nil)
        ])
        _ = try await sync(api).run(installations: [], scanComplete: false, deviceID: "device-1", credential: credential())
        #expect(await api.deleted.isEmpty, "an incomplete scan never marks deletions")
        _ = try await sync(api).run(installations: [], scanComplete: true, deviceID: "device-1", credential: credential())
        #expect(await api.deleted == ["gone": true])
    }

    @Test func theSameSkillOnTwoAgentsIsSavedOnceFromTheNewestCopy() async throws {
        let claude = try temporaryRoot(), codex = try temporaryRoot()
        let older = try makeSkill(claude, "notes", skillMd: "---\nname: notes\ndescription: old\n---\n")
        let newer = try makeSkill(codex, "Notes", skillMd: "---\nname: notes\ndescription: new\n---\n")
        let api = FakeCloudSave()
        _ = try await sync(api).run(installations: [installation(older, modified: "2026-10-01T00:00:00Z"),
            installation(newer, modified: "2026-11-01T00:00:00Z")], scanComplete: true, deviceID: "device-1", credential: credential())
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
        }
        let summary = try await CloudSaveSync(api: Down(), pace: {}).run(installations: [], scanComplete: true,
            deviceID: "device-1", credential: credential())
        #expect(summary.status == .unavailable)
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

    @Test func decodesStateFromServersWithAndWithoutTheSafetyScan() async throws {
        let older = #"{"settings":{"enabled":true,"excludedSkillKeys":[]},"usage":{"bytes":1,"limitBytes":2},"skills":[]}"#
        let session = CloudSaveHTTPSession([(200, older), (503, #"{"error":"Cloud save is not available yet","code":"unavailable"}"#)])
        let api = CloudSaveAPI(origin: origin, session: session)
        #expect(try await api.state(credential: credential()).needsReview.isEmpty)
        await #expect(throws: CloudSaveAPIError.unavailable) { try await api.state(credential: credential()) }
    }
}
