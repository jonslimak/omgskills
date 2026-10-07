import Foundation
import Testing
@testable import HandoffCore
import HandoffTestSupport

private struct Fixture {
    let commit = String(repeating: "1", count: 40)
    let tree = "315d6f38e5d0c3ab41809ba1c188e25eab45b5a1"
    let skillSHA = "6d2190081ae23aae9b09e89d10a3e1f57c3bb398"
    let repo = "test/skills"
    let rootPath = "example"
    var entries: [SkillPackageEntry] {
        [entry("SKILL.md", "---\nname: example\ndescription: Example package.\n---\n"),
         entry("scripts/run.sh", "#!/bin/sh\necho hello\n", mode: "100755"),
         entry("references/info.txt", "reference\n")]
    }
    var package: SkillPackage {
        SkillPackage(coordinates: SkillPackageCoordinates(commitSha: commit, treeSha: tree, skillMdSha: skillSHA), entries: entries)
    }
    var pin: PublicPin {
        get throws {
            try PublicPin(id: HandoffRequest.pinnedTestSkillID, repo: repo, path: rootPath,
                          commit: commit, skillSHA: skillSHA, treeSHA: tree)
        }
    }
    var request: HandoffRequest {
        HandoffRequest.parseTest("omgskills-helper-test://install?id=\(HandoffRequest.pinnedTestSkillID)")!
    }

    func entry(_ path: String, _ text: String, mode: String = "100644") -> SkillPackageEntry {
        let data = Data(text.utf8)
        return SkillPackageEntry(path: path, mode: mode, data: data, blobSha: SkillIdentityResolver.gitBlobSHA(for: data))
    }

    func metadata(pinned: Bool = true) throws -> Data {
        try json(["jsonrpc": "2.0", "id": 1, "result": ["structuredContent": ["found": true, "skill": [
            "id": request.skillID, "github_url": "https://github.com/\(repo)",
            "skill_md_path": "example/SKILL.md", "skill_md_sha": skillSHA,
            "install_status": pinned ? "pinned" : "discovery_only",
            "pinned_install": ["repo": repo, "path": rootPath, "commit_sha": commit,
                               "skill_md_sha": skillSHA, "skill_tree_sha": tree]
        ]]]])
    }

    func routes() throws -> [String: Data] {
        let prefix = "https://api.github.com/repos/\(repo)/git/"
        let rootSHA = objectTreeSHA(name: rootPath, mode: "40000", sha: tree)
        let rootEntry: [String: Any] = ["path": rootPath, "mode": "040000", "type": "tree", "sha": tree]
        var result = [
            "https://omgskills.com/mcp": try metadata(),
            prefix + "commits/\(commit)": try json(["sha": commit, "tree": ["sha": rootSHA]]),
            prefix + "trees/\(rootSHA)": try json(["sha": rootSHA, "truncated": false, "tree": [rootEntry]]),
            prefix + "trees/\(tree)?recursive=1": try json(["sha": tree, "truncated": false, "tree": entries.map {
                ["path": $0.path, "mode": $0.mode, "type": "blob", "sha": $0.blobSha, "size": $0.data.count] as [String: Any]
            }])
        ]
        for entry in entries {
            result[prefix + "blobs/\(entry.blobSha)"] = try json([
                "sha": entry.blobSha, "size": entry.data.count, "encoding": "base64", "content": entry.data.base64EncodedString()
            ])
        }
        return result
    }

    func objectTreeSHA(name: String, mode: String, sha: String) -> String {
        var data = Data("\(mode) \(name)\0".utf8)
        let chars = Array(sha)
        for index in stride(from: 0, to: chars.count, by: 2) {
            data.append(UInt8(String(chars[index...index + 1]), radix: 16)!)
        }
        return GitObjectHash.sha(type: "tree", data: data)
    }
}

private func json(_ object: Any) throws -> Data { try JSONSerialization.data(withJSONObject: object) }

