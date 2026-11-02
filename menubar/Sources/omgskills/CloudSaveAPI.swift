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
        let currentVersion: Version
        let deletedLocallyAt: String?
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
    func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws
    func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult
    func markDeletedLocally(key: String, deleted: Bool, credential: StoredDeviceCredential) async throws
}

struct CloudSaveAPI: CloudSaveServing {
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

    func uploadFile(_ entry: SkillPackageEntry, confirmSecrets: Bool, credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        var headers = ["Content-Type": "application/octet-stream"]
        if confirmSecrets { headers["X-Cloud-Save-Confirm"] = "secrets-reviewed" }
        _ = try await send("PUT", path: ["blobs", entry.blobSha], body: entry.data, headers: headers, credential: credential)
    }

    func saveVersion(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> CloudSaveVersionResult {
        try requireUploadScope(credential)
        let files: [[String: Any]] = folder.entries.map {
            ["path": $0.path, "mode": $0.mode, "blobSha": $0.blobSha, "byteSize": $0.data.count]
        }
        do {
            let data = try await send("POST", path: ["skills", folder.key, "versions"],
                json: ["files": files, "treeSha": folder.treeSha], credential: credential)
            let created = (try? JSONDecoder().decode(SavedBody.self, from: data))?.created ?? false
            return .saved(created: created)
        } catch let missing as MissingFiles {
            return .missingFiles(missing.hashes)
        }
    }

    func markDeletedLocally(key: String, deleted: Bool, credential: StoredDeviceCredential) async throws {
        try requireUploadScope(credential)
        _ = try await send("PUT", path: ["skills", key, "deleted-locally"], json: ["deleted": deleted], credential: credential)
    }

    private struct SavedBody: Decodable { let created: Bool }
    private struct ErrorBody: Decodable {
        let error: String?
        let code: String?
        let missing: [String]?
        let findings: [CloudSaveFinding]?
    }
    private struct MissingFiles: Error { let hashes: [String] }

    private func requireUploadScope(_ credential: StoredDeviceCredential) throws {
        guard credential.connection.grantedScopes.contains(.contentWrite) else { throw CloudSaveAPIError.permissionRequired }
    }

    private func send(_ method: String, path: [String], json: [String: Any]? = nil, body: Data? = nil,
                      headers: [String: String] = [:], credential: StoredDeviceCredential) async throws -> Data {
        var url = origin.appendingPathComponent("api").appendingPathComponent("portal").appendingPathComponent("cloud-save")
        for component in path { url.appendPathComponent(component) }
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
        case (401, _): throw CloudSaveAPIError.reconnectRequired
        case (403, "disabled"): throw CloudSaveAPIError.disabled
        case (403, "excluded"): throw CloudSaveAPIError.excluded
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
