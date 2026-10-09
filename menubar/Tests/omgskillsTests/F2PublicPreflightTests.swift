#if DEBUG
import Foundation
import Testing
@testable import omgskills

struct F2PublicPreflightTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["OMGSKILLS_F2_PUBLIC_PREFLIGHT"] == "1"), .timeLimit(.minutes(1)))
    func realCatalogSourcesResolveAndPassExistingReviewLimits() async throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("omgskills-f2-preflight-\(UUID().uuidString)")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let report = root.appendingPathExtension("json")
        var rows: [[String: Any]] = []
        defer {
            let receipt: [String: Any] = ["observedAt": ISO8601DateFormatter().string(from: Date()),
                "scope": "Public fetch and review preflight only; no installation or browser acceptance", "sources": rows]
            if let data = try? JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: report)
                print("F2 preflight receipt: \(report.path)")
            }
        }
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let input = try JSONDecoder().decode(Sources.self, from: Data(contentsOf:
            repository.appendingPathComponent("portal/src/preview/unified/f2-sources.json")))
        #expect(input.sources.count == 3)
        for source in input.sources {
            let runner = PreflightGitRunner(root: root)
            let fetcher = GitPublicSkillPackageFetcher(runner: runner, temporaryRoot: root)
            let started = Date()
            var row: [String: Any] = ["id": source.id, "repository": source.repository, "path": source.path]
            do {
                let request = try source.request()
                let latest = try await fetcher.resolvePackage(request)
                guard latest.coordinates.commitSha == source.observedCommit else {
                    throw PublicSkillReviewError.staleReview
                }
                let initial = try PublicSkillPackageReview.changes(from: nil, to: latest)
                row["target"] = request.targetName
                row["latest"] = manifest(latest)
                row["reviewFileCount"] = initial.count
                if let previous = source.previousCommit {
                    let old = try await fetcher.resolvePackage(source.request(commit: previous))
                    _ = try PublicSkillPackageReview.changes(from: nil, to: old)
                    let changes = try PublicSkillPackageReview.changes(from: old, to: latest)
                    #expect(old.coordinates.treeSha != latest.coordinates.treeSha)
                    #expect(!changes.isEmpty)
                    row["previous"] = manifest(old)
                    row["changedPaths"] = changes.map(\.path)
                }
                row["result"] = "passed"
            } catch {
                row["result"] = "failed"
                row["error"] = String(describing: error)
                row["seconds"] = Date().timeIntervalSince(started)
                row["gitFetchCount"] = await runner.fetchCount
                rows.append(row)
                throw error
            }
            row["seconds"] = Date().timeIntervalSince(started)
            row["gitFetchCount"] = await runner.fetchCount
            rows.append(row)
            print("F2 preflight passed: \(source.id)")
        }
    }

    private func manifest(_ package: SkillPackage) -> [String: Any] {
        ["commit": package.coordinates.commitSha, "tree": package.coordinates.treeSha,
         "skillBlob": package.coordinates.skillMdSha,
         "totalBytes": package.entries.reduce(0) { $0 + $1.data.count },
         "files": package.entries.map { ["path": $0.path, "mode": $0.mode,
             "blob": $0.blobSha, "bytes": $0.data.count] as [String: Any] }]
    }

    private struct Sources: Decodable { let sources: [Source] }
    private struct Source: Decodable {
        let id: String
        let repository: String
        let path: String
        let previousCommit: String?
        let observedCommit: String

        func request(commit: String? = nil) throws -> PublicSkillInstallRequest {
            try PublicSkillInstallRequest(catalogID: id, repositorySlug: repository, skillMDPath: path, commitSha: commit)
        }
    }
}

private actor PreflightGitRunner: GitCommandRunning {
    let runner: GitCommandRunner
    private(set) var fetchCount = 0
    init(root: URL) { runner = GitCommandRunner(temporaryRoot: root) }
    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        if arguments.contains("fetch") { fetchCount += 1 }
        return try await runner.run(arguments: arguments, maximumOutputBytes: maximumOutputBytes)
    }
}
#endif
