#if DEBUG
import Foundation
import Testing
@testable import omgskills

struct CatalogCompatibilityTests {
    @Test func fixedSampleHasTwentyDistinctIDsAndEighteenPendingInstalls() throws {
        let manifest = try CompatibilityManifest.load()
        #expect(manifest.cases.count == 20)
        #expect(manifest.cases.filter { $0.status == "pending" }.count == 18)
        #expect(manifest.cases.filter { $0.agent == "claude" }.count == 10)
        #expect(manifest.cases.filter { $0.agent == "codex" }.count == 10)
        #expect(Set(manifest.cases.flatMap(\.categories)).isSuperset(of: ["legacy", "pinned", "missing-path", "old-alias", "root", "nested", "dot-directory", "binary-companions", "large-package"]))
    }

    @Test func everyFrozenRecordHasAValidNativeDestinationWithoutCreatingFiles() async throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-catalog-compatibility-" + UUID().uuidString)
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let service = CatalogInstallService(installer: CatalogSkillInstaller(managedInstaller: ManagedSkillInstaller(
            managedRoot: root.appendingPathComponent("managed"), pathAnchor: paths.homeDirectory), filesystemPaths: paths))
        for entry in try CompatibilityManifest.load().cases {
            let spec = try CompatibilitySourceSpec(entry.record.skill)
            #expect(try await service.destination(for: entry.record.skill, target: entry.target)
                == paths.skillsRoot(for: entry.target).appendingPathComponent(spec.name))
        }
        #expect(!CatalogInstallFilesystem.exists(root))
    }

    @Test func completeInventoryChecksBinaryBytesExecutableBitsAndUnexpectedFiles() throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-compatibility-unit-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let content = root.appendingPathComponent("content")
        try FileManager.default.createDirectory(at: content, withIntermediateDirectories: false)
        let md = Data("# Fixture\n".utf8), binary = Data([0, 1, 255, 0])
        try md.write(to: content.appendingPathComponent("SKILL.md"))
        try binary.write(to: content.appendingPathComponent("asset.bin"))
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: content.appendingPathComponent("asset.bin").path)
        let tree = "100644 blob \(SkillIdentityResolver.gitBlobSHA(for: md)) \(md.count)\tSKILL.md\0"
            + "100755 blob \(SkillIdentityResolver.gitBlobSHA(for: binary)) \(binary.count)\tasset.bin\0"
        let entries = try CompatibilityGitEntry.parse(Data(tree.utf8))
        let verified = try CompatibilityVerifier.content(content, entries: entries, boundary: root)
        #expect(verified.first { $0.path == "asset.bin" }?.binary == true)
        try Data([0, 2, 255, 0]).write(to: content.appendingPathComponent("asset.bin"))
        #expect(throws: CompatibilityError.self) { try CompatibilityVerifier.content(content, entries: entries, boundary: root) }
        try binary.write(to: content.appendingPathComponent("asset.bin"))
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: content.appendingPathComponent("asset.bin").path)
        #expect(throws: CompatibilityError.self) { try CompatibilityVerifier.content(content, entries: entries, boundary: root) }
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: content.appendingPathComponent("asset.bin").path)
        try md.write(to: content.appendingPathComponent("unexpected.txt"))
        #expect(throws: CompatibilityError.self) { try CompatibilityVerifier.content(content, entries: entries, boundary: root) }
    }

    @Test func treeParserRefusesTraversalSubmodulesDuplicatePathsAndOversizedFiles() throws {
        let sha = String(repeating: "a", count: 40)
        for tree in ["100644 blob \(sha) 1\t../outside\0", "160000 commit \(sha) -\tsubmodule\0",
                     "100644 blob \(sha) 33554433\tSKILL.md\0",
                     "100644 blob \(sha) 1\tSKILL.md\0" + "100644 blob \(sha) 1\tSKILL.md\0"] {
            #expect(throws: CompatibilityError.self) { try CompatibilityGitEntry.parse(Data(tree.utf8)) }
        }
    }

    @Test func symlinkInventoryChecksMetadataWithoutReadingOutsideTheTestRoot() throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-compatibility-unit-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("content")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        let md = Data("# Fixture\n".utf8), linkData = Data("SKILL.md".utf8)
        try md.write(to: directory.appendingPathComponent("SKILL.md"))
        try FileManager.default.createSymbolicLink(atPath: directory.appendingPathComponent("alias").path, withDestinationPath: "SKILL.md")
        let entries = [CompatibilityGitEntry(path: "SKILL.md", mode: "100644", blobSHA: SkillIdentityResolver.gitBlobSHA(for: md), size: md.count),
                       CompatibilityGitEntry(path: "alias", mode: "120000", blobSHA: SkillIdentityResolver.gitBlobSHA(for: linkData), size: linkData.count)]
        #expect(try CompatibilityVerifier.content(directory, entries: entries, boundary: root).count == 2)
        try FileManager.default.removeItem(at: directory.appendingPathComponent("alias"))
        try FileManager.default.createSymbolicLink(atPath: directory.appendingPathComponent("alias").path, withDestinationPath: "/etc/hosts")
        #expect(throws: CompatibilityError.self) { try CompatibilityVerifier.content(directory, entries: entries, boundary: root) }
    }

    @Test func cloneAuditStopsOnHeadDriftOrAnUnapprovedDestinationWithoutNetwork() async throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-compatibility-unit-" + UUID().uuidString)
        let remote = "https://github.com/owner/repo", expected = String(repeating: "a", count: 40)
        let audit = CompatibilityAuditGit(base: CompatibilityFakeGit(head: String(repeating: "b", count: 40)), legacyCommits: [remote: expected], boundary: root)
        await #expect(throws: CompatibilityError.self) {
            try await audit.run(arguments: ["clone", remote, root.appendingPathComponent("repo").path], maximumOutputBytes: 1024)
        }
        await #expect(throws: CompatibilityError.self) {
            try await audit.run(arguments: ["clone", remote, "/Users/jonslimak/.codex/skills/repo"], maximumOutputBytes: 1024)
        }
        #expect(!CatalogInstallFilesystem.exists(root))
    }

    @Test(arguments: ["legacy", "pinned"], [SkillInstaller.Target.claude, .codex])
    func completeLocalInstallAndVerificationUsesRealBackend(_ backend: String, _ target: SkillInstaller.Target) async throws {
        let packagePath = target == .claude ? "." : ".github/skills/example"
        let repository = try LocalGitPackageRepository(packagePath: packagePath)
        defer { repository.remove() }
        let git = GitCommandRunner(temporaryRoot: repository.temporaryRoot)
        let source = packagePath == "." ? repository.repositoryRoot : repository.repositoryRoot.appendingPathComponent(packagePath)
        try Data([0, 1, 255, 0]).write(to: source.appendingPathComponent("asset.bin"))
        _ = try await git.run(arguments: ["-C", repository.repositoryRoot.path, "add", "."], maximumOutputBytes: 1024)
        _ = try await git.run(arguments: ["-C", repository.repositoryRoot.path, "-c", "user.name=omgskills-tests",
            "-c", "user.email=tests@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
            "commit", "--quiet", "-m", "binary companion fixture"], maximumOutputBytes: 1024)
        let commit = String(decoding: try await git.run(arguments: ["-C", repository.repositoryRoot.path, "rev-parse", "HEAD"],
            maximumOutputBytes: 1024), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let tree = String(decoding: try await git.run(arguments: ["-C", repository.repositoryRoot.path, "rev-parse",
            packagePath == "." ? "HEAD^{tree}" : "HEAD:" + packagePath], maximumOutputBytes: 1024),
            as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let agent = target == .claude ? "claude" : "codex"
        let command = packagePath == "." ? "git clone https://github.com/owner/repo ~/.claude/skills/old-alias"
            : "git clone https://github.com/owner/repo /tmp/repo && ln -s /tmp/repo/\(packagePath) ~/.claude/skills/old-alias"
        var fields: [String: Any] = ["id": "owner/repo:example", "name": "example", "description": "Local fixture",
            "author_handle": "owner", "github_url": "https://github.com/owner/repo", "install_cmd": command,
            "skill_md_sha": repository.coordinates.skillMdSha]
        if backend == "pinned" {
            fields.merge(["repo_slug": "owner/repo", "skill_md_path": packagePath == "." ? "SKILL.md" : packagePath + "/SKILL.md",
                "repo_commit_sha": commit, "skill_tree_sha": tree, "install_target_name": "old-alias"], uniquingKeysWith: { _, new in new })
        }
        let record = try JSONDecoder().decode(CatalogInstallRecord.self, from: JSONSerialization.data(withJSONObject: fields))
        let entry = CompatibilityManifest.Entry(id: record.id, agent: agent, status: "pending", categories: [backend],
            record: record, manualInstructionSHA256: nil)
        let spec = try CompatibilitySourceSpec(record.skill)
        try #require((spec.pinned != nil) == (backend == "pinned"))
        let reference = repository.root.appendingPathComponent("reference.git")
        _ = try await git.run(arguments: ["clone", "--bare", "--quiet", repository.repositoryRoot.path, reference.path], maximumOutputBytes: 1024)
        try #require(try await CompatibilitySourceTree.resolve(git: git, reference: reference, commit: commit,
            spec: spec, allowUnavailable: false) == .available(tree))
        let files = try CompatibilityGitEntry.parse(await git.run(arguments: ["--git-dir", reference.path,
            "ls-tree", "-r", "-l", "-z", tree], maximumOutputBytes: 2 * 1024 * 1024))
        let paths = SkillFilesystemPaths.isolated(testRoot: repository.root)
        let localGit = CompatibilityLocalCloneGit(base: git, repository: repository.repositoryRoot)
        let audited = CompatibilityAuditGit(base: localGit, legacyCommits: [spec.remote: commit], boundary: repository.root)
        let fetcher = GitPublicSkillPackageFetcher(temporaryRoot: repository.temporaryRoot, remoteURL: { slug in
            slug == "owner/repo" ? repository.repositoryRoot : nil
        })
        let installer = CatalogSkillInstaller(packageFetcher: fetcher,
            managedInstaller: ManagedSkillInstaller(managedRoot: repository.root.appendingPathComponent("managed"), pathAnchor: paths.homeDirectory),
            filesystemPaths: paths)
        let service = CatalogInstallService(installer: installer, gitProvider: { audited })
        try #require(await service.install(record.skill, target: target) == .installed)
        let destination = paths.skillsRoot(for: target).appendingPathComponent("old-alias")
        let snapshot = try CompatibilityVerifier.install(entry, spec: spec, paths: paths, boundary: repository.root, files: files)
        #expect(snapshot.files.count == files.count)
        #expect(snapshot.files.first { $0.path == "asset.bin" }?.binary == true)
        #expect(snapshot.files.first { $0.path == "scripts/run.sh" }?.mode == "100755")
        let metadata: URL
        if backend == "pinned" {
            metadata = URL(fileURLWithPath: snapshot.link).deletingLastPathComponent().appendingPathComponent("provenance.json")
            #expect(!CatalogInstallFilesystem.exists(destination.resolvingSymlinksInPath().deletingLastPathComponent().appendingPathComponent("provenance.json")))
        } else {
            metadata = SkillInstallProvenanceStore.metadataURL(targetRoot: paths.skillsRoot(for: target), targetName: "old-alias")
        }
        let originalRecord = try Data(contentsOf: metadata)
        #expect(snapshot.provenanceSHA256 == CompatibilityVerifier.hash(originalRecord))
        #expect(await service.install(record.skill, target: target) == .alreadyInstalled)
        #expect(try CompatibilityVerifier.install(entry, spec: spec, paths: paths, boundary: repository.root, files: files) == snapshot)
        var wrongRecord = try #require(JSONSerialization.jsonObject(with: originalRecord) as? [String: Any])
        wrongRecord["catalogSkillId"] = "other/source"
        try JSONSerialization.data(withJSONObject: wrongRecord).write(to: metadata, options: .atomic)
        #expect(throws: CompatibilityError.self) {
            try CompatibilityVerifier.install(entry, spec: spec, paths: paths, boundary: repository.root, files: files)
        }
        try FileManager.default.removeItem(at: metadata)
        #expect(throws: (any Error).self) {
            try CompatibilityVerifier.install(entry, spec: spec, paths: paths, boundary: repository.root, files: files)
        }
        try originalRecord.write(to: metadata, options: .atomic)
        let asset = destination.appendingPathComponent("asset.bin")
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: asset.path)
        try Data([0, 2, 255, 0]).write(to: asset)
        #expect(throws: CompatibilityError.self) {
            try CompatibilityVerifier.install(entry, spec: spec, paths: paths, boundary: repository.root, files: files)
        }
        try Data([0, 1, 255, 0]).write(to: asset)
        #expect(try CompatibilityVerifier.install(entry, spec: spec, paths: paths, boundary: repository.root, files: files) == snapshot)
    }

    @Test func realGitRunnerFindsExistingTreesAndDistinguishesMissingPaths() async throws {
        let manifest = try CompatibilityManifest.load()
        let missing = try #require(manifest.cases.first { $0.id == "coreyhaines31/marketingskills:aso-audit" })
        let missingSpec = try CompatibilitySourceSpec(missing.record.skill)
        for id in ["anthropics/skills:skills/frontend-design",
                   "microsoft/skills:.github/plugins/azure-sdk-dotnet/skills/azure-ai-openai-dotnet",
                   "hardikpandya/stop-slop:stop-slop"] {
            let entry = try #require(manifest.cases.first { $0.id == id })
            let spec = try CompatibilitySourceSpec(entry.record.skill)
            let repository = try LocalGitPackageRepository(packagePath: spec.packageRoot)
            defer { repository.remove() }
            let git = GitCommandRunner(temporaryRoot: repository.temporaryRoot)
            let reference = repository.root.appendingPathComponent("reference.git")
            _ = try await git.run(arguments: ["clone", "--bare", "--quiet", repository.repositoryRoot.path, reference.path],
                maximumOutputBytes: 1024)
            let commit = repository.coordinates.commitSha
            #expect(try await CompatibilitySourceTree.resolve(git: git, reference: reference, commit: commit,
                spec: spec, allowUnavailable: false) == .available(repository.coordinates.treeSha))
            #expect(try await CompatibilitySourceTree.resolve(git: git, reference: reference, commit: commit,
                spec: missingSpec, allowUnavailable: true)
                == .unavailable("Package path 'skills/aso-audit' is absent at fetched commit \(commit)."))
            await #expect(throws: CompatibilityError.self) {
                try await CompatibilitySourceTree.resolve(git: git, reference: reference, commit: commit,
                    spec: missingSpec, allowUnavailable: false)
            }
            await #expect(throws: GitCommandError.self) {
                try await CompatibilitySourceTree.resolve(git: git, reference: reference,
                    commit: String(repeating: "0", count: 40), spec: missingSpec, allowUnavailable: true)
            }
        }
    }

    @Test func missingLegacyPackageIsUnavailableOnlyAfterSuccessfulExactPathQuery() async throws {
        let entry = try #require(CompatibilityManifest.load().cases.first { $0.id == "coreyhaines31/marketingskills:aso-audit" })
        let spec = try CompatibilitySourceSpec(entry.record.skill)
        let commit = String(repeating: "a", count: 40)
        let git = CompatibilityTreeGit(expected: ["--git-dir", "/unused", "ls-tree", "-z", commit,
            "--", "skills/aso-audit"], result: .success(Data()))
        let result = try await CompatibilitySourceTree.resolve(git: git, reference: URL(fileURLWithPath: "/unused"),
            commit: commit, spec: spec, allowUnavailable: true)
        #expect(result == .unavailable("Package path 'skills/aso-audit' is absent at fetched commit \(commit)."))
    }

    @Test func missingPinnedOrManualSourceStillStops() async throws {
        let manifest = try CompatibilityManifest.load()
        for id in ["anthropics/skills:skills/frontend-design", "anthropics/skills:pptx"] {
            let entry = try #require(manifest.cases.first { $0.id == id })
            let spec = try CompatibilitySourceSpec(entry.record.skill)
            let commit = String(repeating: "a", count: 40)
            let git = CompatibilityTreeGit(expected: ["--git-dir", "/unused", "ls-tree", "-z", commit,
                "--", spec.packageRoot], result: .success(Data()))
            await #expect(throws: CompatibilityError.self) {
                try await CompatibilitySourceTree.resolve(git: git, reference: URL(fileURLWithPath: "/unused"),
                    commit: commit, spec: spec, allowUnavailable: entry.status == "pending")
            }
        }
    }

    @Test func gitFailuresAreNeverClassifiedAsSourceUnavailable() async throws {
        let entry = try #require(CompatibilityManifest.load().cases.first { $0.id == "coreyhaines31/marketingskills:aso-audit" })
        let spec = try CompatibilitySourceSpec(entry.record.skill), commit = String(repeating: "a", count: 40)
        for error in [GitCommandError.failed(status: 128), .unavailable, .outputTooLarge, .invalidOutput] {
            let git = CompatibilityTreeGit(expected: ["--git-dir", "/unused", "ls-tree", "-z", commit,
                "--", spec.packageRoot], result: .failure(error))
            await #expect {
                try await CompatibilitySourceTree.resolve(git: git, reference: URL(fileURLWithPath: "/unused"),
                    commit: commit, spec: spec, allowUnavailable: true)
            } throws: { ($0 as? GitCommandError) == error }
        }
    }

    @Test func availableTreeRequiresExactDirectoryAndValidGitOutput() async throws {
        let entry = try #require(CompatibilityManifest.load().cases.first { $0.id == "coreyhaines31/marketingskills:aso-audit" })
        let spec = try CompatibilitySourceSpec(entry.record.skill)
        let commit = String(repeating: "a", count: 40), tree = String(repeating: "b", count: 40)
        let expected = ["--git-dir", "/unused", "ls-tree", "-z", commit, "--", spec.packageRoot]
        let valid = "040000 tree \(tree)\t\(spec.packageRoot)\0"
        #expect(try await CompatibilitySourceTree.resolve(git: CompatibilityTreeGit(expected: expected, result: .success(Data(valid.utf8))),
            reference: URL(fileURLWithPath: "/unused"), commit: commit, spec: spec, allowUnavailable: true) == .available(tree))
        for invalid in ["100644 blob \(tree)\t\(spec.packageRoot)\0", "040000 tree \(tree)\tother\0",
                        "040000 tree invalid\t\(spec.packageRoot)\0", String(valid.dropLast()), valid + valid] {
            await #expect(throws: CompatibilityError.self) {
                try await CompatibilitySourceTree.resolve(git: CompatibilityTreeGit(expected: expected, result: .success(Data(invalid.utf8))),
                    reference: URL(fileURLWithPath: "/unused"), commit: commit, spec: spec, allowUnavailable: true)
            }
        }
    }

    @Test func rootPackageStillRequiresValidTreeAndPropagatesFailure() async throws {
        let entry = try #require(CompatibilityManifest.load().cases.first { $0.id == "hardikpandya/stop-slop:stop-slop" })
        let spec = try CompatibilitySourceSpec(entry.record.skill)
        #expect(spec.packageRoot == ".")
        let commit = String(repeating: "a", count: 40), tree = String(repeating: "b", count: 40)
        let expected = ["--git-dir", "/unused", "rev-parse", commit + "^{tree}"]
        #expect(try await CompatibilitySourceTree.resolve(git: CompatibilityTreeGit(expected: expected, result: .success(Data((tree + "\n").utf8))),
            reference: URL(fileURLWithPath: "/unused"), commit: commit, spec: spec, allowUnavailable: true) == .available(tree))
        await #expect(throws: CompatibilityError.self) {
            try await CompatibilitySourceTree.resolve(git: CompatibilityTreeGit(expected: expected, result: .success(Data())),
                reference: URL(fileURLWithPath: "/unused"), commit: commit, spec: spec, allowUnavailable: true)
        }
        await #expect(throws: GitCommandError.self) {
            try await CompatibilitySourceTree.resolve(git: CompatibilityTreeGit(expected: expected, result: .failure(.failed(status: 128))),
                reference: URL(fileURLWithPath: "/unused"), commit: commit, spec: spec, allowUnavailable: true)
        }
    }

    @Test func receiptSeparatesUnavailableVerifiedAndUntestedByAgent() throws {
        let cases = [
            CompatibilityOutcome(id: "missing", agent: "codex", status: "source-unavailable", sourceUnavailableReason: "Missing path", sourceCommit: "a"),
            CompatibilityOutcome(id: "later", agent: "codex", status: "installed-full-files-verified", treeSHA: "b"),
            CompatibilityOutcome(id: "control", agent: "claude", status: "manual-passed-full-files-verified-read-only", treeSHA: "c"),
            CompatibilityOutcome(id: "ready", agent: "claude", status: "not-run", treeSHA: "d"),
            CompatibilityOutcome(id: "unknown", agent: "codex", status: "not-run")
        ]
        let summary = CompatibilityCounts.summarize(cases)
        #expect(summary["all"] == CompatibilityCounts(total: 5, sourceAvailable: 3, sourceUnavailable: 1, verified: 2, untested: 2))
        #expect(summary["claude"] == CompatibilityCounts(total: 2, sourceAvailable: 2, sourceUnavailable: 0, verified: 1, untested: 1))
        #expect(summary["codex"] == CompatibilityCounts(total: 3, sourceAvailable: 1, sourceUnavailable: 1, verified: 1, untested: 1))
        let receipt = CompatibilityReceipt(baseline: "test", createdAt: "test", root: "/unused", summary: summary, cases: cases)
        let decoded = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(receipt)) as? [String: Any])
        #expect(decoded["summary"] != nil)
        let outcomes = try #require(decoded["cases"] as? [[String: Any]])
        #expect(outcomes.first?["sourceUnavailableReason"] as? String == "Missing path")
        #expect(CompatibilityCounts.summarize([])["all"] == CompatibilityCounts())
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["OMGSKILLS_CATALOG_COMPATIBILITY_RUN"] == "YES_INSTALL_PUBLIC_SAMPLE"),
          .timeLimit(.minutes(30)))
    func approvedLivePublicSample() async throws {
        try await CompatibilityLiveBatch.run(try CompatibilityManifest.load())
    }
}

