import Foundation

struct CloudSaveFinding: Codable, Equatable, Sendable {
    let rule: String
    let kind: String
    let line: Int
}

struct CloudSaveState: Decodable, Equatable, Sendable {
    struct Settings: Decodable, Equatable, Sendable {
        let enabled: Bool
        let excludedSkillKeys: [String]
    }
    struct Usage: Decodable, Equatable, Sendable {
        let bytes: Int
        let limitBytes: Int
    }
    struct Version: Decodable, Equatable, Sendable {
        let id: String
        let treeSha: String
        let deviceId: String?
        let savedAt: String
        let labels: [String]?
    }
    struct SavedSkill: Decodable, Equatable, Sendable {
        let key: String
        /// Its SKILL.md name as cloud save compares it; nil when saved before names were kept.
        var name: String? = nil
        let currentVersion: Version
        let deletedLocallyAt: String?
        /// Sets this saved skill is shared in.
        var setCount: Int? = nil
    }
    struct Review: Decodable, Equatable, Sendable {
        struct File: Decodable, Equatable, Sendable {
            let path: String
            let findings: [CloudSaveFinding]
        }
        let key: String
        /// The Mac whose copy is waiting.
        let deviceId: String?
        let files: [File]
        let confirmed: Bool
    }

    let settings: Settings
    let usage: Usage
    let skills: [SavedSkill]
    let needsReview: [Review]

    private enum CodingKeys: String, CodingKey { case settings, usage, skills, needsReview }

    init(settings: Settings, usage: Usage, skills: [SavedSkill], needsReview: [Review]) {
        self.settings = settings
        self.usage = usage
        self.skills = skills
        self.needsReview = needsReview
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        settings = try container.decode(Settings.self, forKey: .settings)
        usage = try container.decode(Usage.self, forKey: .usage)
        skills = try container.decode([SavedSkill].self, forKey: .skills)
        // Servers before the safety scan have no review list.
        needsReview = try container.decodeIfPresent([Review].self, forKey: .needsReview) ?? []
    }
}

enum CloudSaveAPIError: Error, Equatable, Sendable {
    case reconnectRequired
    case permissionRequired
    case unavailable
    case disabled
    case excluded
    /// A different skill is saved under this key.
    case nameTaken
    case needsReview([CloudSaveFinding])
    case tooLarge
    case storageFull
    case rateLimited
    case rejected(String)
    case invalidResponse
}

enum CloudSaveVersionResult: Equatable, Sendable {
    case saved(created: Bool)
    case missingFiles([String])
}

protocol CloudSaveServing: Sendable {
    func state(credential: StoredDeviceCredential) async throws -> CloudSaveState
    func setEnabled(_ enabled: Bool, credential: StoredDeviceCredential) async throws
    /// Leaves more skills out of cloud save, keeping the rest of the list.
    func setExcluded(_ keys: [String], credential: StoredDeviceCredential) async throws
    func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws
    /// Uploads several files, returning what was found in any that were held back for review.
    func uploadFiles(_ entries: [SkillPackageEntry], credential: StoredDeviceCredential) async throws -> [CloudSaveFinding]
    func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult
    func markDeletedLocally(key: String, deleted: Bool, credential: StoredDeviceCredential) async throws
    func withdrawReview(key: String, credential: StoredDeviceCredential) async throws
    /// Tells the web why each skill wasn't saved, replacing this Mac's last report.
    func reportSkipped(_ skipped: [String: CloudSaveSkipReason], credential: StoredDeviceCredential) async throws
    /// Library skills added to My skills (by catalog ID), installed anywhere or not.
    func mySkillAdditions(credential: StoredDeviceCredential) async throws -> [String]
}

/// The server has no batch upload; files go one at a time.
struct CloudSaveBatchUnsupported: Error {}

extension CloudSaveServing {
    func setExcluded(_ keys: [String], credential: StoredDeviceCredential) async throws {}

    func reportSkipped(_ skipped: [String: CloudSaveSkipReason], credential: StoredDeviceCredential) async throws {}

    func mySkillAdditions(credential: StoredDeviceCredential) async throws -> [String] { [] }

    func uploadFiles(_ entries: [SkillPackageEntry], credential: StoredDeviceCredential) async throws -> [CloudSaveFinding] {
        throw CloudSaveBatchUnsupported()
    }
}

struct CloudSavedVersion: Decodable, Equatable, Sendable {
    let id: String
    let sourceId: String
    let commitSha: String
    let treeSha: String
    let skillMdSha: String
    let savedAt: String

