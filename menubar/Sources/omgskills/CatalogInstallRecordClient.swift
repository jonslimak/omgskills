import Foundation

struct CatalogInstallRecord: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let description: String
    let authorHandle: String
    let githubURL: String
    let installCommand: String
    let repositorySlug: String?
    let skillMDPath: String?
    let commitSHA: String?
    let treeSHA: String?
    let skillMDSHA: String?
    let targetName: String?

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case authorHandle = "author_handle", githubURL = "github_url", installCommand = "install_cmd"
        case repositorySlug = "repo_slug", skillMDPath = "skill_md_path", commitSHA = "repo_commit_sha"
        case treeSHA = "skill_tree_sha", skillMDSHA = "skill_md_sha", targetName = "install_target_name"
    }

    var skill: Skill {
        Skill(id: id, name: name, description: description, githubUrl: githubURL,
              installCmd: installCommand, authorHandle: authorHandle, tags: [], readmeSnippet: nil,
              stars: 0, lastUpdated: "", firstSeen: "", skillMdSha: skillMDSHA,
              repoSlug: repositorySlug, skillMdPath: skillMDPath, repoCommitSha: commitSHA,
              skillTreeSha: treeSHA, installTargetName: targetName, installs: nil,
              trendingRank: nil, trendingSource: nil, origin: nil, isSymlink: nil, isLocalOnly: nil)
    }

    func hasSameInstallation(as other: Self) -> Bool {
        id == other.id && githubURL == other.githubURL && installCommand == other.installCommand
            && repositorySlug == other.repositorySlug && skillMDPath == other.skillMDPath
            && commitSHA == other.commitSHA && treeSHA == other.treeSHA
            && skillMDSHA == other.skillMDSHA && targetName == other.targetName
    }
}

struct CatalogInstallRecordClient: Sendable {
    enum ClientError: Error, Equatable { case invalidOrigin, invalidID, unavailable, invalidResponse, responseTooLarge }
    private let origin: URL
    private let session: URLSession
    static let maximumResponseBytes = 256 * 1024

    init(session: URLSession = .shared) {
        origin = URL(string: "https://omgskills.com")!
        self.session = session
    }

    #if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
    init(catalogCandidate: CatalogCandidateRuntime.Configuration, session: URLSession = .shared) {
        origin = CatalogCandidateRuntime.origin
        self.session = session
    }
    #endif

    #if DEBUG
    init(localOrigin: URL, session: URLSession = .shared) throws {
        guard let components = URLComponents(url: localOrigin, resolvingAgainstBaseURL: false),
              components.scheme == "http", ["127.0.0.1", "localhost"].contains(components.host),
              components.port != nil, components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              ["", "/"].contains(components.path)
        else { throw ClientError.invalidOrigin }
        origin = localOrigin
        self.session = session
    }
    #endif

    func fetch(id: String) async throws -> CatalogInstallRecord? {
        try Task.checkCancellation()
        guard CatalogInstallRequest.validID(id) else { throw ClientError.invalidID }
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        components.path = "/api/catalog/install-record"
        components.queryItems = [URLQueryItem(name: "id", value: id)]
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpShouldHandleCookies = false
        let (bytes, response) = try await session.bytes(for: request, delegate: CatalogRecordRedirectPolicy())
        defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url?.host == origin.host, http.url?.scheme == origin.scheme, http.url?.port == origin.port
        else { throw ClientError.unavailable }
        if response.expectedContentLength > Self.maximumResponseBytes { throw ClientError.responseTooLarge }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < Self.maximumResponseBytes else { throw ClientError.responseTooLarge }
            data.append(byte)
        }
        struct Envelope: Decodable { let version: Int; let found: Bool; let skill: CatalogInstallRecord? }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data), envelope.version == 1,
              envelope.found == (envelope.skill != nil), envelope.skill == nil || envelope.skill?.id == id
        else { throw ClientError.invalidResponse }
        return envelope.skill
    }
}

private final class CatalogRecordRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
