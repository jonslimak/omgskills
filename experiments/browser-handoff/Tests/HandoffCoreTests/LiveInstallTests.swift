import CryptoKit
import Foundation
import Testing
@testable import HandoffCore
import HandoffTestSupport

struct LiveInstallTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["OMGSKILLS_H12_LIVE_TEST"] == "1"))
    func livePublicInstallInSandbox() async throws {
        let sandbox = try InstallSandbox.create()
        defer { try? FileManager.default.removeItem(at: sandbox.url) }
        let service = try PublicInstallService(testRoot: sandbox.url.path)
        let request = try #require(HandoffRequest.parseTest("omgskills-helper-test://install?id=anthropics%2Fclaude-plugins-public%3Afrontend-design"))
        let review = try await service.prepare(request)
        #expect(review.action == .install)
        #expect(review.fileCount > 0)
        _ = try await service.apply(review.id)
        let target = sandbox.url.appendingPathComponent("codex/skills/frontend-design")
        let link = try FileManager.default.destinationOfSymbolicLink(atPath: target.path)
        let content = target.deletingLastPathComponent().appendingPathComponent(link)
        let metadata = try Data(contentsOf: content.deletingLastPathComponent().appendingPathComponent("record.json"))
        let record = try #require(JSONSerialization.jsonObject(with: metadata) as? [String: Any])
        #expect(record["commit"] as? String == review.toCommit)
        let files = try #require(record["files"] as? [[String: Any]])
        #expect(files.count == review.fileCount)
        var bytes = 0
        for file in files {
            let path = try #require(file["path"] as? String)
            let data = try Data(contentsOf: content.appendingPathComponent(path))
            var git = Data("blob \(data.count)\0".utf8); git.append(data)
            let sha = Insecure.SHA1.hash(data: git).map { String(format: "%02x", $0) }.joined()
            #expect(sha == file["sha"] as? String)
            #expect(data.count == file["size"] as? Int)
            let permissions = try FileManager.default.attributesOfItem(atPath: content.appendingPathComponent(path).path)[.posixPermissions] as? Int
            #expect(permissions == (file["mode"] as? String == "100755" ? 0o755 : 0o644))
            bytes += data.count
        }
        print("H1.2 live sandbox install verified: commit=\(review.toCommit) tree=\(record["tree"] ?? "unknown") files=\(files.count) bytes=\(bytes)")
    }
}
