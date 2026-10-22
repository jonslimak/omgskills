import CryptoKit
import Foundation
import Testing
@testable import omgskills

struct HTTPPublicSkillPackageFetcherTests {
    @Test(arguments: [".", "skills/example", "guides/caf\u{00e9} %?#/example"])
    func resolvesWithoutCatalogPinsOrGit(root: String) async throws {
        let fixture = try HTTPPackageFixture(root: root)
        let client = HTTPFixtureClient(routes: fixture.routes)
        let package = try await HTTPPublicSkillPackageFetcher(http: client).resolvePackage(fixture.request)
        #expect(package == fixture.package)
        let calls = await client.calls
        let depth = root == "." ? 0 : root.split(separator: "/").count
        #expect(calls.filter { $0.url?.host == "api.github.com" }.count == depth + 2)
        #expect(calls.filter { $0.url?.host == "raw.githubusercontent.com" }.count == package.entries.count)
        #expect(calls.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil })
        #expect(calls.allSatisfy { !($0.url?.path.contains("/blobs/") ?? true) })
        #expect(calls.last?.url?.absoluteString.contains(fixture.package.coordinates.commitSha) == true)
    }

    @Test func explicitVersionRemainsPinnedAfterLatestChanges() async throws {
        let a = try HTTPPackageFixture()
        let b = try HTTPPackageFixture(version: "b")
        let client = HTTPFixtureClient(routes: a.routes.merging(b.routes) { _, b in b })
        let fetcher = HTTPPublicSkillPackageFetcher(http: client)
        #expect(try await fetcher.resolvePackage(a.request) == b.package)
        let request = try PublicSkillInstallRequest(catalogID: a.request.catalogID,
            repositorySlug: a.request.repositorySlug, skillMDPath: a.request.skillMDPath,
            commitSha: a.package.coordinates.commitSha)
        #expect(try await fetcher.resolvePackage(request) == a.package)
        #expect(try await fetcher.fetchPackage(repositorySlug: "owner/repo", normalizedRoot: a.root,
                                             expected: a.package.coordinates) == a.package)
        let uppercase = SkillPackageCoordinates(commitSha: a.package.coordinates.commitSha.uppercased(),
            treeSha: a.package.coordinates.treeSha.uppercased(), skillMdSha: a.package.coordinates.skillMdSha.uppercased())
        #expect(try await fetcher.fetchPackage(repositorySlug: "owner/repo", normalizedRoot: a.root, expected: uppercase) == a.package)
    }

    @Test(arguments: ["commit", "tree", "skill"])
    func checksEveryExplicitPin(field: String) async throws {
        let fixture = try HTTPPackageFixture()
        let original = fixture.package.coordinates
        let expected = SkillPackageCoordinates(commitSha: original.commitSha,
            treeSha: field == "tree" ? String(repeating: "0", count: 40) : original.treeSha,
            skillMdSha: field == "skill" ? String(repeating: "0", count: 40) : original.skillMdSha)
        var routes = fixture.routes
        if field == "commit" {
            routes[fixture.api + "/git/commits/" + original.commitSha] = try json([
                "sha": String(repeating: "0", count: 40), "tree": ["sha": fixture.rootSHA]
            ])
        }
        let client = HTTPFixtureClient(routes: routes)
        await #expect(throws: (any Error).self) {
            try await HTTPPublicSkillPackageFetcher(http: client).fetchPackage(repositorySlug: "owner/repo",
                normalizedRoot: fixture.root, expected: expected)
        }
        #expect(await client.calls.allSatisfy { $0.url?.host == "api.github.com" })
    }

    @Test func binaryDownloadDoesNotBypassExistingReviewLimit() async throws {
        let fixture = try HTTPPackageFixture()
        let package = try await HTTPPublicSkillPackageFetcher(http: HTTPFixtureClient(routes: fixture.routes)).resolvePackage(fixture.request)
        #expect(package == fixture.package)
        #expect(throws: PublicSkillReviewError.unreviewable) {
            try PublicSkillPackageReview.changes(from: nil, to: package)
        }
    }

    @Test(arguments: ["blob", "short", "missing", "commit", "ancestor", "truncated", "tree", "malformed"])
    func rejectsIncompleteOrCorruptResponses(kind: String) async throws {
        let fixture = try HTTPPackageFixture()
        var routes = fixture.routes
        switch kind {
        case "blob": routes[fixture.raw("SKILL.md")] = Data(repeating: 0, count: fixture.package.entries[0].data.count)
        case "short": routes[fixture.raw("SKILL.md")] = Data()
        case "missing": routes.removeValue(forKey: fixture.raw("SKILL.md"))
        case "commit": routes[fixture.latest] = try json([["sha": "wrong", "commit": ["tree": ["sha": fixture.rootSHA]]]])
        case "ancestor": routes[fixture.treeURL(fixture.rootSHA)] = try json(["sha": fixture.rootSHA, "truncated": false, "tree": []])
        case "truncated": routes[fixture.selected] = try fixture.selectedData(truncated: true)
        case "tree": routes[fixture.selected] = try fixture.selectedData(entries: fixture.metadata.filter { $0["path"] as? String != "scripts/run.sh" })
        default: routes[fixture.latest] = Data("{".utf8)
        }
        await #expect(throws: (any Error).self) {
            try await HTTPPublicSkillPackageFetcher(http: HTTPFixtureClient(routes: routes)).resolvePackage(fixture.request)
        }
    }

    @Test(arguments: ["symlink", "submodule", "unsafe-path", "duplicate", "missing-skill", "oversize", "negative-size", "directory-mode"])
    func refusesUnsafeMetadataBeforeRawDownload(kind: String) async throws {
        let fixture = try HTTPPackageFixture()
        var metadata = fixture.metadata
        switch kind {
        case "symlink": metadata[0]["mode"] = "120000"
        case "submodule": metadata[0]["mode"] = "160000"; metadata[0]["type"] = "commit"
        case "unsafe-path": metadata[0]["path"] = "../outside"
        case "duplicate": metadata.append(metadata[0])
        case "missing-skill": metadata.removeAll { $0["path"] as? String == "SKILL.md" }
        case "oversize": metadata[0]["size"] = 60 * 1024 * 1024
        case "negative-size": metadata[0]["size"] = -1
        default: metadata[0]["type"] = "tree"
        }
        var routes = fixture.routes
        routes[fixture.selected] = try fixture.selectedData(entries: metadata)
        let client = HTTPFixtureClient(routes: routes)
        await #expect(throws: (any Error).self) {
            try await HTTPPublicSkillPackageFetcher(http: client).resolvePackage(fixture.request)
        }
        #expect(await client.calls.allSatisfy { $0.url?.host == "api.github.com" })
    }

    @Test(arguments: ["file-count", "total", "file", "skill"])
    func enforcesConfiguredLimitsBeforeRawDownload(kind: String) async throws {
        let fixture = try HTTPPackageFixture()
        let limits = SkillPackageValidationLimits(maximumFileCount: kind == "file-count" ? 1 : 512,
            maximumTotalBytes: kind == "total" ? 1 : 10000, maximumFileBytes: kind == "file" ? 1 : 10000,
            maximumSkillMdBytes: kind == "skill" ? 1 : 10000)
        let client = HTTPFixtureClient(routes: fixture.routes)
        await #expect(throws: SkillPackageValidationError.self) {
            try await HTTPPublicSkillPackageFetcher(http: client, limits: limits).resolvePackage(fixture.request)
        }
        #expect(await client.calls.allSatisfy { $0.url?.host == "api.github.com" })
    }

    @Test func rejectsBadCoordinatesAndRootsBeforeNetwork() async throws {
        let fixture = try HTTPPackageFixture()
        let client = HTTPFixtureClient(routes: fixture.routes)
        let fetcher = HTTPPublicSkillPackageFetcher(http: client)
        for root in ["../outside", "/absolute", "a//b", "a/.git", String(repeating: "a/", count: 33) + "b"] {
            await #expect(throws: PublicGitHubHTTPError.invalidMetadata) {
                try await fetcher.fetchPackage(repositorySlug: "owner/repo", normalizedRoot: root,
                                               expected: fixture.package.coordinates)
            }
        }
        await #expect(throws: SkillPackageValidationError.self) {
            try await fetcher.fetchPackage(repositorySlug: "owner/repo", normalizedRoot: ".",
                expected: SkillPackageCoordinates(commitSha: "bad", treeSha: "bad", skillMdSha: "bad"))
        }
        #expect(await client.calls.isEmpty)
    }

    @Test func preservesExistingValidatorCollisionChecks() async throws {
        let fixture = try HTTPPackageFixture(extra: [GroupSkillPackageTestSupport.entry(path: "skill.md", data: Data("other".utf8))])
        await #expect(throws: SkillPackageValidationError(code: .caseCollision, path: "skill.md")) {
            try await HTTPPublicSkillPackageFetcher(http: HTTPFixtureClient(routes: fixture.routes)).resolvePackage(fixture.request)
        }
    }

    @Test func matchesGitFetcherForRealGitObjectsAndExecutableBytes() async throws {
        let repository = try LocalGitPackageRepository()
        defer { repository.remove() }
        let source = try PublicSkillInstallRequest(catalogID: "test", repositorySlug: "owner/repo", skillMDPath: "skills/example/SKILL.md")
        let git = GitPublicSkillPackageFetcher(temporaryRoot: repository.temporaryRoot, remoteURL: { _ in repository.repositoryRoot })
        let a = try await git.resolvePackage(source)
        let httpA = try HTTPPackageFixture(package: a)
        try repository.advanceReference()
        let b = try await git.resolvePackage(source)
        let httpB = try HTTPPackageFixture(package: b)
        let client = HTTPFixtureClient(routes: httpA.routes.merging(httpB.routes) { _, b in b })
        let http = HTTPPublicSkillPackageFetcher(http: client)
        #expect(try await http.resolvePackage(source) == b)
        #expect(try await http.fetchPackage(repositorySlug: "owner/repo", normalizedRoot: "skills/example", expected: a.coordinates) == a)
        #expect(a.entries.first { $0.path == "scripts/run.sh" }?.mode == "100755")
        #expect(a.coordinates.treeSha != b.coordinates.treeSha)
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["OMGSKILLS_HTTP_PACKAGE_LIVE_TEST"] == "1"))
    func livePublicSourceMatchesGitAtResolvedCommit() async throws {
        let source = try PublicSkillInstallRequest(catalogID: "vercel-labs/agent-skills:skills/writing-guidelines",
            repositorySlug: "vercel-labs/agent-skills", skillMDPath: "skills/writing-guidelines/SKILL.md")
        let client = CountingLiveGitHubHTTP()
        let package = try await HTTPPublicSkillPackageFetcher(http: client).resolvePackage(source)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("omgskills-http-live-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { removeHTTPTestRoot(root) }
        let baseline = try await GitPublicSkillPackageFetcher(temporaryRoot: root).fetchPackage(
            repositorySlug: source.repositorySlug, normalizedRoot: source.packageRoot, expected: package.coordinates)
        #expect(package == baseline)
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
        let calls = await client.calls
        #expect(calls.filter { $0.url?.host == "api.github.com" }.count == 4)
        #expect(calls.filter { $0.url?.host == "raw.githubusercontent.com" }.count == package.entries.count)
        print("HTTP parity: commit=\(package.coordinates.commitSha) tree=\(package.coordinates.treeSha) files=\(package.entries.count) bytes=\(package.entries.reduce(0) { $0 + $1.data.count }) apiRequests=4 rawRequests=\(package.entries.count)")
    }

    @Test func installRepeatUpdateAndReviewCancellationUseExistingWriter() async throws {
        let a = try HTTPPackageFixture(includeBinary: false)
        let b = try HTTPPackageFixture(version: "b", includeBinary: false)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("omgskills-http-writer-\(UUID())")
        defer { removeHTTPTestRoot(root) }
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let writer = ManagedSkillInstaller(managedRoot: root.appendingPathComponent("managed"), pathAnchor: paths.homeDirectory)
        let target = paths.codexSkillsRoot.appendingPathComponent(a.request.targetName)
        let first = try await HTTPPublicSkillPackageFetcher(http: HTTPFixtureClient(routes: a.routes)).resolvePackage(a.request)
        let review = try await writer.preparePublicInstall(a.request, package: first, filesystemPaths: paths)
        #expect(!FileManager.default.fileExists(atPath: target.path))
        #expect(try await writer.applyPublicInstall(reviewID: review.id) == .install)
        let linkA = try FileManager.default.destinationOfSymbolicLink(atPath: target.path)
        let repeated = try await writer.preparePublicInstall(a.request, package: first, filesystemPaths: paths)
        #expect(try await writer.applyPublicInstall(reviewID: repeated.id) == .unchanged)
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: target.path) == linkA)
        let second = try await HTTPPublicSkillPackageFetcher(http: HTTPFixtureClient(routes: b.routes)).resolvePackage(b.request)
        let cancelled = try await writer.preparePublicInstall(b.request, package: second, filesystemPaths: paths)
        await writer.cancelPublicInstall(reviewID: cancelled.id)
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: target.path) == linkA)
        let update = try await writer.preparePublicInstall(b.request, package: second, filesystemPaths: paths)
        #expect(update.action == .update)
        #expect(try await writer.applyPublicInstall(reviewID: update.id) == .update)
        for file in second.entries {
            #expect(try Data(contentsOf: target.appendingPathComponent(file.path)) == file.data)
            #expect(FileManager.default.isExecutableFile(atPath: target.appendingPathComponent(file.path).path) == (file.mode == "100755"))
        }
        #expect(SkillInstallProvenanceStore.read(targetRoot: paths.codexSkillsRoot, targetName: b.request.targetName)?.commitSha == second.coordinates.commitSha)
    }

    @Test(arguments: ["cancel", "missing", "corrupt", "offline", "rate-limit"])
    func failedDownloadCannotChangeInstalledVersion(kind: String) async throws {
        let a = try HTTPPackageFixture(includeBinary: false)
        let b = try HTTPPackageFixture(version: "b", includeBinary: false)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("omgskills-http-failure-\(UUID())")
        defer { removeHTTPTestRoot(root) }
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let writer = ManagedSkillInstaller(managedRoot: root.appendingPathComponent("managed"), pathAnchor: paths.homeDirectory)
        let first = try await HTTPPublicSkillPackageFetcher(http: HTTPFixtureClient(routes: a.routes)).resolvePackage(a.request)
        let review = try await writer.preparePublicInstall(a.request, package: first, filesystemPaths: paths)
        _ = try await writer.applyPublicInstall(reviewID: review.id)
        let target = paths.codexSkillsRoot.appendingPathComponent(a.request.targetName)
        let link = try FileManager.default.destinationOfSymbolicLink(atPath: target.path)
        let recordURL = URL(fileURLWithPath: link).deletingLastPathComponent().appendingPathComponent("provenance.json")
        let record = try Data(contentsOf: recordURL)
        var routes = b.routes
        let lastRaw = b.raw("scripts/run.sh")
        if kind == "missing" { routes.removeValue(forKey: lastRaw) }
        if kind == "corrupt" { routes[lastRaw] = Data("wrong".utf8) }
        let started = AsyncStream<Void>.makeStream()
        let release = AsyncStream<Void>.makeStream()
        defer { started.continuation.finish(); release.continuation.finish() }
        let client = HTTPFixtureClient(routes: routes, pauseURL: kind == "cancel" ? lastRaw : nil,
            started: started.continuation, release: release.stream,
            error: kind == "offline" ? URLError(.notConnectedToInternet) :
                kind == "rate-limit" ? PublicGitHubHTTPError.rateLimited(retryAfterSeconds: 60) : nil)
        let task = Task {
            let package = try await HTTPPublicSkillPackageFetcher(http: client).resolvePackage(b.request)
            let next = try await writer.preparePublicInstall(b.request, package: package, filesystemPaths: paths)
            return try await writer.applyPublicInstall(reviewID: next.id)
        }
        if kind == "cancel" {
            var events = started.stream.makeAsyncIterator()
            _ = await events.next()
            task.cancel()
            release.continuation.yield(())
            await #expect(throws: CancellationError.self) { try await task.value }
        } else {
            await #expect(throws: (any Error).self) { try await task.value }
        }
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: target.path) == link)
        #expect(try Data(contentsOf: recordURL) == record)
        for file in first.entries { #expect(try Data(contentsOf: target.appendingPathComponent(file.path)) == file.data) }
    }
}

