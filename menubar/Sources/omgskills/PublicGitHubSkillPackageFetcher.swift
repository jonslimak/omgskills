import Foundation

enum GitCommandError: Error, Equatable, Sendable {
    case unavailable
    case failed(status: Int32)
    case outputTooLarge
    case invalidOutput
}

protocol GitCommandRunning: Sendable {
    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data
}

struct GitCommandRunner: GitCommandRunning, Sendable {
    private let executableURL: URL
    private let temporaryRoot: URL

    init(
        executableURL: URL = URL(fileURLWithPath: "/usr/bin/git"),
        temporaryRoot: URL = FileManager.default.temporaryDirectory
    ) {
        self.executableURL = executableURL
        self.temporaryRoot = temporaryRoot
    }

    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        guard FileManager.default.isExecutableFile(atPath: executableURL.path) else {
            throw GitCommandError.unavailable
        }
        try Task.checkCancellation()

        let commandRoot = temporaryRoot
            .appendingPathComponent("omgskills-git-command-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: commandRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: commandRoot) }

        let stdoutURL = commandRoot.appendingPathComponent("stdout")
        let stderrURL = commandRoot.appendingPathComponent("stderr")
        FileManager.default.createFile(atPath: stdoutURL.path, contents: nil)
        FileManager.default.createFile(atPath: stderrURL.path, contents: nil)
        let stdout = try FileHandle(forWritingTo: stdoutURL)
        let stderr = try FileHandle(forWritingTo: stderrURL)
        defer {
            try? stdout.close()
            try? stderr.close()
        }

        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        process.standardOutput = stdout
        process.standardError = stderr
        var environment = ProcessInfo.processInfo.environment
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GIT_LITERAL_PATHSPECS"] = "1"
        environment["LC_ALL"] = "C"
        process.environment = environment

        let status = try await ProcessExecution.run(process)
        try Task.checkCancellation()
        guard status == 0 else {
            throw GitCommandError.failed(status: status)
        }
        try stdout.synchronize()
        let attributes = try FileManager.default.attributesOfItem(atPath: stdoutURL.path)
        guard let size = attributes[.size] as? NSNumber,
              size.int64Value <= Int64(maximumOutputBytes) else {
            throw GitCommandError.outputTooLarge
        }
        return try Data(contentsOf: stdoutURL)
    }
}

private enum ProcessExecution {
    static func run(_ process: Process) async throws -> Int32 {
        let state = ProcessExecutionState(process: process)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                state.start(continuation)
            }
        } onCancel: {
            state.cancel()
        }
    }
}

// Process has no async API. This box protects the single continuation and cancellation race.
private final class ProcessExecutionState: @unchecked Sendable {
    private let lock = NSLock()
    private let process: Process
    private var continuation: CheckedContinuation<Int32, any Error>?
    private var cancelled = false
    private var completed = false

    init(process: Process) {
        self.process = process
    }

