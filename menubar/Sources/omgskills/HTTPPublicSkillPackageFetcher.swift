import CryptoKit
import Foundation

// An opt-in transport, not the app's default. Resolution never needs catalog pins or system Git.
struct HTTPPublicSkillPackageFetcher: PublicSkillPackageFetching, Sendable {
    let http: any PublicGitHubHTTPClient
    let limits: SkillPackageValidationLimits

    init(http: any PublicGitHubHTTPClient = BoundedPublicGitHubHTTPClient(),
         limits: SkillPackageValidationLimits = .standard) {
        self.http = http
        self.limits = limits
    }

    func resolvePackage(_ request: PublicSkillInstallRequest) async throws -> SkillPackage {
        try await load(repository: request.repositorySlug, root: request.packageRoot,
                       commit: request.commitSha, expected: nil)
    }

    func fetchPackage(repositorySlug: String, normalizedRoot: String,
                      expected: SkillPackageCoordinates) async throws -> SkillPackage {
        guard [expected.commitSha, expected.treeSha, expected.skillMdSha].allSatisfy({ Self.isSHA($0.lowercased()) }) else {
            throw SkillPackageValidationError(code: .invalidSha, path: nil)
        }
        return try await load(repository: repositorySlug, root: normalizedRoot,
                              commit: expected.commitSha.lowercased(), expected: expected)
    }

    private func load(repository: String, root: String, commit: String?,
                      expected: SkillPackageCoordinates?) async throws -> SkillPackage {
        guard let repository = GitHubRepositorySlug.normalized(repository),
              root == "." || Self.safePath(root),
              limits.maximumFileCount > 0, limits.maximumFileBytes >= 0,
              limits.maximumSkillMdBytes >= 0, limits.maximumTotalBytes >= 0 else {
            throw PublicGitHubHTTPError.invalidMetadata
        }
        let repo = repository.split(separator: "/").map(String.init)
        let base = ["repos"] + repo
        let resolved: HTTPGitCommit
        if let commit {
            resolved = try await get(base + ["git", "commits", commit])
            guard resolved.sha == commit else { throw PublicGitHubHTTPError.invalidMetadata }
        } else {
            let heads: [HTTPGitHead] = try await get(base + ["commits"], query: "per_page=1")
            guard heads.count == 1, let head = heads.first else { throw PublicGitHubHTTPError.invalidMetadata }
            resolved = HTTPGitCommit(sha: head.sha, tree: head.commit.tree)
        }
        guard Self.isSHA(resolved.sha), Self.isSHA(resolved.tree.sha) else {
            throw PublicGitHubHTTPError.invalidMetadata
        }
        // Trust GitHub HTTPS for commit -> root; hash every ancestor tree, then all package bytes.
        // Once resolved, never use a mutable branch name again in this operation.
        var treeSHA = resolved.tree.sha
        let rootComponents = root == "." ? [] : root.split(separator: "/").map(String.init)
        for component in rootComponents {
            let parent = try await tree(base: base, sha: treeSHA, recursive: false)
            guard try parent.computedSHA() == treeSHA else { throw PublicGitHubHTTPError.invalidMetadata }
            guard let child = parent.tree.first(where: { Data($0.path.utf8) == Data(component.utf8) }),
                  child.type == "tree", child.mode == "040000" else { throw PublicGitHubHTTPError.unavailable }
            treeSHA = child.sha
        }
        if let expected, treeSHA != expected.treeSha.lowercased() {
            throw SkillPackageValidationError(code: .treeShaMismatch, path: nil)
        }
        let selected = try await tree(base: base, sha: treeSHA, recursive: true)
        let files = try validatedFiles(selected)
        guard let skill = files.first(where: { $0.path == "SKILL.md" }) else {
            throw SkillPackageValidationError(code: .missingSkillMd, path: nil)
        }
        if let expected, skill.sha != expected.skillMdSha.lowercased() {
            throw SkillPackageValidationError(code: .skillMdShaMismatch, path: "SKILL.md")
        }
        var entries: [SkillPackageEntry] = []
        for file in files {
            let url = try Self.url(host: "raw.githubusercontent.com", components: repo + [resolved.sha]
                                  + rootComponents + file.path.split(separator: "/").map(String.init))
            var request = URLRequest(url: url)
            request.setValue("OMGSkills-Package", forHTTPHeaderField: "User-Agent")
            let bytes = try await data(request, limit: file.size!)
            guard bytes.count == file.size,
                  SkillIdentityResolver.gitBlobSHA(for: bytes) == file.sha else {
                throw SkillPackageValidationError(code: .blobShaMismatch, path: file.path)
            }
            entries.append(SkillPackageEntry(path: file.path, mode: file.mode, data: bytes, blobSha: file.sha))
        }
        let coordinates = SkillPackageCoordinates(commitSha: resolved.sha, treeSha: treeSHA, skillMdSha: skill.sha)
        let package = SkillPackage(coordinates: coordinates, entries: entries)
        _ = try SkillPackageValidator.validate(package, expected: expected ?? coordinates, limits: limits)
        try Task.checkCancellation()
        return package
    }