private struct CompatibilityFakeGit: GitCommandRunning {
    let head: String
    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        if arguments.first == "clone" { return Data() }
        guard arguments.contains("rev-parse") else { throw CompatibilityError.stopped("Unexpected offline Git command.") }
        return Data((head + "\n").utf8)
    }
}

private struct CompatibilityTreeGit: GitCommandRunning {
    let expected: [String]
    let result: Result<Data, GitCommandError>
    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        guard arguments == expected else { throw CompatibilityError.stopped("Unexpected offline tree query.") }
        return try result.get()
    }
}

private struct CompatibilityLocalCloneGit: GitCommandRunning {
    let base: GitCommandRunner
    let repository: URL
    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        if arguments.first == "clone" {
            guard arguments.count == 3, arguments[1] == "https://github.com/owner/repo" else {
                throw CompatibilityError.stopped("Unexpected offline clone.")
            }
            let output = try await base.run(arguments: ["clone", repository.path, arguments[2]], maximumOutputBytes: maximumOutputBytes)
            _ = try await base.run(arguments: ["-C", arguments[2], "config", "remote.origin.url", arguments[1]], maximumOutputBytes: 1024)
            return output
        }
        return try await base.run(arguments: arguments, maximumOutputBytes: maximumOutputBytes)
    }
}