private actor StubHTTP: PublicHTTPClient {
    let routes: [String: Data]
    private(set) var requests: [URLRequest] = []
    init(_ routes: [String: Data]) { self.routes = routes }
    func data(for request: URLRequest, limit: Int) async throws -> Data {
        try Task.checkCancellation()
        requests.append(request)
        guard let data = routes[request.url!.absoluteString] else { throw PreviewFailure.unavailable }
        guard data.count <= limit else { throw PreviewFailure.tooLarge }
        return data
    }
}

private actor SuspendedHTTP: PublicHTTPClient {
    let routes: [String: Data]
    private var blocked = false
    private var waiter: CheckedContinuation<Void, Never>?
    init(_ routes: [String: Data]) { self.routes = routes }
    func data(for request: URLRequest, limit: Int) async throws -> Data {
        if request.url!.path.contains("/blobs/") {
            blocked = true
            waiter?.resume()
            waiter = nil
            try await Task.sleep(for: .seconds(3600))
            throw PreviewFailure.unavailable
        }
        return routes[request.url!.absoluteString]!
    }
    func waitForBlob() async {
        if blocked { return }
        await withCheckedContinuation { waiter = $0 }
    }
}

private actor TestGate {
    private var entered = false
    private var waiter: CheckedContinuation<Void, Never>?
    private var release: CheckedContinuation<Void, Never>?
    func enter() async {
        entered = true
        await withCheckedContinuation {
            release = $0
            waiter?.resume()
            waiter = nil
        }
    }
    func waitForEntry() async {
        if entered { return }
        await withCheckedContinuation { waiter = $0 }
    }
    func open() { release?.resume(); release = nil }
}

struct PublicPackageTests {
    @Test func resolvesDownloadsAndVerifiesCompleteNestedPackage() async throws {
        let f = Fixture()
        let http = StubHTTP(try f.routes())
        let loader = PublicPackageLoader(http: http)
        let pin = try await loader.resolve(f.request)
        #expect(pin == (try f.pin))
        let package = try await loader.fetch(pin)
        #expect(package == f.package)
        #expect(package.entries.count == 3)
        let calls = await http.requests
        #expect(calls.count == 7)
        #expect(calls.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil })
    }