    func start(_ continuation: CheckedContinuation<Int32, any Error>) {
        lock.lock()
        guard !completed else {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        if cancelled {
            completed = true
            self.continuation = nil
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        process.terminationHandler = { [weak self] process in
            self?.finish(status: process.terminationStatus)
        }
        do {
            try process.run()
        } catch {
            lock.unlock()
            finish(error: error)
            return
        }
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let shouldTerminate = !completed && process.isRunning
        lock.unlock()
        if shouldTerminate {
            process.terminate()
        }
    }

    private func finish(status: Int32) {
        lock.lock()
        guard !completed, let continuation else {
            lock.unlock()
            return
        }
        completed = true
        self.continuation = nil
        let wasCancelled = cancelled
        lock.unlock()
        if wasCancelled {
            continuation.resume(throwing: CancellationError())
        } else {
            continuation.resume(returning: status)
        }
    }

    private func finish(error: any Error) {
        lock.lock()
        guard !completed, let continuation else {
            lock.unlock()
            return
        }
        completed = true
        self.continuation = nil
        let wasCancelled = cancelled
        lock.unlock()
        continuation.resume(throwing: wasCancelled ? CancellationError() : error)
    }
}

struct GitPublicSkillPackageFetcher: PublicSkillPackageFetching, Sendable {
    typealias RemoteURLBuilder = @Sendable (String) -> URL?

    private static let maximumCommandOutputBytes = 1 * 1024 * 1024
    private static let maximumTreeOutputBytes = 2 * 1024 * 1024

    private let runner: any GitCommandRunning
    private let temporaryRoot: URL
    private let limits: SkillPackageValidationLimits
    private let remoteURL: RemoteURLBuilder

    init(
        runner: any GitCommandRunning = GitCommandRunner(),
        temporaryRoot: URL = FileManager.default.temporaryDirectory,
        limits: SkillPackageValidationLimits = .standard,
        remoteURL: @escaping RemoteURLBuilder = Self.githubRemoteURL
    ) {
        self.runner = runner
        self.temporaryRoot = temporaryRoot
        self.limits = limits
        self.remoteURL = remoteURL
    }

    func fetchPackage(
        repositorySlug: String,
        normalizedRoot: String,
        expected: SkillPackageCoordinates
    ) async throws -> SkillPackage {
        guard let repository = GitHubRepositorySlug.normalized(repositorySlug),
              let remote = remoteURL(repository),
              let rootComponents = Self.validatedRootComponents(normalizedRoot) else {
            throw GroupSkillPackageLoaderError.invalidPublicRepository(repositorySlug)
        }

        let repositoryRoot = temporaryRoot
            .appendingPathComponent("omgskills-public-package-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: repositoryRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: repositoryRoot) }

        do {
            _ = try await runGit(
                ["init", "--bare", "--quiet", repositoryRoot.path],
                maximumOutputBytes: Self.maximumCommandOutputBytes
            )
            do {
                _ = try await runGit(
                    [
                        "--git-dir", repositoryRoot.path,
                        "fetch", "--quiet", "--depth=1", "--no-tags",
                        remote.absoluteString, expected.commitSha
                    ],
                    maximumOutputBytes: Self.maximumCommandOutputBytes
                )
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                throw GroupSkillPackageLoaderError.repositoryUnavailable
            }

            let fetchedCommit = try await gitText([
                "--git-dir", repositoryRoot.path,
                "rev-parse", "--verify", "FETCH_HEAD^{commit}"
            ])
            guard fetchedCommit.caseInsensitiveCompare(expected.commitSha) == .orderedSame else {
                throw GroupSkillPackageLoaderError.packageUnavailable
            }

            var treeSha = try await gitText([
                "--git-dir", repositoryRoot.path,
                "rev-parse", "--verify", "\(fetchedCommit)^{tree}"
            ])
            for component in rootComponents {
                let childData = try await runGit(
                    ["--git-dir", repositoryRoot.path, "ls-tree", "-z", treeSha, "--", component],
                    maximumOutputBytes: Self.maximumCommandOutputBytes
                )
                let children = try Self.parseTreeEntries(childData)
                guard children.count == 1,
                      children[0].path == component,
                      children[0].mode == "040000",
                      children[0].type == "tree" else {
                    throw GroupSkillPackageLoaderError.packageUnavailable
                }
                treeSha = children[0].sha
            }
            guard treeSha.caseInsensitiveCompare(expected.treeSha) == .orderedSame else {
                throw SkillPackageValidationError(code: .treeShaMismatch, path: nil)
            }

            let treeData = try await runGit(
                ["--git-dir", repositoryRoot.path, "ls-tree", "-r", "-z", treeSha],
                maximumOutputBytes: Self.maximumTreeOutputBytes
            )
            let treeEntries = try Self.parseTreeEntries(treeData)
            guard treeEntries.count <= limits.maximumFileCount else {
                throw SkillPackageValidationError(code: .tooManyFiles, path: nil)
            }

            var sizedEntries: [(entry: GitTreeEntry, size: Int)] = []
            sizedEntries.reserveCapacity(treeEntries.count)
            var totalBytes = 0
            for entry in treeEntries {
                try Task.checkCancellation()
                guard entry.type == "blob" else {
                    let code: SkillPackageValidationFailureCode = entry.mode == "160000"
                        ? .submodule : .unsupportedEntryType
                    throw SkillPackageValidationError(code: code, path: entry.path)
                }
                guard entry.mode == "100644" || entry.mode == "100755" else {
                    let code: SkillPackageValidationFailureCode = entry.mode == "120000"
                        ? .symbolicLink : .unsupportedEntryType
                    throw SkillPackageValidationError(code: code, path: entry.path)
                }
                let size = try await gitObjectSize(repositoryRoot: repositoryRoot, sha: entry.sha)
                guard size <= limits.maximumFileBytes else {
                    throw SkillPackageValidationError(code: .fileTooLarge, path: entry.path)
                }
                if entry.path == "SKILL.md", size > limits.maximumSkillMdBytes {
                    throw SkillPackageValidationError(code: .skillMdTooLarge, path: entry.path)
                }
                let (newTotal, overflow) = totalBytes.addingReportingOverflow(size)
                guard !overflow, newTotal <= limits.maximumTotalBytes else {
                    throw SkillPackageValidationError(code: .packageTooLarge, path: nil)
                }
                totalBytes = newTotal
                sizedEntries.append((entry, size))
            }

            var entries: [SkillPackageEntry] = []
            entries.reserveCapacity(sizedEntries.count)
            for (entry, expectedSize) in sizedEntries {
                try Task.checkCancellation()
                let data: Data
                do {
                    data = try await runGit(
                        ["--git-dir", repositoryRoot.path, "cat-file", "blob", entry.sha],
                        maximumOutputBytes: limits.maximumFileBytes
                    )
                } catch GitCommandError.outputTooLarge {
                    throw SkillPackageValidationError(code: .fileTooLarge, path: entry.path)
                }
                guard data.count == expectedSize else {
                    throw GroupSkillPackageLoaderError.packageUnavailable
                }
                entries.append(SkillPackageEntry(
                    path: entry.path,
                    mode: entry.mode,
                    data: data,
                    blobSha: entry.sha
                ))
            }

            let package = SkillPackage(coordinates: expected, entries: entries)
            _ = try SkillPackageValidator.validate(package, expected: expected, limits: limits)
            return package
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as GroupSkillPackageLoaderError {
            throw error
        } catch let error as SkillPackageValidationError {
            throw error
        } catch {
            throw GroupSkillPackageLoaderError.packageUnavailable
        }
    }

    private func runGit(_ arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        do {
            return try await runner.run(arguments: arguments, maximumOutputBytes: maximumOutputBytes)
        } catch is CancellationError {
            throw CancellationError()
        }
    }

    private func gitText(_ arguments: [String]) async throws -> String {
        let data = try await runGit(arguments, maximumOutputBytes: Self.maximumCommandOutputBytes)
        guard let value = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              value.utf8.count == 40,
              value.utf8.allSatisfy({ byte in
                  (48...57).contains(byte) || (65...70).contains(byte) || (97...102).contains(byte)
              }) else {
            throw GitCommandError.invalidOutput
        }
        return value.lowercased()
    }

    private func gitObjectSize(repositoryRoot: URL, sha: String) async throws -> Int {
        let data = try await runGit(
            ["--git-dir", repositoryRoot.path, "cat-file", "-s", sha],
            maximumOutputBytes: 64
        )
        guard let value = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              let size = Int(value),
              size >= 0 else {
            throw GitCommandError.invalidOutput
        }
        return size
    }

    private static func validatedRootComponents(_ value: String) -> [String]? {
        if value == "." { return [] }
        guard !value.isEmpty,
              !value.hasPrefix("/"),
              !value.hasSuffix("/"),
              !value.contains("\\"),
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            return nil
        }
        let components = value.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard components.allSatisfy({ component in
            !component.isEmpty && component != "." && component != ".." &&
                component.lowercased() != ".git"
        }) else {
            return nil
        }
        return components
    }

    private static func parseTreeEntries(_ data: Data) throws -> [GitTreeEntry] {
        guard data.isEmpty || data.last == 0 else {
            throw GitCommandError.invalidOutput
        }
        var entries: [GitTreeEntry] = []
        for record in data.split(separator: 0, omittingEmptySubsequences: true) {
            guard let tab = record.firstIndex(of: 9),
                  let metadata = String(data: record[..<tab], encoding: .utf8),
                  let path = String(data: record[record.index(after: tab)...], encoding: .utf8) else {
                throw GitCommandError.invalidOutput
            }
            let parts = metadata.split(separator: " ", omittingEmptySubsequences: true)
            guard parts.count == 3,
                  parts[2].utf8.count == 40,
                  parts[2].utf8.allSatisfy({ byte in
                      (48...57).contains(byte) || (97...102).contains(byte)
                  }) else {
                throw GitCommandError.invalidOutput
            }
            entries.append(GitTreeEntry(
                mode: String(parts[0]),
                type: String(parts[1]),
                sha: String(parts[2]),
                path: path
            ))
        }
        return entries
    }
}

private struct GitTreeEntry: Sendable {
    let mode: String
    let type: String
    let sha: String
    let path: String
}

private extension GitPublicSkillPackageFetcher {
    static func githubRemoteURL(repositorySlug: String) -> URL? {
        URL(string: "https://github.com/\(repositorySlug).git")
    }
}
