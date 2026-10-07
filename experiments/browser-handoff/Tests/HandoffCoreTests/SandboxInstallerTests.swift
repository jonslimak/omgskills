import CryptoKit
import Darwin
import Foundation
import Testing
@testable import HandoffCore
import HandoffTestSupport

private func target(_ sandbox: InstallSandbox) -> URL { sandbox.url.appendingPathComponent(SandboxInstaller.target) }
private func version(_ sandbox: InstallSandbox) throws -> URL {
    let link = try FileManager.default.destinationOfSymbolicLink(atPath: target(sandbox).path)
    return target(sandbox).deletingLastPathComponent().appendingPathComponent(link).standardizedFileURL.deletingLastPathComponent()
}
private func erase(_ sandbox: InstallSandbox) { try? FileManager.default.removeItem(at: sandbox.url) }

// Independent read-back does not call the installer's record reader or package validator.
private func verify(_ sandbox: InstallSandbox, _ expected: String, previous: String? = nil) throws {
    let folder = try version(sandbox)
    let record = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: folder.appendingPathComponent("record.json"))) as? [String: Any])
    #expect(record["owner"] as? String == "omgskills-handoff-test")
    #expect(record["commit"] as? String == String(repeating: expected.lowercased(), count: 40))
    let files = try #require(record["files"] as? [[String: Any]])
    let content = folder.appendingPathComponent("content")
    #expect(Set(try FileManager.default.contentsOfDirectory(atPath: content.path)) == Set(files.compactMap { $0["path"] as? String }))
    for file in files {
        let path = try #require(file["path"] as? String)
        let data = try Data(contentsOf: content.appendingPathComponent(path))
        var object = Data("blob \(data.count)\0".utf8); object.append(data)
        let hash = Insecure.SHA1.hash(data: object).map { String(format: "%02x", $0) }.joined()
        #expect(hash == file["sha"] as? String)
        #expect(data.count == file["size"] as? Int)
        let mode = try FileManager.default.attributesOfItem(atPath: content.appendingPathComponent(path).path)[.posixPermissions] as? Int
        #expect(mode == (file["mode"] as? String == "100755" ? 0o755 : 0o644))
    }
    let skill = try String(contentsOf: content.appendingPathComponent("SKILL.md"), encoding: .utf8)
    #expect(skill.contains("Version \(expected)"))
    if let previous {
        let previousID = try #require(record["previousID"] as? String)
        let old = folder.deletingLastPathComponent().appendingPathComponent(previousID)
        let text = try String(contentsOf: old.appendingPathComponent("content/SKILL.md"), encoding: .utf8)
        #expect(text.contains("Version \(previous)"))
    }
}