    var release: GroupManifestRelease {
        GroupManifestRelease(id: id, commitSha: commitSha, treeSha: treeSha, skillMdSha: skillMdSha)
    }
}

struct CloudSaveAPI: CloudSaveServing {
    /// Raw bytes per batch: base64 adds a third, and the server takes at most 4 MB of files per request.
    static let batchBytes = 3 * 1024 * 1024
    /// Keeps each request well inside the server's time limit.
    static let batchFiles = 50

    private let origin: URL
    private let session: any DeviceHTTPSession

    init(origin: URL, session: any DeviceHTTPSession = URLSession.shared) {
        self.origin = origin
        self.session = session
    }

    func state(credential: StoredDeviceCredential) async throws -> CloudSaveState {
        let data = try await send("GET", path: [], credential: credential)
        do { return try JSONDecoder().decode(CloudSaveState.self, from: data) }
        catch { throw CloudSaveAPIError.invalidResponse }
    }

    func setEnabled(_ enabled: Bool, credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        _ = try await send("PUT", path: ["settings"], json: ["enabled": enabled], credential: credential)
    }

    func setExcluded(_ keys: [String], credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        _ = try await send("PUT", path: ["settings"], json: ["addExcludedSkillKeys": keys], credential: credential)
    }

    func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        var headers = ["Content-Type": "application/octet-stream"]
        if confirmSecrets { headers["X-Cloud-Save-Confirm"] = "secrets-reviewed" }
        _ = try await send("PUT", path: ["blobs", entry.blobSha], body: entry.data, headers: headers, credential: credential)
    }

    /// Sends a skill's files in as few requests as fit; a file too big for a batch goes on its own.
    /// Throws CloudSaveBatchUnsupported, before sending anything else, if the server has no batch upload.
    func uploadFiles(_ entries: [SkillPackageEntry], credential: StoredDeviceCredential) async throws -> [CloudSaveFinding] {
        try requireUploadScope(credential)
        var held: [CloudSaveFinding] = []
        var batches: [[SkillPackageEntry]] = []
        var single: [SkillPackageEntry] = []
        var bytes = 0
        for entry in entries {
            if entry.data.count > Self.batchBytes { single.append(entry); continue }
            if batches.isEmpty || bytes + entry.data.count > Self.batchBytes || batches[batches.count - 1].count >= Self.batchFiles {
                batches.append([])
                bytes = 0
            }
            batches[batches.count - 1].append(entry)
            bytes += entry.data.count
        }
        for batch in batches {
            try Task.checkCancellation()
            let files = batch.map { ["blobSha": $0.blobSha, "data": $0.data.base64EncodedString()] }
            let data: Data
            do { data = try await send("POST", path: ["blobs"], json: ["files": files], credential: credential) }
            catch is RouteMissing { throw CloudSaveBatchUnsupported() }
            // Without the route, some servers answer with the web page instead.
            guard let decoded = try? JSONDecoder().decode(BatchBody.self, from: data) else {
                if batch == batches.first { throw CloudSaveBatchUnsupported() }
                throw CloudSaveAPIError.invalidResponse
            }
            held += decoded.files.flatMap { $0.findings ?? [] }
        }
        for entry in single {
            try Task.checkCancellation()
            do { try await uploadFile(entry, confirmSecrets: false, credential: credential) }
            catch CloudSaveAPIError.needsReview(let findings) { held += findings }
        }
        return held
    }

    func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult {
        try requireUploadScope(credential)
        let files: [[String: Any]] = folder.entries.map {
            ["path": $0.path, "mode": $0.mode, "blobSha": $0.blobSha, "byteSize": $0.data.count]
        }
        do {
            let data = try await send("POST", path: ["skills", folder.key, "versions"],
                json: ["files": files, "treeSha": folder.treeSha].merging(folder.name.map { ["skillName": $0] } ?? [:]) { a, _ in a },
                credential: credential)
            let created = (try? JSONDecoder().decode(SavedBody.self, from: data))?.created ?? false
            return .saved(created: created)
        } catch let missing as MissingFiles {
            return .missingFiles(missing.hashes)
        }
    }

    /// A saved skill's versions, newest first, with what this Mac needs to download and check one.
    func versions(key: String, credential: StoredDeviceCredential) async throws -> [CloudSavedVersion] {
        let data = try await send("GET", path: ["skills", key, "versions"], credential: credential)
        struct Body: Decodable { let versions: [CloudSavedVersion] }
        do { return try JSONDecoder().decode(Body.self, from: data).versions }
        catch { throw CloudSaveAPIError.invalidResponse }
    }

    func markDeletedLocally(key: String, deleted: Bool, credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        _ = try await send("PUT", path: ["skills", key, "deleted-locally"], json: ["deleted": deleted], credential: credential)
    }

    func withdrawReview(key: String, credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        _ = try await send("DELETE", path: ["skills", key, "review"], credential: credential)
    }

    func reportSkipped(_ skipped: [String: CloudSaveSkipReason], credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        _ = try await send("PUT", path: ["skipped"], json: ["skipped": skipped.mapValues(\.rawValue)], credential: credential)
    }

    /// Delete everywhere: the saved copy and every version go, and the skill is left out of sync from then on.
    func deleteSkill(key: String, credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        _ = try await send("DELETE", path: ["skills", key], credential: credential)
    }

    func mySkillAdditions(credential: StoredDeviceCredential) async throws -> [String] {
        let data = try await send("GET", path: [], base: "my-skills", credential: credential)
        struct Body: Decodable { struct Row: Decodable { let catalogSkillId: String }; let skills: [Row] }
        do { return try JSONDecoder().decode(Body.self, from: data).skills.map(\.catalogSkillId) }
        catch { throw CloudSaveAPIError.invalidResponse }
    }

    /// Takes a library skill out of My skills.
    func removeMySkill(catalogID: String, credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        _ = try await send("DELETE", path: [], query: [URLQueryItem(name: "catalogSkillId", value: catalogID)],
                           base: "my-skills", credential: credential)
    }

    private struct SavedBody: Decodable { let created: Bool }
    private struct BatchResult: Decodable { let findings: [CloudSaveFinding]? }
    private struct BatchBody: Decodable { let files: [BatchResult] }
    private struct ErrorBody: Decodable {
        let error: String?
        let code: String?
        let missing: [String]?
        let findings: [CloudSaveFinding]?
    }
    private struct MissingFiles: Error { let hashes: [String] }
    private struct RouteMissing: Error {}

    private func requireUploadScope(_ credential: StoredDeviceCredential) throws {
        guard credential.connection.grantedScopes.contains(.contentWrite) else { throw CloudSaveAPIError.permissionRequired }
    }

    private func send(_ method: String, path: [String], query: [URLQueryItem] = [], base: String = "cloud-save",
                      json: [String: Any]? = nil, body: Data? = nil,
                      headers: [String: String] = [:], credential: StoredDeviceCredential) async throws -> Data {
        var url = origin.appendingPathComponent("api").appendingPathComponent("portal").appendingPathComponent(base)
        for component in path { url.appendPathComponent(component) }
        if !query.isEmpty, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            components.queryItems = query
            if let withQuery = components.url { url = withQuery }
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue("Bearer \(credential.credential)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let json {
            request.httpBody = try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if let body {
            request.httpBody = body
        }
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }

        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch is CancellationError { throw CancellationError() }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch { throw CloudSaveAPIError.unavailable }
        guard let http = response as? HTTPURLResponse else { throw CloudSaveAPIError.invalidResponse }
        if (200..<300).contains(http.statusCode) { return data }

        let error = try? JSONDecoder().decode(ErrorBody.self, from: data)
        switch (http.statusCode, error?.code) {
        case (409, _) where error?.missing != nil: throw MissingFiles(hashes: error?.missing ?? [])
        // A route this server doesn't have; its own "not found" answers carry a code.
        case (404, nil) where path == ["blobs"], (405, nil) where path == ["blobs"]: throw RouteMissing()
        case (401, _): throw CloudSaveAPIError.reconnectRequired
        case (403, "disabled"): throw CloudSaveAPIError.disabled
        case (403, "excluded"): throw CloudSaveAPIError.excluded
        case (409, "name_taken"): throw CloudSaveAPIError.nameTaken
        case (422, "needs_review"): throw CloudSaveAPIError.needsReview(error?.findings ?? [])
        case (413, "quota_exceeded"): throw CloudSaveAPIError.storageFull
        case (413, _): throw CloudSaveAPIError.tooLarge
        case (429, _): throw CloudSaveAPIError.rateLimited
        // A 500 is one request's problem (say, a skill the server can't store); it is reported per skill.
        case (503, _), (502, _), (504, _): throw CloudSaveAPIError.unavailable
        default: throw CloudSaveAPIError.rejected(error?.error ?? "Cloud save request failed (\(http.statusCode))")
        }
    }
}