    private func validatedFiles(_ tree: HTTPGitTree) throws -> [HTTPGitTree.Entry] {
        var files: [HTTPGitTree.Entry] = []
        var paths = Set<Data>()
        var total = 0
        for entry in tree.tree {
            guard Self.safePath(entry.path), Self.isSHA(entry.sha) else {
                throw PublicGitHubHTTPError.invalidMetadata
            }
            guard paths.insert(Data(entry.path.utf8)).inserted else {
                throw SkillPackageValidationError(code: .duplicatePath, path: entry.path)
            }
            if entry.type == "tree", entry.mode == "040000" { continue }
            if entry.mode == "120000" { throw SkillPackageValidationError(code: .symbolicLink, path: entry.path) }
            if entry.mode == "160000" { throw SkillPackageValidationError(code: .submodule, path: entry.path) }
            guard entry.type == "blob", ["100644", "100755"].contains(entry.mode),
                  let size = entry.size, size >= 0 else { throw PublicGitHubHTTPError.invalidMetadata }
            guard size <= limits.maximumFileBytes else {
                throw SkillPackageValidationError(code: .fileTooLarge, path: entry.path)
            }
            if entry.path == "SKILL.md", size > limits.maximumSkillMdBytes {
                throw SkillPackageValidationError(code: .skillMdTooLarge, path: entry.path)
            }
            let (nextTotal, overflow) = total.addingReportingOverflow(size)
            guard !overflow, nextTotal <= limits.maximumTotalBytes else {
                throw SkillPackageValidationError(code: .packageTooLarge, path: nil)
            }
            total = nextTotal
            files.append(entry)
            guard files.count <= limits.maximumFileCount else {
                throw SkillPackageValidationError(code: .tooManyFiles, path: nil)
            }
        }
        return files.sorted { Array($0.path.utf8).lexicographicallyPrecedes(Array($1.path.utf8)) }
    }

    private func tree(base: [String], sha: String, recursive: Bool) async throws -> HTTPGitTree {
        let result: HTTPGitTree = try await get(base + ["git", "trees", sha], query: recursive ? "recursive=1" : nil)
        guard result.sha == sha, !result.truncated else { throw PublicGitHubHTTPError.invalidMetadata }
        return result
    }

    private func get<T: Decodable>(_ components: [String], query: String? = nil) async throws -> T {
        var request = URLRequest(url: try Self.url(host: "api.github.com", components: components, query: query))
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("OMGSkills-Package", forHTTPHeaderField: "User-Agent")
        let bytes = try await data(request, limit: 2 * 1024 * 1024)
        do { return try JSONDecoder().decode(T.self, from: bytes) }
        catch { throw PublicGitHubHTTPError.invalidMetadata }
    }

    private func data(_ request: URLRequest, limit: Int) async throws -> Data {
        try Task.checkCancellation()
        let bytes: Data
        do { bytes = try await http.data(for: request, limit: limit) }
        catch { try Task.checkCancellation(); throw error }
        try Task.checkCancellation()
        guard bytes.count <= limit else { throw PublicGitHubHTTPError.tooLarge }
        return bytes
    }

    private static func url(host: String, components: [String], query: String? = nil) throws -> URL {
        let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        var url = URLComponents()
        url.scheme = "https"
        url.host = host
        url.percentEncodedPath = "/" + components.map { $0.addingPercentEncoding(withAllowedCharacters: unreserved)! }.joined(separator: "/")
        url.percentEncodedQuery = query
        guard let result = url.url else { throw PublicGitHubHTTPError.invalidMetadata }
        return result
    }

    fileprivate static func isSHA(_ value: String) -> Bool {
        value.utf8.count == 40 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    fileprivate static func safePath(_ path: String) -> Bool {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        return path.utf8.count <= 1024 && parts.count <= 32 && !path.contains("\\")
            && !path.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
            && parts.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." && $0.lowercased() != ".git" }
    }
}

private struct HTTPGitCommit: Decodable {
    let sha: String
    let tree: Reference
    struct Reference: Decodable { let sha: String }
}

private struct HTTPGitHead: Decodable {
    let sha: String
    let commit: Commit
    struct Commit: Decodable { let tree: HTTPGitCommit.Reference }
}

private struct HTTPGitTree: Decodable {
    let sha: String
    let truncated: Bool
    let tree: [Entry]
    struct Entry: Decodable {
        let path: String
        let mode: String
        let type: String
        let sha: String
        let size: Int?
    }

    func computedSHA() throws -> String {
        var seen = Set<Data>()
        var content = Data()
        let sorted = tree.sorted {
            Array(($0.path + ($0.type == "tree" ? "/" : "")).utf8)
                .lexicographicallyPrecedes(Array(($1.path + ($1.type == "tree" ? "/" : "")).utf8))
        }
        for entry in sorted {
            // Unselected siblings may be links/submodules; only the selected package forbids them.
            guard !entry.path.isEmpty, !entry.path.contains("/"), !entry.path.contains("\0"),
                  seen.insert(Data(entry.path.utf8)).inserted,
                  HTTPPublicSkillPackageFetcher.isSHA(entry.sha),
                  (entry.type == "tree" && entry.mode == "040000")
                    || (entry.type == "blob" && ["100644", "100755", "120000"].contains(entry.mode))
                    || (entry.type == "commit" && entry.mode == "160000") else {
                throw PublicGitHubHTTPError.invalidMetadata
            }
            content.append(Data("\(entry.mode == "040000" ? "40000" : entry.mode) \(entry.path)\0".utf8))
            let hex = Array(entry.sha.utf8)
            for index in stride(from: 0, to: hex.count, by: 2) {
                content.append(UInt8(String(decoding: hex[index...index + 1], as: UTF8.self), radix: 16)!)
            }
        }
        return Insecure.SHA1.hash(data: Data("tree \(content.count)\0".utf8) + content)
            .map { String(format: "%02x", $0) }.joined()
    }
}