    @Test func refusesUnpinnedCatalogWithoutGitHubCalls() async throws {
        let f = Fixture()
        let http = StubHTTP(["https://omgskills.com/mcp": try f.metadata(pinned: false)])
        await #expect(throws: PreviewFailure.unpinned) {
            try await PublicPackagePreviewService(http: http).preview(f.request)
        }
        #expect(await http.requests.count == 1)
    }

    @Test(arguments: ["identity", "commit", "root", "truncated", "missing", "blob", "base64", "path", "symlink", "submodule", "oversize", "duplicates"])
    func refusesCorruptDelivery(_ mutation: String) async throws {
        let f = Fixture()
        var routes = try f.routes()
        let prefix = "https://api.github.com/repos/\(f.repo)/git/"
        let treeURL = prefix + "trees/\(f.tree)?recursive=1"
        if mutation == "identity" {
            var envelope = try JSONSerialization.jsonObject(with: f.metadata()) as! [String: Any]
            var result = envelope["result"] as! [String: Any]
            var content = result["structuredContent"] as! [String: Any]
            var skill = content["skill"] as! [String: Any]
            skill["id"] = "other:skill"
            content["skill"] = skill
            result["structuredContent"] = content
            envelope["result"] = result
            routes["https://omgskills.com/mcp"] = try json(envelope)
        } else if mutation == "commit" {
            routes.removeValue(forKey: prefix + "commits/\(f.commit)")
        } else if mutation == "root" {
            let rootKey = routes.keys.first { $0.contains("trees/") && !$0.contains("recursive") }!
            routes[rootKey] = try json(["sha": "bad", "tree": [], "truncated": false])
        } else if mutation == "blob" || mutation == "base64" {
            let entry = f.entries[0]
            routes[prefix + "blobs/\(entry.blobSha)"] = try json([
                "sha": entry.blobSha, "size": entry.data.count, "encoding": "base64",
                "content": mutation == "base64" ? "!!!" : Data(repeating: 0, count: entry.data.count).base64EncodedString()
            ])
        } else {
            var object = try #require(JSONSerialization.jsonObject(with: routes[treeURL]!) as? [String: Any])
            var entries = object["tree"] as! [[String: Any]]
            switch mutation {
            case "truncated": object["truncated"] = true
            case "missing": entries.removeLast()
            case "path": entries[0]["path"] = "../escape"
            case "symlink": entries[0]["mode"] = "120000"
            case "submodule": entries[0]["mode"] = "160000"; entries[0]["type"] = "commit"
            case "oversize": entries[0]["size"] = 100_000_000
            case "duplicates": entries.append(entries[0])
            default: break
            }
            object["tree"] = entries
            routes[treeURL] = try json(object)
        }
        await #expect(throws: (any Error).self) {
            try await PublicPackagePreviewService(http: StubHTTP(routes)).preview(f.request)
        }
    }

    @Test(arguments: ["../escape", "/SKILL.md", ".git/config", "a\\b", "x//y", "a\nb", ""])
    func refusesUnsafePathsBeforeStaging(_ path: String) throws {
        let f = Fixture()
        let package = SkillPackage(coordinates: f.package.coordinates, entries: [f.entry(path, "unsafe")])
        #expect(throws: SkillPackageValidationError.self) {
            try PublicPackagePreviewService.stageAndVerify(package, pin: f.pin)
        }
    }

    @Test func sharedValidatorRejectsCaseAndUnicodeCollisionsAndLinkModes() throws {
        let f = Fixture()
        let candidates = [
            f.entries + [f.entry("Scripts/other", "case collision")],
            f.entries + [f.entry("caf\u{00e9}", "a"), f.entry("cafe\u{0301}", "b")],
            [f.entry("SKILL.md", "link", mode: "120000")],
            [f.entry("SKILL.md", "submodule", mode: "160000")]
        ]
        for entries in candidates {
            #expect(throws: SkillPackageValidationError.self) {
                try PublicPackagePreviewService.stageAndVerify(
                    SkillPackage(coordinates: f.package.coordinates, entries: entries), pin: f.pin)
            }
        }
    }

    @Test func stageReadbackCleansOnlyItsOwnDirectory() throws {
        let f = Fixture()
        let fm = FileManager.default
        let parent = fm.temporaryDirectory.appendingPathComponent("omgskills-h1-test-\(UUID())")
        try fm.createDirectory(at: parent, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: parent) }
        let sentinel = parent.appendingPathComponent("existing-skill")
        try Data("unchanged".utf8).write(to: sentinel)
        let preview = try PublicPackagePreviewService.stageAndVerify(f.package, pin: f.pin, parent: parent)
        #expect(preview.commit == f.commit)
        #expect(preview.files.count == 3)
        #expect(try fm.contentsOfDirectory(atPath: parent.path) == ["existing-skill"])
        #expect(try Data(contentsOf: sentinel) == Data("unchanged".utf8))
    }

    @Test func stagingRejectsDifferentPin() throws {
        let f = Fixture()
        let wrongPin = try PublicPin(id: "test", repo: f.repo, path: f.rootPath,
                                    commit: String(repeating: "2", count: 40), skillSHA: f.skillSHA, treeSHA: f.tree)
        #expect(throws: SkillPackageValidationError.self) {
            try PublicPackagePreviewService.stageAndVerify(f.package, pin: wrongPin)
        }
    }

    @Test func enforcesStreamingByteLimitWithoutContentLength() async throws {
        let bytes = AsyncStream<UInt8> { continuation in
            for _ in 0..<5 { continuation.yield(0) }
            continuation.finish()
        }
        await #expect(throws: PreviewFailure.tooLarge) { try await BoundedPublicHTTP.collect(bytes, limit: 4) }
    }

    @Test(arguments: [301, 302, 307, 404, 410, 429, 500])
    func refusesHTTPFailures(_ code: Int) throws {
        let response = HTTPURLResponse(url: URL(string: "https://api.github.com")!, statusCode: code,
                                       httpVersion: nil, headerFields: nil)!
        #expect(throws: PreviewFailure.self) { try BoundedPublicHTTP.check(response, limit: 100) }
    }

    @Test func reportsRateLimitAndOversizedHeaders() throws {
        let url = URL(string: "https://api.github.com")!
        let limited = HTTPURLResponse(url: url, statusCode: 403, httpVersion: nil,
                                      headerFields: ["X-RateLimit-Remaining": "0", "Retry-After": "60"])!
        #expect(throws: PreviewFailure.rateLimited("60 seconds")) { try BoundedPublicHTTP.check(limited, limit: 100) }
        let large = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Length": "101"])!
        #expect(throws: PreviewFailure.tooLarge) { try BoundedPublicHTTP.check(large, limit: 100) }
    }

    @Test func neverAcceptsArbitraryOrigins() async throws {
        await #expect(throws: PreviewFailure.invalidMetadata) {
            try await BoundedPublicHTTP().data(for: URLRequest(url: URL(string: "https://evil.example/blob")!), limit: 100)
        }
    }

    @Test func cancellationInterruptsAnInFlightBlobRequest() async throws {
        let f = Fixture()
        let http = SuspendedHTTP(try f.routes())
        let task = Task { try await PublicPackagePreviewService(http: http).preview(f.request) }
        await http.waitForBlob()
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test func cancellationCleansOwnedStagingDirectory() async throws {
        let f = Fixture()
        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("omgskills-h1-cancel-\(UUID())")
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: parent) }
        let gate = TestGate()
        let task = Task {
            await gate.enter()
            return try PublicPackagePreviewService.stageAndVerify(f.package, pin: f.pin, parent: parent)
        }
        await gate.waitForEntry()
        task.cancel()
        await gate.open()
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(try FileManager.default.contentsOfDirectory(atPath: parent.path).isEmpty)
    }

    @Test(arguments: ["main", "latest", "../../escape", "https://evil.example", "x?ref=main"])
    func refusesInvalidPins(_ value: String) {
        let f = Fixture()
        #expect(throws: PreviewFailure.invalidMetadata) {
            try PublicPin(id: "test", repo: f.repo, path: f.rootPath, commit: value, skillSHA: f.skillSHA, treeSHA: nil)
        }
        #expect(throws: PreviewFailure.invalidMetadata) {
            try PublicPin(id: "test", repo: value, path: f.rootPath, commit: f.commit, skillSHA: f.skillSHA, treeSHA: nil)
        }
    }

    @Test func rejectsTooManyFilesBeforeDownloadingBlobs() async throws {
        let f = Fixture()
        var routes = try f.routes()
        let treeURL = "https://api.github.com/repos/\(f.repo)/git/trees/\(f.tree)?recursive=1"
        routes[treeURL] = try json(["sha": f.tree, "truncated": false, "tree": (0..<101).map { index in
            ["path": "file\(index)", "mode": "100644", "type": "blob", "sha": f.skillSHA, "size": 0] as [String: Any]
        }])
        let http = StubHTTP(routes)
        await #expect(throws: PreviewFailure.tooLarge) {
            try await PublicPackagePreviewService(http: http).preview(f.request)
        }
        #expect(await http.requests.allSatisfy { !$0.url!.path.contains("/blobs/") })
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["OMGSKILLS_H1_LIVE_TEST"] == "1"))
    func livePublicPreview() async throws {
        let preview = try await PublicPackagePreviewService().preview(Fixture().request)
        #expect(!preview.files.isEmpty)
        #expect(preview.files.contains { $0.path == "SKILL.md" })
        print("H1_LIVE_PREVIEW " + String(decoding: try JSONEncoder().encode(preview), as: UTF8.self))
    }
}
