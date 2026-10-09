import Foundation

struct PublicSkillInstallRequest: Equatable, Sendable {
    enum RequestError: Error { case invalidRequest }

    let catalogID: String
    let repositorySlug: String
    let skillMDPath: String
    let packageRoot: String
    let targetName: String
    let commitSha: String?

    var sourceID: String { "github:\(repositorySlug):\(packageRoot)" }
    var githubURL: String { "https://github.com/\(repositorySlug)" }

    init(catalogID: String, repositorySlug: String, skillMDPath: String, commitSha: String? = nil) throws {
        let parts = skillMDPath.split(separator: "/", omittingEmptySubsequences: false)
        guard !catalogID.isEmpty, catalogID.utf8.count <= 500,
              !catalogID.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              let repository = GitHubRepositorySlug.normalized(repositorySlug),
              skillMDPath.utf8.count <= 1024, parts.last == "SKILL.md",
              !skillMDPath.contains("\\"),
              !skillMDPath.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && $0.lowercased() != ".git" }),
              commitSha.map(Self.isCommitSHA) ?? true else {
            throw RequestError.invalidRequest
        }
        let target = parts.count > 1 ? String(parts[parts.count - 2]) : String(repository.split(separator: "/")[1])
        guard target.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", options: .regularExpression) != nil else {
            throw RequestError.invalidRequest
        }
        self.catalogID = catalogID
        self.repositorySlug = repository.lowercased()
        self.skillMDPath = skillMDPath
        self.packageRoot = parts.count == 1 ? "." : parts.dropLast().joined(separator: "/")
        self.targetName = target
        self.commitSha = commitSha?.lowercased()
    }

    init(url: String) throws {
        guard url.utf8.count <= 4096,
              !url.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              url.range(of: "%(?![0-9A-Fa-f]{2})", options: .regularExpression) == nil,
              let components = URLComponents(string: url),
              components.scheme == "omgskills-f1", components.host == "review",
              components.user == nil, components.password == nil, components.port == nil,
              components.path.isEmpty, components.fragment == nil,
              let items = components.queryItems,
              items.count == 5 || items.count == 6 else {
            throw RequestError.invalidRequest
        }
        let allowed = Set(["v", "id", "repo", "path", "agent", "commit"])
        var fields: [String: String] = [:]
        for item in items {
            guard allowed.contains(item.name), fields[item.name] == nil, let value = item.value else {
                throw RequestError.invalidRequest
            }
            fields[item.name] = value
        }
        guard fields["v"] == "1", fields["agent"] == "codex",
              let id = fields["id"], let repo = fields["repo"], let path = fields["path"] else {
            throw RequestError.invalidRequest
        }
        try self.init(catalogID: id, repositorySlug: repo, skillMDPath: path, commitSha: fields["commit"])
    }

    private static func isCommitSHA(_ value: String) -> Bool {
        value.utf8.count == 40 && value.utf8.allSatisfy {
            (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0)
        }
    }
}
