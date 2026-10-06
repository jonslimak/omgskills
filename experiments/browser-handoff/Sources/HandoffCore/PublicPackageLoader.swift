import Foundation

struct PublicPin: Equatable, Sendable {
    let id: String
    let repo: String
    let path: String
    let commit: String
    let skillSHA: String
    let treeSHA: String?

    init(id: String, repo: String, path: String, commit: String, skillSHA: String, treeSHA: String?) throws {
        guard repo.split(separator: "/", omittingEmptySubsequences: false).count == 2,
              Self.safeCatalogPath(repo), Self.safeCatalogPath(path),
              Self.isSHA(commit), Self.isSHA(skillSHA), treeSHA.map(Self.isSHA) ?? true else {
            throw PreviewFailure.invalidMetadata
        }
        self.id = id
        self.repo = repo
        self.path = path
        self.commit = commit.lowercased()
        self.skillSHA = skillSHA.lowercased()
        self.treeSHA = treeSHA?.lowercased()
    }

    static func isSHA(_ value: String) -> Bool {
        value.utf8.count == 40 && value.utf8.allSatisfy {
            (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0)
        }
    }

    static func safeCatalogPath(_ path: String) -> Bool {
        safePackagePath(path) && path.utf8.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
                || [45, 46, 47, 95].contains($0)
        }
    }

    static func safePackagePath(_ path: String) -> Bool {
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        return path.utf8.count <= 1024 && components.count <= 32
            && !path.contains("\\")
            && !path.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
            && components.allSatisfy {
                !$0.isEmpty && $0.utf8.count <= 255 && $0 != "." && $0 != ".." && $0.lowercased() != ".git"
            }
    }
}

struct PublicPackageLoader: Sendable {
    let http: any PublicHTTPClient
    static let limits = SkillPackageValidationLimits(
        maximumFileCount: 100, maximumTotalBytes: 8 * 1024 * 1024,
        maximumFileBytes: 1024 * 1024, maximumSkillMdBytes: 512 * 1024
    )

    func resolve(_ request: HandoffRequest) async throws -> PublicPin {
        guard [HandoffRequest.pinnedTestSkillID, HandoffRequest.testSkillID].contains(request.skillID) else {
            throw PreviewFailure.invalidMetadata
        }
        var query = URLRequest(url: URL(string: "https://omgskills.com/mcp")!)
        query.httpMethod = "POST"
        query.setValue("application/json", forHTTPHeaderField: "Content-Type")
        query.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        query.httpBody = try JSONSerialization.data(withJSONObject: [
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": ["name": "get_skill", "arguments": ["id": request.skillID]]
        ])
        let data = try await http.data(for: query, limit: 64 * 1024)
        let response = try JSONDecoder().decode(CatalogResponse.self, from: data)
        guard response.jsonrpc == "2.0", response.id == 1,
              response.result.isError != true,
              response.result.structuredContent.found,
              let skill = response.result.structuredContent.skill,
              skill.id == request.skillID else { throw PreviewFailure.invalidMetadata }
        guard skill.install_status == "pinned", let pin = skill.pinned_install else {
            throw PreviewFailure.unpinned
        }
        guard skill.github_url == "https://github.com/\(pin.repo)",
              skill.skill_md_path == "\(pin.path)/SKILL.md",
              skill.skill_md_sha?.lowercased() == pin.skill_md_sha.lowercased() else {
            throw PreviewFailure.invalidMetadata
        }
        return try PublicPin(id: skill.id, repo: pin.repo, path: pin.path,
                             commit: pin.commit_sha, skillSHA: pin.skill_md_sha, treeSHA: pin.skill_tree_sha)
    }

