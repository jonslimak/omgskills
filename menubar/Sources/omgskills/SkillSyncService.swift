import Foundation

struct SkillSyncPayload: Codable, Equatable, Sendable {
    let token: String
    let skills: [SkillSyncPayloadSkill]
}

struct SkillSyncPayloadSkill: Codable, Equatable, Sendable {
    let stableKey: String
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

enum SkillSyncService {
    static let defaultEndpoint = URL(string: "https://app.omgskills.com/api/portal/sync-upload")!
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

    static func payload(token: String, scanResult: InstalledSkillsScanner.ScanResult) -> SkillSyncPayload {
        SkillSyncPayload(
            token: token.trimmingCharacters(in: .whitespacesAndNewlines),
            skills: scanResult.installations.map(payloadSkill)
        )
    }

    static func payloadSkill(_ skill: Skill) -> SkillSyncPayloadSkill {
        let githubUrl = skill.githubUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let source = skill.origin ?? "Unknown"
        let stableKey = githubUrl.isEmpty
            ? "\(source):\(skill.installCmd)"
            : "\(githubUrl)#\(skill.name)"

        return SkillSyncPayloadSkill(
            stableKey: stableKey,
            skillMdSha: skill.skillMdSha,
            identityStatus: syncIdentityStatus(for: skill),
            name: skill.name,
            description: skill.description,
            catalogSkillId: skill.catalogSkillId,
            githubUrl: githubUrl.isEmpty ? nil : githubUrl,
            isLocalOnly: skill.isLocalOnly == true,
            source: source
        )
    }

    static func upload(
        token: String,
        endpoint: URL = configuredEndpoint(),
        session: URLSession = .shared
    ) async throws -> SkillSyncResult {
        let payload = payload(token: token, scanResult: InstalledSkillsScanner.scanWithSummary())
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(SkillSyncResult.self, from: data)
    }

    private static func syncIdentityStatus(for skill: Skill) -> String {
        switch skill.identityStatus {
        case .resolved:
            return "resolved"
        case .ambiguous:
            return "ambiguous"
        case .localOnly:
            return "localOnly"
        case nil:
            return skill.isLocalOnly == true ? "localOnly" : "ambiguous"
        }
    }
}
