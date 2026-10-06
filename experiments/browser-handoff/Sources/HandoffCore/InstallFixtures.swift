import Darwin
import Foundation

// Synthetic pins are available only via an explicit local fixture launch setting and an owned sandbox.
enum InstallFixtures {
    static func candidate(_ version: String) throws -> InstallCandidate {
        guard ["A", "B"].contains(version) else { throw InstallFailure.invalidRecord }
        let texts: [(String, String, String)] = version == "A" ? [
            ("SKILL.md", "---\nname: frontend-design\ndescription: H1.2 isolated fixture.\n---\nVersion A\n", "100644"),
            ("old.txt", "Removed in B.\n", "100644"), ("run.sh", "#!/bin/sh\necho fixture\n", "100644")
        ] : [
            ("SKILL.md", "---\nname: frontend-design\ndescription: H1.2 isolated fixture.\n---\nVersion B\n", "100644"),
            ("new.txt", "Added in B.\n", "100644"), ("run.sh", "#!/bin/sh\necho fixture\n", "100755")
        ]
        let entries = texts.map { path, text, mode in
            let data = Data(text.utf8)
            return SkillPackageEntry(path: path, mode: mode, data: data, blobSha: SkillIdentityResolver.gitBlobSHA(for: data))
        }
        let tree = flatTree(entries)
        let skill = entries.first { $0.path == "SKILL.md" }!.blobSha
        let commit = String(repeating: version == "A" ? "a" : "b", count: 40)
        let pin = try PublicPin(id: HandoffRequest.pinnedTestSkillID, repo: "omgskills/h12-fixture", path: "frontend-design",
                                commit: commit, skillSHA: skill, treeSHA: tree)
        return InstallCandidate(pin: pin, package: .init(coordinates: .init(
            commitSha: commit, treeSha: tree, skillMdSha: skill), entries: entries))
    }

    static func flatTree(_ entries: [SkillPackageEntry]) -> String {
        var bytes = Data()
        for entry in entries.sorted(by: { Array($0.path.utf8).lexicographicallyPrecedes(Array($1.path.utf8)) }) {
            bytes.append(Data("\(entry.mode) \(entry.path)\0".utf8))
            let sha = Array(entry.blobSha)
            for index in stride(from: 0, to: 40, by: 2) { bytes.append(UInt8(String(sha[index...index + 1]), radix: 16)!) }
        }
        return GitObjectHash.sha(type: "tree", data: bytes)
    }

    static func selected(in sandbox: InstallSandbox) throws -> InstallCandidate {
        let (data, mode) = try sandbox.open().read("fixture-version", limit: 1)
        guard mode == 0o600, let value = String(data: data, encoding: .utf8) else { throw InstallFailure.invalidRecord }
        return try candidate(value)
    }
}

package enum InstallHarness {
    package static func run(_ arguments: [String]) async throws -> String {
        guard let command = arguments.first else { throw InstallFailure.invalidRecord }
        if command == "create", arguments.count == 1 { return try InstallSandbox.create().url.path }
        guard arguments.count == 2 || arguments.count == 3 else { throw InstallFailure.invalidRecord }
        let sandbox = try InstallSandbox(path: arguments[1])
        if command == "select", arguments.count == 3 {
            _ = try InstallFixtures.candidate(arguments[2])
            let root = try sandbox.open()
            let lock = try root.lock()
            defer { lock.release() }
            do {
                let name = "fixture-" + UUID().uuidString
                try root.write(name, data: Data(arguments[2].utf8))
                defer { unlinkat(root.fd, name, 0) }
                guard renameat(root.fd, name, root.fd, "fixture-version") == 0 else { throw InstallFailure.io }
            }
            return "Selected local fixture \(arguments[2])."
        }
        let store = SandboxInstaller(sandbox: sandbox, beforeSwitch: {
            if command == "kill-before" { raise(SIGKILL) }
        }, afterSwitch: {
            if command == "kill-after" { raise(SIGKILL) }
        })
        if command == "inspect" { return try await store.installedCommit() ?? "not_installed" }
        let review: InstallReview
        if command == "restore" { review = try await store.prepareRestore() }
        else {
            guard ["apply", "review", "kill-before", "kill-after"].contains(command) else { throw InstallFailure.invalidRecord }
            review = try await store.prepare(InstallFixtures.selected(in: sandbox))
        }
        if command == "review" { return "\(review.action.rawValue): \(review.toCommit), \(review.changes.count) changes" }
        return try await store.apply(review.id)
    }
}
