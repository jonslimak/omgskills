import Foundation
import Testing
@testable import omgskills

struct PublicGitHubSkillPackageFetcherTests {
    @Test func fetchesPinnedNestedTreeFromLocalGitRepository() async throws {
        let fixture = try LocalGitPackageRepository()
        defer { fixture.remove() }
        let fetcher = GitPublicSkillPackageFetcher(
            temporaryRoot: fixture.temporaryRoot,
            remoteURL: { _ in fixture.repositoryRoot }
        )

        let package = try await fetcher.fetchPackage(
            repositorySlug: "Owner/Repo",
            normalizedRoot: "skills/example",
            expected: fixture.coordinates
        )

        #expect(package.coordinates == fixture.coordinates)
        #expect(package.entries.map(\.path) == [
            "SKILL.md",
            "references/info.txt",
            "scripts/run.sh"
        ])
        #expect(package.entries.first { $0.path == "scripts/run.sh" }?.mode == "100755")
        _ = try SkillPackageValidator.validate(package, expected: fixture.coordinates)
    }

    @Test func rejectsMismatchedPinnedTree() async throws {
        let fixture = try LocalGitPackageRepository()
        defer { fixture.remove() }
        let fetcher = GitPublicSkillPackageFetcher(
            temporaryRoot: fixture.temporaryRoot,
            remoteURL: { _ in fixture.repositoryRoot }
        )
        let mismatched = SkillPackageCoordinates(
            commitSha: fixture.coordinates.commitSha,
            treeSha: String(repeating: "2", count: 40),
            skillMdSha: fixture.coordinates.skillMdSha
        )

        await #expect(throws: SkillPackageValidationError.self) {
            try await fetcher.fetchPackage(
                repositorySlug: "owner/repo",
                normalizedRoot: "skills/example",
                expected: mismatched
            )
        }
    }

    @Test func rejectsUnsafeRepositoryAndRootBeforeGitRuns() async {
        let runner = CountingGitRunner()
        let fetcher = GitPublicSkillPackageFetcher(runner: runner)

        await #expect(throws: GroupSkillPackageLoaderError.invalidPublicRepository("owner/repo?token=x")) {
            try await fetcher.fetchPackage(
                repositorySlug: "owner/repo?token=x",
                normalizedRoot: ".",
                expected: GroupSkillPackageTestSupport.coordinates
            )
        }
        await #expect(throws: GroupSkillPackageLoaderError.invalidPublicRepository("owner/repo")) {
            try await fetcher.fetchPackage(
                repositorySlug: "owner/repo",
                normalizedRoot: "../skill",
                expected: GroupSkillPackageTestSupport.coordinates
            )
        }
        #expect(await runner.callCount() == 0)
    }

    @Test func preservesGitCancellation() async {
        let fetcher = GitPublicSkillPackageFetcher(runner: CancellingGitRunner())

        await #expect(throws: CancellationError.self) {
            try await fetcher.fetchPackage(
                repositorySlug: "owner/repo",
                normalizedRoot: ".",
                expected: GroupSkillPackageTestSupport.coordinates
            )
        }
    }

    @Test func commandRunnerEnforcesOutputLimitWithoutLoadingOversizedOutput() async throws {
        let runner = GitCommandRunner(executableURL: URL(fileURLWithPath: "/bin/sh"))

        await #expect(throws: GitCommandError.outputTooLarge) {
            try await runner.run(arguments: ["-c", "printf 12345"], maximumOutputBytes: 4)
        }
        let data = try await runner.run(arguments: ["-c", "printf 1234"], maximumOutputBytes: 4)
        #expect(String(data: data, encoding: .utf8) == "1234")
    }

    @Test func rejectsOversizedBlobBeforeReadingItsContents() async {
        let runner = OversizedBlobGitRunner()
        let limits = SkillPackageValidationLimits(
            maximumFileCount: 10,
            maximumTotalBytes: 100,
            maximumFileBytes: 10,
            maximumSkillMdBytes: 10
        )
        let fetcher = GitPublicSkillPackageFetcher(runner: runner, limits: limits)

        await #expect(
            throws: SkillPackageValidationError(code: .fileTooLarge, path: "SKILL.md")
        ) {
            try await fetcher.fetchPackage(
                repositorySlug: "owner/repo",
                normalizedRoot: ".",
                expected: GroupSkillPackageTestSupport.coordinates
            )
        }
        #expect(await runner.blobReadCount() == 0)
    }
}