private actor CountingLiveGitHubHTTP: PublicGitHubHTTPClient {
    private(set) var calls: [URLRequest] = []
    func data(for request: URLRequest, limit: Int) async throws -> Data {
        calls.append(request)
        return try await BoundedPublicGitHubHTTPClient().data(for: request, limit: limit)
    }
}

private actor HTTPFixtureClient: PublicGitHubHTTPClient {
    let routes: [String: Data]
    let pauseURL: String?
    let started: AsyncStream<Void>.Continuation?
    let release: AsyncStream<Void>?
    let error: (any Error)?
    private(set) var calls: [URLRequest] = []

    init(routes: [String: Data], pauseURL: String? = nil, started: AsyncStream<Void>.Continuation? = nil,
         release: AsyncStream<Void>? = nil, error: (any Error)? = nil) {
        self.routes = routes; self.pauseURL = pauseURL; self.started = started; self.release = release; self.error = error
    }

    func data(for request: URLRequest, limit: Int) async throws -> Data {
        calls.append(request)
        if let error { throw error }
        if request.url?.absoluteString == pauseURL, let release {
            started?.yield(())
            var events = release.makeAsyncIterator()
            _ = await events.next()
        }
        guard let bytes = routes[request.url!.absoluteString] else { throw PublicGitHubHTTPError.unavailable }
        return bytes
    }
}