private struct CompatibilityReference {
    let commit: String
    let tree: String
    let files: [CompatibilityGitEntry]
    let spec: CompatibilitySourceSpec
}

private struct CompatibilityOutcome: Codable {
    let id: String
    let agent: String
    var status: String
    var sourceUnavailableReason: String?
    var sourceCommit: String?
    var treeSHA: String?
    var snapshot: CompatibilitySnapshot?
}

private struct CompatibilityCounts: Encodable, Equatable {
    var total = 0
    var sourceAvailable = 0
    var sourceUnavailable = 0
    var verified = 0
    var untested = 0

    static func summarize(_ cases: [CompatibilityOutcome]) -> [String: Self] {
        var result = ["all": Self(), "claude": Self(), "codex": Self()]
        for entry in cases {
            for key in ["all", entry.agent] {
                result[key, default: Self()].total += 1
                if entry.status == "source-unavailable" {
                    result[key, default: Self()].sourceUnavailable += 1
                } else {
                    if entry.treeSHA != nil { result[key, default: Self()].sourceAvailable += 1 }
                    if ["installed-full-files-verified", "manual-passed-full-files-verified-read-only"].contains(entry.status) {
                        result[key, default: Self()].verified += 1
                    } else { result[key, default: Self()].untested += 1 }
                }
            }
        }
        return result
    }
}