private actor CountingGitRunner: GitCommandRunning {
    private var count = 0

    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        count += 1
        return Data()
    }

    func callCount() -> Int {
        count
    }
}

private struct CancellingGitRunner: GitCommandRunning {
    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        throw CancellationError()
    }
}

private actor OversizedBlobGitRunner: GitCommandRunning {
    private var reads = 0

    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        if arguments.contains("init") || arguments.contains("fetch") {
            return Data()
        }
        if arguments.contains("rev-parse") {
            let sha = arguments.last?.contains("tree") == true
                ? GroupSkillPackageTestSupport.treeSha
                : GroupSkillPackageTestSupport.commitSha
            return Data("\(sha)\n".utf8)
        }
        if arguments.contains("ls-tree") {
            let record = "100644 blob \(GroupSkillPackageTestSupport.skillMdSha)\tSKILL.md"
            return Data(record.utf8) + Data([0])
        }
        if arguments.contains("-s") {
            return Data("11\n".utf8)
        }
        if arguments.contains("blob") {
            reads += 1
            return Data(repeating: 0, count: 11)
        }
        throw GitCommandError.invalidOutput
    }

    func blobReadCount() -> Int {
        reads
    }
}

private struct LocalGitPackageRepository: Sendable {
    let root: URL
    let temporaryRoot: URL
    let repositoryRoot: URL
    let coordinates: SkillPackageCoordinates

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("omgskills-git-fixture-\(UUID().uuidString)", isDirectory: true)
        temporaryRoot = root.appendingPathComponent("temporary", isDirectory: true)
        repositoryRoot = root.appendingPathComponent("repository", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: repositoryRoot, withIntermediateDirectories: true)

        _ = try Self.git(["init", "--quiet", repositoryRoot.path])
        let skillRoot = repositoryRoot.appendingPathComponent("skills/example", isDirectory: true)
        let references = skillRoot.appendingPathComponent("references", isDirectory: true)
        let scripts = skillRoot.appendingPathComponent("scripts", isDirectory: true)
        try FileManager.default.createDirectory(at: references, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: scripts, withIntermediateDirectories: true)
        let skillData = Data(
            """
            ---
            name: example
            description: Example package.
            ---

            """.utf8
        )
        try skillData.write(to: skillRoot.appendingPathComponent("SKILL.md"))
        try Data("reference\n".utf8).write(to: references.appendingPathComponent("info.txt"))
        let script = scripts.appendingPathComponent("run.sh")
        try Data("#!/bin/sh\necho hello\n".utf8).write(to: script)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: script.path
        )
        try Data("outside package\n".utf8).write(to: repositoryRoot.appendingPathComponent("README.md"))

        _ = try Self.git(["-C", repositoryRoot.path, "add", "."])
        _ = try Self.git([
            "-C", repositoryRoot.path,
            "-c", "user.name=omgskills-tests",
            "-c", "user.email=tests@example.com",
            "commit", "--quiet", "-m", "fixture"
        ])
        let commitSha = try Self.gitText(["-C", repositoryRoot.path, "rev-parse", "HEAD"])
        let treeSha = try Self.gitText([
            "-C", repositoryRoot.path,
            "rev-parse", "HEAD:skills/example"
        ])
        let skillMdSha = try Self.gitText([
            "-C", repositoryRoot.path,
            "hash-object", "skills/example/SKILL.md"
        ])
        coordinates = SkillPackageCoordinates(
            commitSha: commitSha,
            treeSha: treeSha,
            skillMdSha: skillMdSha
        )
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    private static func gitText(_ arguments: [String]) throws -> String {
        String(decoding: try git(arguments), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @discardableResult
    private static func git(_ arguments: [String]) throws -> Data {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = Pipe()
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw GitCommandError.failed(status: process.terminationStatus)
        }
        return data
    }
}
