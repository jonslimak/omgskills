import Foundation

struct SkillSyncPayload: Codable, Equatable, Sendable {
    let token: String
    let skills: [SkillSyncPayloadSkill]
}

struct DeviceSkillSyncPayload: Codable, Equatable, Sendable {
    let skills: [SkillSyncPayloadSkill]
}

struct SkillSyncPayloadSkill: Codable, Equatable, Sendable {
    let stableKey: String
    let installationPath: String
    let skillMdSha: String?
    let identityStatus: String
    let name: String
    let description: String
    let catalogSkillId: String?
    let githubUrl: String?
    let isLocalOnly: Bool
    let source: String
}

struct SkillSyncResult: Decodable, Equatable, Sendable {
    let syncRunId: String
    let syncedSkillCount: Int
}

enum SkillSyncError: LocalizedError, Equatable {
    case invalidOrExpiredToken
    case server(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .invalidOrExpiredToken:
            return "This token is invalid or expired. Generate a fresh token and try again."
        case .server:
            return "The web portal could not complete the sync. Try again shortly."
        }
    }
}

enum SkillSyncService {
    static let defaultEndpoint = URL(string: "https://omgskills.com/api/portal/sync-upload")!
    static let endpointInfoKey = "OMGSkillsSyncEndpoint"

    static func configuredEndpoint(bundle: Bundle = .main) -> URL {
        guard
            let value = bundle.object(forInfoDictionaryKey: endpointInfoKey) as? String,
            let endpoint = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
            endpoint.scheme == "https",
            endpoint.host != nil
        else {
            return defaultEndpoint
        }

        return endpoint
    }

    static func payload(token: String, installations: [Skill]) -> SkillSyncPayload {
        SkillSyncPayload(
            token: token.trimmingCharacters(in: .whitespacesAndNewlines),
            skills: payloadSkills(installations)
        )
    }

    static func payloadSkills(_ installations: [Skill]) -> [SkillSyncPayloadSkill] {
        installations.map(payloadSkill)
    }

    static func payloadSkill(_ skill: Skill) -> SkillSyncPayloadSkill {
        let githubUrl = skill.githubUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let source = skill.origin ?? "Unknown"
        let installationPath = URL(fileURLWithPath: skill.installCmd).lastPathComponent
        let stableKey = "location:v1:\(source.lowercased()):\(installationPath)"
        let identityStatus = syncIdentityStatus(for: skill)

        return SkillSyncPayloadSkill(
            stableKey: stableKey,
            installationPath: installationPath,
            skillMdSha: skill.skillMdSha,
            identityStatus: identityStatus,
            name: skill.name,
            description: skill.description,
            catalogSkillId: identityStatus == "resolved" ? skill.catalogSkillId : nil,
            githubUrl: githubUrl.isEmpty ? nil : githubUrl,
            isLocalOnly: identityStatus == "localOnly",
            source: source
        )
    }

    static func upload(
        token: String,
        installations: [Skill],
        endpoint: URL = configuredEndpoint(),
        session: URLSession = .shared
    ) async throws -> SkillSyncResult {
        let payload = payload(token: token, installations: installations)
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        try validateStatusCode(httpResponse.statusCode)
        return try JSONDecoder().decode(SkillSyncResult.self, from: data)
    }

    static func validateStatusCode(_ statusCode: Int) throws {
        guard !(200..<300).contains(statusCode) else { return }
        if statusCode == 401 {
            throw SkillSyncError.invalidOrExpiredToken
        }
        throw SkillSyncError.server(statusCode: statusCode)
    }

    private static func syncIdentityStatus(for skill: Skill) -> String {
        switch skill.identityStatus {
        case .resolved:
            return skill.catalogSkillId == nil ? "ambiguous" : "resolved"
        case .ambiguous:
            return "ambiguous"
        case .localOnly:
            return "localOnly"
        case nil:
            if skill.catalogSkillId != nil {
                return "resolved"
            }
            return skill.isLocalOnly == true ? "localOnly" : "ambiguous"
        }
    }
}