    func fetch(_ pin: PublicPin) async throws -> SkillPackage {
        // GitHub's authenticated HTTPS commit response binds the catalog commit to its root tree.
        // Each tree and blob below is additionally hashed locally; no response-provided URL is used.
        let commit: GitCommit = try await get(pin, "commits/\(pin.commit)")
        guard commit.sha == pin.commit, PublicPin.isSHA(commit.tree.sha) else {
            throw PreviewFailure.invalidPackage
        }
        var treeSHA = commit.tree.sha
        for component in pin.path.split(separator: "/").map(String.init) {
            let tree = try await tree(pin, sha: treeSHA, recursive: false)
            guard try tree.computedSHA() == treeSHA,
                  let child = tree.tree.first(where: { $0.path == component }),
                  child.type == "tree", child.mode == "040000" else {
                throw PreviewFailure.invalidPackage
            }
            treeSHA = child.sha
        }
        if let catalogTree = pin.treeSHA, catalogTree != treeSHA { throw PreviewFailure.invalidPackage }
        let selected = try await tree(pin, sha: treeSHA, recursive: true)
        let files = selected.tree.filter { $0.type != "tree" }
        guard !files.isEmpty, files.count <= Self.limits.maximumFileCount else { throw PreviewFailure.tooLarge }
        var total = 0
        for item in selected.tree {
            guard PublicPin.safePackagePath(item.path), PublicPin.isSHA(item.sha) else {
                throw PreviewFailure.invalidPackage
            }
            if item.type == "tree" {
                guard item.mode == "040000" else { throw PreviewFailure.invalidPackage }
                continue
            }
            guard item.type == "blob", ["100644", "100755"].contains(item.mode),
                  let size = item.size, size >= 0 else { throw PreviewFailure.invalidPackage }
            guard size <= Self.limits.maximumFileBytes else { throw PreviewFailure.tooLarge }
            if item.path == "SKILL.md", size > Self.limits.maximumSkillMdBytes { throw PreviewFailure.tooLarge }
            total += size
            guard total <= Self.limits.maximumTotalBytes else { throw PreviewFailure.tooLarge }
        }

        var entries: [SkillPackageEntry] = []
        for item in files {
            try Task.checkCancellation()
            let blob: GitBlob = try await get(pin, "blobs/\(item.sha)")
            guard blob.sha == item.sha, blob.encoding == "base64", blob.size == item.size,
                  let data = Data(base64Encoded: blob.content.filter { !$0.isNewline }),
                  data.count == blob.size,
                  SkillIdentityResolver.gitBlobSHA(for: data) == item.sha else {
                throw PreviewFailure.invalidPackage
            }
            entries.append(SkillPackageEntry(path: item.path, mode: item.mode, data: data, blobSha: item.sha))
        }
        let coordinates = SkillPackageCoordinates(commitSha: pin.commit, treeSha: treeSHA, skillMdSha: pin.skillSHA)
        let package = SkillPackage(coordinates: coordinates, entries: entries)
        _ = try SkillPackageValidator.validate(package, expected: coordinates, limits: Self.limits)
        try Task.checkCancellation()
        return package
    }

    private func tree(_ pin: PublicPin, sha: String, recursive: Bool) async throws -> GitTree {
        guard PublicPin.isSHA(sha) else { throw PreviewFailure.invalidPackage }
        let result: GitTree = try await get(pin, "trees/\(sha)" + (recursive ? "?recursive=1" : ""))
        guard result.sha == sha, !result.truncated, result.tree.count <= 2048 else {
            throw PreviewFailure.invalidPackage
        }
        return result
    }

    private func get<T: Decodable>(_ pin: PublicPin, _ endpoint: String) async throws -> T {
        try Task.checkCancellation()
        let url = URL(string: "https://api.github.com/repos/\(pin.repo)/git/\(endpoint)")!
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("OMGSkills-H1-Preview", forHTTPHeaderField: "User-Agent")
        return try JSONDecoder().decode(T.self, from: await http.data(for: request, limit: 2 * 1024 * 1024))
    }
}

private struct CatalogResponse: Decodable {
    let jsonrpc: String
    let id: Int
    let result: Result
    struct Result: Decodable {
        let isError: Bool?
        let structuredContent: Content
    }
    struct Content: Decodable {
        let found: Bool
        let skill: Skill?
    }
    struct Skill: Decodable {
        let id: String
        let github_url: String?
        let skill_md_path: String?
        let skill_md_sha: String?
        let install_status: String
        let pinned_install: Pin?
    }
    struct Pin: Decodable {
        let repo: String
        let path: String
        let commit_sha: String
        let skill_md_sha: String
        let skill_tree_sha: String?
    }
}

private struct GitCommit: Decodable {
    let sha: String
    let tree: Reference
    struct Reference: Decodable { let sha: String }
}

private struct GitBlob: Decodable {
    let sha: String
    let size: Int
    let encoding: String
    let content: String
}

private struct GitTree: Decodable {
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
        var data = Data()
        let sorted = tree.sorted {
            Array(($0.path + ($0.type == "tree" ? "/" : "")).utf8)
                .lexicographicallyPrecedes(Array(($1.path + ($1.type == "tree" ? "/" : "")).utf8))
        }
        for item in sorted {
            guard PublicPin.safePackagePath(item.path), !item.path.contains("/"),
                  seen.insert(Data(item.path.utf8)).inserted,
                  PublicPin.isSHA(item.sha),
                  (item.type == "tree" && item.mode == "040000")
                    || (item.type == "blob" && ["100644", "100755", "120000"].contains(item.mode))
                    || (item.type == "commit" && item.mode == "160000") else {
                throw PreviewFailure.invalidPackage
            }
            data.append(Data("\(item.mode == "040000" ? "40000" : item.mode) \(item.path)\0".utf8))
            let sha = Array(item.sha.utf8)
            for index in stride(from: 0, to: sha.count, by: 2) {
                guard let byte = UInt8(String(decoding: sha[index...index + 1], as: UTF8.self), radix: 16) else {
                    throw PreviewFailure.invalidPackage
                }
                data.append(byte)
            }
        }
        return GitObjectHash.sha(type: "tree", data: data)
    }
}