struct SandboxInstallerTests {
    @Test func installRepeatUpdateAndRestoreWithExactReview() async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let store = SandboxInstaller(sandbox: sandbox)
        let a = try await store.prepare(InstallFixtures.candidate("A"))
        #expect(a.action == .install)
        #expect(a.changes.count == 3)
        #expect(!FileManager.default.fileExists(atPath: target(sandbox).path))
        _ = try await store.apply(a.id)
        try verify(sandbox, "A")
        let oldTarget = try FileManager.default.destinationOfSymbolicLink(atPath: target(sandbox).path)
        let repeatA = try await store.prepare(InstallFixtures.candidate("A"))
        #expect(repeatA.action == .unchanged)
        #expect(repeatA.changes.isEmpty)
        _ = try await store.apply(repeatA.id)
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: target(sandbox).path) == oldTarget)
        let b = try await store.prepare(InstallFixtures.candidate("B"))
        #expect(b.action == .update)
        #expect(b.changes.map(\.path) == ["SKILL.md", "new.txt", "old.txt", "run.sh"])
        #expect(b.changes[0].diff.contains("-Version A\n+Version B"))
        #expect(b.changes[1].kind == "Added")
        #expect(b.changes[2].kind == "Removed")
        #expect(b.changes[3].oldMode == "100644" && b.changes[3].newMode == "100755")
        _ = try await store.apply(b.id)
        try verify(sandbox, "B", previous: "A")
        let repeatB = try await store.prepare(InstallFixtures.candidate("B"))
        #expect(repeatB.action == .unchanged && repeatB.canRestore)
        let restore = try await store.prepareRestore()
        #expect(restore.action == .restore)
        #expect(restore.changes[0].diff.contains("-Version B\n+Version A"))
        _ = try await store.apply(restore.id)
        try verify(sandbox, "A", previous: "B")
    }

    @Test(arguments: ["modify", "add", "remove", "mode", "symlink", "hardlink", "empty-directory"])
    func refusesLocalChangesBothAtReviewAndApply(_ mutation: String) async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let store = SandboxInstaller(sandbox: sandbox)
        let a = try await store.prepare(InstallFixtures.candidate("A")); _ = try await store.apply(a.id)
        let b = try await store.prepare(InstallFixtures.candidate("B"))
        let content = try version(sandbox).appendingPathComponent("content")
        let skill = content.appendingPathComponent("SKILL.md")
        switch mutation {
        case "modify": try Data("my edit".utf8).write(to: skill)
        case "add": try Data("my file".utf8).write(to: content.appendingPathComponent("extra"))
        case "remove": try FileManager.default.removeItem(at: skill)
        case "mode": try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: skill.path)
        case "symlink": try FileManager.default.createSymbolicLink(atPath: content.appendingPathComponent("link").path, withDestinationPath: "/tmp")
        case "hardlink": try FileManager.default.linkItem(at: skill, to: content.appendingPathComponent("hardlink"))
        default: try FileManager.default.createDirectory(at: content.appendingPathComponent("empty"), withIntermediateDirectories: false)
        }
        let link = try FileManager.default.destinationOfSymbolicLink(atPath: target(sandbox).path)
        await #expect(throws: (any Error).self) { try await store.apply(b.id) }
        await #expect(throws: (any Error).self) { try await store.prepare(InstallFixtures.candidate("B")) }
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: target(sandbox).path) == link)
    }

    @Test func rechecksAfterStagingAndPreservesExternalEdits() async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let initial = SandboxInstaller(sandbox: sandbox)
        let a = try await initial.prepare(InstallFixtures.candidate("A")); _ = try await initial.apply(a.id)
        let skill = try version(sandbox).appendingPathComponent("content/SKILL.md")
        let store = SandboxInstaller(sandbox: sandbox, beforeSwitch: { try Data("late edit".utf8).write(to: skill) })
        let b = try await store.prepare(InstallFixtures.candidate("B"))
        await #expect(throws: InstallFailure.changed) { try await store.apply(b.id) }
        #expect(try String(contentsOf: skill, encoding: .utf8) == "late edit")
    }

    @Test func rejectsStaleUnknownDiscardedAndConcurrentApprovals() async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let first = SandboxInstaller(sandbox: sandbox), second = SandboxInstaller(sandbox: sandbox)
        let a = try await first.prepare(InstallFixtures.candidate("A"))
        await #expect(throws: InstallFailure.staleReview) { try await first.apply(UUID()) }
        let b = try await second.prepare(InstallFixtures.candidate("B")); _ = try await second.apply(b.id)
        await #expect(throws: InstallFailure.staleReview) { try await first.apply(a.id) }
        try verify(sandbox, "B")
        let next = try await first.prepare(InstallFixtures.candidate("A"))
        await first.discard(next.id)
        await #expect(throws: InstallFailure.staleReview) { try await first.apply(next.id) }
        let root = try sandbox.open(), lock = try root.lock()
        defer { lock.release() }
        await #expect(throws: InstallFailure.busy) { try await second.prepare(InstallFixtures.candidate("B")) }
    }

    @Test func cancellationAndPreSwitchFailureKeepA() async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let store = SandboxInstaller(sandbox: sandbox)
        let a = try await store.prepare(InstallFixtures.candidate("A")); _ = try await store.apply(a.id)
        let b = try await store.prepare(InstallFixtures.candidate("B"))
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await store.apply(b.id)
        }
        await #expect(throws: CancellationError.self) { try await task.value }
        try verify(sandbox, "A")
        let failed = SandboxInstaller(sandbox: sandbox, beforeSwitch: { throw InstallFailure.io })
        let retry = try await failed.prepare(InstallFixtures.candidate("B"))
        await #expect(throws: InstallFailure.io) { try await failed.apply(retry.id) }
        let restarted = SandboxInstaller(sandbox: sandbox)
        #expect(try await restarted.installedCommit() == String(repeating: "a", count: 40))
        let recovered = try await restarted.prepare(InstallFixtures.candidate("B")); _ = try await restarted.apply(recovered.id)
        try verify(sandbox, "B", previous: "A")
    }

    @Test(arguments: ["directory", "foreign-link", "broken-link", "parent-link", "record", "wrong-owner", "lock-link", "root-link"])
    func refusesUnownedOrCorruptPaths(_ kind: String) async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let store = SandboxInstaller(sandbox: sandbox)
        let review = try await store.prepare(InstallFixtures.candidate("A"))
        let target = target(sandbox)
        switch kind {
        case "directory": try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
        case "foreign-link", "broken-link":
            try FileManager.default.createSymbolicLink(atPath: target.path, withDestinationPath: kind == "foreign-link" ? "/private/tmp" : "/does-not-exist")
        case "parent-link":
            try FileManager.default.removeItem(at: target.deletingLastPathComponent())
            try FileManager.default.createSymbolicLink(atPath: target.deletingLastPathComponent().path, withDestinationPath: "/private/tmp")
        case "lock-link":
            let lock = sandbox.url.appendingPathComponent("install.lock")
            try FileManager.default.removeItem(at: lock)
            try FileManager.default.createSymbolicLink(atPath: lock.path, withDestinationPath: "/private/tmp")
        case "root-link":
            let alias = sandbox.url.deletingLastPathComponent().appendingPathComponent(InstallSandbox.prefix + UUID().uuidString)
            try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: sandbox.url)
            defer { try? FileManager.default.removeItem(at: alias) }
            #expect(throws: (any Error).self) { try InstallSandbox(path: alias.path) }
            return
        default:
            _ = try await store.apply(review.id)
            let record = try version(sandbox).appendingPathComponent("record.json")
            if kind == "record" { try Data("{}".utf8).write(to: record) }
            else {
                var json = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: record)) as? [String: Any])
                json["owner"] = "another-app"
                try JSONSerialization.data(withJSONObject: json).write(to: record)
            }
        }
        await #expect(throws: (any Error).self) { try await store.prepare(InstallFixtures.candidate("B")) }
    }

    @Test func backupChangesBlockRestoreAndRestoreApproval() async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let store = SandboxInstaller(sandbox: sandbox)
        await #expect(throws: InstallFailure.noBackup) { try await store.prepareRestore() }
        let a = try await store.prepare(InstallFixtures.candidate("A")); _ = try await store.apply(a.id)
        let old = try version(sandbox)
        let b = try await store.prepare(InstallFixtures.candidate("B")); _ = try await store.apply(b.id)
        let restore = try await store.prepareRestore()
        try Data("edited backup".utf8).write(to: old.appendingPathComponent("content/SKILL.md"))
        await #expect(throws: InstallFailure.changed) { try await store.apply(restore.id) }
        await #expect(throws: InstallFailure.changed) { try await store.prepareRestore() }
        try verify(sandbox, "B")
    }

    @Test func boundedReviewRejectsBinaryLargeAndInvalidText() throws {
        let base = try InstallFixtures.candidate("A").package
        for data in [Data([0, 1]), Data([255]), Data(repeating: 120, count: 65_537), Data("hello\u{0008}".utf8)] {
            let entry = SkillPackageEntry(path: "file", mode: "100644", data: data, blobSha: String(repeating: "a", count: 40))
            let next = SkillPackage(coordinates: base.coordinates, entries: [entry])
            #expect(throws: InstallFailure.unreviewable) { try PackageReview.changes(from: nil, to: next) }
        }
        #expect(throws: InstallFailure.unsafeRoot) { try InstallSandbox(path: NSHomeDirectory() + "/.codex/skills") }
    }

    @Test func cancellationAfterPublicationReportsInstalledState() async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let store = SandboxInstaller(sandbox: sandbox, afterSwitch: { withUnsafeCurrentTask { $0?.cancel() } })
        let review = try await store.prepare(InstallFixtures.candidate("A"))
        let task = Task { try await store.apply(review.id) }
        #expect(try await task.value == "Verified version installed.")
        try verify(sandbox, "A")
    }

    @Test func corruptCandidateDoesNotChangeInstalledVersion() async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let store = SandboxInstaller(sandbox: sandbox)
        let a = try await store.prepare(InstallFixtures.candidate("A")); _ = try await store.apply(a.id)
        let b = try InstallFixtures.candidate("B")
        let bad = InstallCandidate(pin: b.pin, package: .init(coordinates: b.package.coordinates, entries: Array(b.package.entries.dropLast())))
        await #expect(throws: SkillPackageValidationError.self) { try await store.prepare(bad) }
        try verify(sandbox, "A")
    }

    @Test func installsNestedPackageAndPreservesExecutableMode() async throws {
        let sandbox = try InstallSandbox.create(); defer { erase(sandbox) }
        let entries = [
            ("SKILL.md", "---\nname: example\ndescription: Example package.\n---\n", "100644"),
            ("scripts/run.sh", "#!/bin/sh\necho hello\n", "100755"),
            ("references/info.txt", "reference\n", "100644")
        ].map { path, text, mode in
            let data = Data(text.utf8)
            return SkillPackageEntry(path: path, mode: mode, data: data, blobSha: SkillIdentityResolver.gitBlobSHA(for: data))
        }
        let pin = try PublicPin(id: HandoffRequest.pinnedTestSkillID, repo: "test/skills", path: "example",
                                commit: String(repeating: "1", count: 40), skillSHA: "6d2190081ae23aae9b09e89d10a3e1f57c3bb398",
                                treeSHA: "315d6f38e5d0c3ab41809ba1c188e25eab45b5a1")
        let candidate = InstallCandidate(pin: pin, package: .init(coordinates: .init(
            commitSha: pin.commit, treeSha: pin.treeSHA!, skillMdSha: pin.skillSHA), entries: entries))
        let store = SandboxInstaller(sandbox: sandbox)
        let review = try await store.prepare(candidate); _ = try await store.apply(review.id)
        let content = try version(sandbox).appendingPathComponent("content")
        #expect(try Data(contentsOf: content.appendingPathComponent("scripts/run.sh")) == entries[1].data)
        #expect(try FileManager.default.attributesOfItem(atPath: content.appendingPathComponent("scripts/run.sh").path)[.posixPermissions] as? Int == 0o755)
        #expect(try await store.prepare(candidate).action == .unchanged)
    }
}