// Self-contained HTTP responses: the ordinary fixture tests neither launch Git nor contact GitHub.
private struct HTTPPackageFixture {
    let root: String
    let request: PublicSkillInstallRequest
    let package: SkillPackage
    let rootSHA: String
    let metadata: [[String: Any]]
    var routes: [String: Data]
    let api = "https://api.github.com/repos/owner/repo"
    var latest: String { api + "/commits?per_page=1" }
    var selected: String { treeURL(package.coordinates.treeSha) + "?recursive=1" }
    func treeURL(_ sha: String) -> String { api + "/git/trees/" + sha }
    func raw(_ path: String) -> String {
        let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        let components = (root == "." ? [] : root.split(separator: "/").map(String.init)) + path.split(separator: "/").map(String.init)
        return "https://raw.githubusercontent.com/owner/repo/\(package.coordinates.commitSha)/"
            + components.map { $0.addingPercentEncoding(withAllowedCharacters: unreserved)! }.joined(separator: "/")
    }
    func selectedData(entries: [[String: Any]]? = nil, truncated: Bool = false) throws -> Data {
        try json(["sha": package.coordinates.treeSha, "truncated": truncated, "tree": entries ?? metadata])
    }

    init(root: String = "skills/example", version: String = "a", includeBinary: Bool = true,
         extra: [SkillPackageEntry] = [], package supplied: SkillPackage? = nil) throws {
        self.root = root
        request = try PublicSkillInstallRequest(catalogID: "unpinned-test", repositorySlug: "owner/repo",
            skillMDPath: root == "." ? "SKILL.md" : root + "/SKILL.md")
        let binaryFiles = includeBinary ? [
            GroupSkillPackageTestSupport.entry(path: "references/caf\u{00e9} %?#.bin", data: Data([0, 255, 3, 13, 10])),
            GroupSkillPackageTestSupport.entry(path: "empty", data: Data())
        ] : []
        var entries = supplied?.entries ?? GroupSkillPackageTestSupport.package.entries + binaryFiles + extra
        if version == "b" {
            entries[0] = GroupSkillPackageTestSupport.entry(path: "SKILL.md", data: Data("---\nname: example\ndescription: Version B.\n---\n".utf8))
        }
        entries.sort { Array($0.path.utf8).lexicographicallyPrecedes(Array($1.path.utf8)) }
        var directories = [String: [[String: Any]]]()
        for file in entries {
            let parts = file.path.split(separator: "/").map(String.init)
            let parent = parts.dropLast().joined(separator: "/")
            directories[parent, default: []].append(["path": parts.last!, "mode": file.mode, "type": "blob", "sha": file.blobSha, "size": file.data.count])
            for depth in 0..<parts.count { directories[parts.prefix(depth).joined(separator: "/"), default: []] += [] }
        }
        var recursive: [[String: Any]] = []
        var treeSHA = ""
        for directory in directories.keys.sorted(by: { $0.utf8.count > $1.utf8.count }) {
            let children = directories[directory]!
            let sha = hashTree(children)
            recursive += children.map { child in
                var value = child
                value["path"] = directory.isEmpty ? child["path"]! : directory + "/" + (child["path"] as! String)
                return value
            }
            if directory.isEmpty { treeSHA = sha }
            else {
                let parts = directory.split(separator: "/").map(String.init)
                directories[parts.dropLast().joined(separator: "/"), default: []].append([
                    "path": parts.last!, "mode": "040000", "type": "tree", "sha": sha
                ])
            }
        }
        metadata = recursive.sorted { ($0["path"] as! String) < ($1["path"] as! String) }
        let coordinates = supplied?.coordinates ?? SkillPackageCoordinates(commitSha: String(repeating: version, count: 40),
            treeSha: treeSHA, skillMdSha: entries.first { $0.path == "SKILL.md" }!.blobSha)
        self.package = SkillPackage(coordinates: coordinates, entries: entries)
        #expect(coordinates.treeSha == treeSHA)
        var ancestors: [(String, [[String: Any]])] = []
        var currentSHA = treeSHA
        for component in (root == "." ? [] : root.split(separator: "/").map(String.init)).reversed() {
            let children: [[String: Any]] = [["path": component, "mode": "040000", "type": "tree", "sha": currentSHA]]
            currentSHA = hashTree(children)
            ancestors.append((currentSHA, children))
        }
        rootSHA = currentSHA
        routes = [:]
        routes[latest] = try json([["sha": coordinates.commitSha, "commit": ["tree": ["sha": rootSHA]]]])
        routes[api + "/git/commits/" + coordinates.commitSha] = try json(["sha": coordinates.commitSha, "tree": ["sha": rootSHA]])
        routes[selected] = try selectedData()
        for (sha, children) in ancestors { routes[treeURL(sha)] = try json(["sha": sha, "truncated": false, "tree": children]) }
        for file in entries { routes[raw(file.path)] = file.data }
    }
}

private func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }

private func hashTree(_ entries: [[String: Any]]) -> String {
    let sorted = entries.sorted {
        let key: ([String: Any]) -> [UInt8] = { Array((($0["path"] as! String) + ($0["type"] as! String == "tree" ? "/" : "")).utf8) }
        return key($0).lexicographicallyPrecedes(key($1))
    }
    var data = Data()
    for entry in sorted {
        let mode = entry["mode"] as! String
        data.append(Data("\(mode == "040000" ? "40000" : mode) \(entry["path"] as! String)\0".utf8))
        let sha = Array((entry["sha"] as! String).utf8)
        for i in stride(from: 0, to: 40, by: 2) { data.append(UInt8(String(decoding: sha[i...i+1], as: UTF8.self), radix: 16)!) }
    }
    return Insecure.SHA1.hash(data: Data("tree \(data.count)\0".utf8) + data).map { String(format: "%02x", $0) }.joined()
}

private func removeHTTPTestRoot(_ root: URL) {
    if let items = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) {
        for case let item as URL in items {
            if (try? FileManager.default.attributesOfItem(atPath: item.path)[.type] as? FileAttributeType) == .typeDirectory {
                try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: item.path)
            }
        }
    }
    try? FileManager.default.removeItem(at: root)
}