private struct CompatibilityReceipt: Encodable {
    let baseline: String
    let createdAt: String
    let root: String
    let boundary = "Same real installer; isolated homes. No UI, agent discovery, production or release claim."
    var phase = "record-check"
    var activeID: String?
    var status = "running"
    var failure: String?
    var summary: [String: CompatibilityCounts] = [:]
    var cases: [CompatibilityOutcome]
}

private enum CompatibilityLiveBatch {
    static func run(_ manifest: CompatibilityManifest) async throws {
        let fm = FileManager.default
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-catalog-compatibility-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let canonical = root.resolvingSymlinksInPath()
        let paths = SkillFilesystemPaths.isolated(testRoot: canonical)
        var receipt = CompatibilityReceipt(baseline: manifest.sourceCommit, createdAt: Date().ISO8601Format(), root: root.path,
            cases: manifest.cases.map { CompatibilityOutcome(id: $0.id, agent: $0.agent, status: $0.status == "pending" ? "not-run" : "manual-passed-awaiting-full-file-check") })
        defer {
            do {
                receipt.summary = CompatibilityCounts.summarize(receipt.cases)
                let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                try encoder.encode(receipt).write(to: root.appendingPathComponent("results.json"), options: .atomic)
                print("Compatibility receipt: " + root.appendingPathComponent("results.json").path)
            } catch { Issue.record("Cannot save compatibility receipt: \(error)") }
        }
        do {
            try fm.createDirectory(at: paths.homeDirectory, withIntermediateDirectories: false)
            let manual = URL(fileURLWithPath: manifest.manualRoot).resolvingSymlinksInPath()
            let expectedManual = URL(fileURLWithPath: "/private/tmp").resolvingSymlinksInPath()
                .appendingPathComponent(URL(fileURLWithPath: manifest.manualRoot).lastPathComponent)
            guard manual.standardizedFileURL == expectedManual.standardizedFileURL else {
                throw CompatibilityError.stopped("Manual test root is redirected.")
            }
            let metadata = try JSONSerialization.jsonObject(with: Data(contentsOf: manual.appendingPathComponent("receipt.json"))) as? [String: Any]
            guard metadata?["root"] as? String == manifest.manualRoot,
                  metadata?["bundleID"] as? String == "com.jonslimak.omgskills.f1",
                  metadata?["scheme"] as? String == "omgskills-f1", metadata?["catalogInstall"] as? Bool == true
            else { throw CompatibilityError.stopped("Manual control receipt is unavailable or changed.") }
            let manualPaths = SkillFilesystemPaths.isolated(testRoot: manual)
            let client = try CatalogInstallRecordClient(localOrigin: manifest.localOrigin)
            for entry in manifest.cases {
                receipt.activeID = entry.id
                guard let current = try await client.fetch(id: entry.id), current.hasSameInstallation(as: entry.record)
                else { throw CompatibilityError.stopped("Local record changed or became unavailable: " + entry.id) }
            }
            receipt.phase = "source-preflight"
            let git = try await SkillInstaller.usableGitRunner()
            let referenceGit = git
            var sources: [String: (URL, String)] = [:]
            var references: [Int: CompatibilityReference] = [:]
            var legacyCommits: [String: String] = [:]
            for (index, entry) in manifest.cases.enumerated() {
                receipt.activeID = entry.id
                let spec = try CompatibilitySourceSpec(entry.record.skill)
                var requested = spec.pinned?.coordinates.commitSha ?? "HEAD"
                if entry.status == "manual-passed", spec.pinned == nil {
                    let cache = manualPaths.legacyRepoCacheRoot.appendingPathComponent(try SkillInstaller.installationSpec(for: entry.record.skill).repoCacheName)
                    guard CompatibilityVerifier.contained(cache, in: manual) else { throw CompatibilityError.stopped("Manual cache escaped test root.") }
                    requested = try await text(git, ["-C", cache.path, "rev-parse", "HEAD"])
                }
                let key = spec.remote + "@" + requested
                let source: (URL, String)
                if let cached = sources[key] { source = cached }
                else {
                    let reference = canonical.appendingPathComponent("reference-" + CompatibilityVerifier.hash(Data(key.utf8)))
                    _ = try await referenceGit.run(arguments: ["init", "--bare", "--quiet", reference.path], maximumOutputBytes: 1024)
                    _ = try await referenceGit.run(arguments: ["--git-dir", reference.path, "fetch", "--quiet", "--depth=1", "--no-tags", spec.remote, requested], maximumOutputBytes: 1024 * 1024)
                    let commit = try await text(referenceGit, ["--git-dir", reference.path, "rev-parse", "FETCH_HEAD^{commit}"])
                    source = (reference, commit); sources[key] = source
                }
                receipt.cases[index].sourceCommit = source.1
                let tree: String
                switch try await CompatibilitySourceTree.resolve(git: referenceGit, reference: source.0, commit: source.1,
                    spec: spec, allowUnavailable: entry.status == "pending") {
                case .available(let value): tree = value
                case .unavailable(let reason):
                    receipt.cases[index].status = "source-unavailable"
                    receipt.cases[index].sourceUnavailableReason = reason
                    print("Source unavailable: \(entry.id): \(reason)")
                    continue
                }
                let files = try CompatibilityGitEntry.parse(await referenceGit.run(arguments:
                    ["--git-dir", source.0.path, "ls-tree", "-r", "-l", "-z", tree], maximumOutputBytes: 2 * 1024 * 1024))
                if let pin = spec.pinned {
                    guard source.1 == pin.coordinates.commitSha, tree == pin.coordinates.treeSha,
                          files.first(where: { $0.path == "SKILL.md" })?.blobSHA == pin.coordinates.skillMdSha
                    else { throw CompatibilityError.stopped("Pinned source coordinates disagree.") }
                } else if entry.status == "pending" { legacyCommits[spec.remote] = source.1 }
                references[index] = CompatibilityReference(commit: source.1, tree: tree, files: files, spec: spec)
                receipt.cases[index].sourceCommit = source.1; receipt.cases[index].treeSHA = tree
            }
            receipt.phase = "manual-controls"
            var completed: [Int: CompatibilitySnapshot] = [:]
            for (index, entry) in manifest.cases.enumerated() where entry.status == "manual-passed" {
                receipt.activeID = entry.id
                guard let ref = references[index] else { throw CompatibilityError.stopped("Manual source reference is missing.") }
                let snapshot = try CompatibilityVerifier.install(entry, spec: ref.spec, paths: manualPaths, boundary: manual, files: ref.files)
                completed[index] = snapshot; receipt.cases[index].snapshot = snapshot
                receipt.cases[index].status = "manual-passed-full-files-verified-read-only"
            }
            let audited = CompatibilityAuditGit(base: git, legacyCommits: legacyCommits, boundary: canonical)
            let installer = CatalogSkillInstaller(packageFetcher: GitPublicSkillPackageFetcher(temporaryRoot: canonical),
                managedInstaller: ManagedSkillInstaller(managedRoot: canonical.appendingPathComponent("managed"), pathAnchor: paths.homeDirectory), filesystemPaths: paths)
            let service = CatalogInstallService(installer: installer, gitProvider: { audited })
            for (index, entry) in manifest.cases.enumerated() where entry.status == "pending" {
                try Task.checkCancellation()
                if receipt.cases[index].status == "source-unavailable" { continue }
                receipt.activeID = entry.id; receipt.phase = "install"
                guard let ref = references[index] else { throw CompatibilityError.stopped("Install source reference is missing.") }
                guard try await service.destination(for: entry.record.skill, target: entry.target) == paths.skillsRoot(for: entry.target).appendingPathComponent(ref.spec.name)
                else { throw CompatibilityError.stopped("Destination differs from native source rules.") }
                let result = await service.install(entry.record.skill, target: entry.target)
                guard result == .installed else { throw CompatibilityError.stopped("Install result: \(result)") }
                receipt.phase = "verification"
                let snapshot = try CompatibilityVerifier.install(entry, spec: ref.spec, paths: paths, boundary: canonical, files: ref.files)
                if entry.categories.contains("binary-companions"), !snapshot.files.contains(where: \.binary) {
                    throw CompatibilityError.stopped("Binary coverage label no longer matches source.")
                }
                if entry.categories.contains("large-package"), snapshot.files.reduce(0, { $0 + $1.bytes }) < 1_000_000 {
                    throw CompatibilityError.stopped("Large-package coverage label no longer matches source.")
                }
                for (previous, baseline) in completed {
                    let control = manifest.cases[previous]
                    guard let old = references[previous] else { throw CompatibilityError.stopped("Earlier source reference is missing.") }
                    let isManual = control.status == "manual-passed"
                    guard try CompatibilityVerifier.install(control, spec: old.spec, paths: isManual ? manualPaths : paths,
                        boundary: isManual ? manual : canonical, files: old.files) == baseline
                    else { throw CompatibilityError.stopped("An earlier installation changed.") }
                }
                completed[index] = snapshot; receipt.cases[index].snapshot = snapshot; receipt.cases[index].status = "installed-full-files-verified"
            }
            receipt.phase = "complete"; receipt.activeID = nil
            receipt.status = receipt.cases.contains { $0.status == "source-unavailable" }
                ? "completed-with-unavailable-sources" : "passed"
        } catch {
            receipt.status = "stopped"; receipt.failure = String(describing: error)
            throw error
        }
    }

    private static func text(_ git: any GitCommandRunning, _ arguments: [String]) async throws -> String {
        String(decoding: try await git.run(arguments: arguments, maximumOutputBytes: 1024), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
#endif
