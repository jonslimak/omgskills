import Foundation

struct SkillSyncPayload: Codable, Equatable, Sendable {
    let token: String
    let skills: [SkillSyncPayloadSkill]
}

struct DeviceSkillSyncPayload: Codable, Equatable, Sendable {
    let skills: [SkillSyncPayloadSkill]
}

enum DeviceReportMode: Sendable {
    case legacy
    case presence
    case reconciliation
}

struct PresenceSyncPayload: Encodable, Equatable, Sendable {
    let reportVersion = 2
    let skills: [PresenceSyncSkill]
}

struct InventoryRootCoverage: Codable, Equatable, Sendable {
    enum State: String, Codable, Sendable { case complete, incomplete, unavailable }
    enum Reason: String, Codable, Sendable {
        case missing, unreadable, redirected, changed
        case invalidEntry = "invalid-entry"
        case invalidMetadata = "invalid-metadata"
    }
    let source: String
    var state: State
    var reason: Reason?

    var isValid: Bool {
        guard ["claude", "codex", "agents"].contains(source) else { return false }
        switch state {
        case .complete: return reason == nil
        case .incomplete: return [.changed, .invalidEntry, .invalidMetadata].contains(reason)
        case .unavailable: return [.missing, .unreadable, .redirected].contains(reason)
        }
    }
}

struct ReconciliationSyncPayload: Encodable, Equatable, Sendable {
    let reportVersion = 3
    let baseRevision: String?
    let roots: [InventoryRootCoverage]
    let skills: [PresenceSyncSkill]

    private enum CodingKeys: String, CodingKey { case reportVersion, baseRevision, roots, skills }

    func hasSameInventory(as other: Self) -> Bool {
        roots.sorted { $0.source < $1.source } == other.roots.sorted { $0.source < $1.source }
            && skills.sorted(by: Self.locationOrder) == other.skills.sorted(by: Self.locationOrder)
    }

    private static func locationOrder(_ lhs: PresenceSyncSkill, _ rhs: PresenceSyncSkill) -> Bool {
        lhs.source == rhs.source ? lhs.installationPath < rhs.installationPath : lhs.source < rhs.source
    }
    func encode(to encoder: any Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(reportVersion, forKey: .reportVersion)
        try values.encode(baseRevision, forKey: .baseRevision)
        try values.encode(roots, forKey: .roots)
        try values.encode(skills, forKey: .skills)
    }
}

struct InventoryCheckPayload: Encodable, Equatable, Sendable {
    let reportVersion = 3
    let mode = "check"
    let baseRevision: String

    init(baseRevision: String) throws {
        guard UUID(uuidString: baseRevision) != nil else { throw PresenceSyncError.invalidRevision }
        self.baseRevision = baseRevision.lowercased()
    }
}

struct InventoryCheckResult: Decodable, Equatable, Sendable {
    let reportVersion: Int
    let mode: String
    let deviceId: String
    let revision: String
    let checkedAt: String

    var checkedDate: Date? { SkillSyncService.serverDate(checkedAt) }

    func validate(_ payload: InventoryCheckPayload, deviceID: String? = nil) throws {
        guard reportVersion == 3, mode == "checked", !deviceId.isEmpty,
              deviceID == nil || deviceId == deviceID,
              revision.lowercased() == payload.baseRevision, checkedDate != nil else {
            throw DeviceSyncAPIError.invalidResponse
        }
    }
}

struct PresenceSyncSkill: Encodable, Equatable, Sendable {
    let source: String
    let installationPath: String
    let name: String
    let description: String
    let skillMdSha: String?
    let githubUrl: String?
    let gitRelativePath: String?
    let catalogSkillIdHint: String?
    var installedFromSet: String? = nil
}

enum PresenceSyncError: LocalizedError, Equatable {
    case tooManyInstallations
    case invalidInstallation
    case duplicateLocation
    case missingScanner
    case invalidCoverage
    case invalidRevision

    var errorDescription: String? {
        switch self {
        case .tooManyInstallations: "Inventory reporting supports at most 1,000 installations. Nothing was uploaded."
        case .invalidInstallation: "An installation has unsupported metadata. Nothing was uploaded."
        case .duplicateLocation: "The scan contains a duplicate installation location. Nothing was uploaded."
        case .missingScanner: "Inventory scanning is not configured."
        case .invalidCoverage: "Inventory scan coverage is invalid. Nothing was uploaded."
        case .invalidRevision: "Inventory revision is invalid. Nothing was uploaded."
        }
    }
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
    var installedFromSet: String? = nil
}

struct SkillSyncResult: Decodable, Equatable, Sendable {
    let syncRunId: String
    let syncedSkillCount: Int
    let reportVersion: Int?
    let mode: String?
    let deviceId: String?
    let completedAt: String?
    let revision: String?
    let missingSkillCount: Int?
    let roots: [InventoryRootCoverage]?
    let complete: Bool?

    init(syncRunId: String, syncedSkillCount: Int, reportVersion: Int? = nil,
         mode: String? = nil, deviceId: String? = nil, completedAt: String? = nil,
         revision: String? = nil, missingSkillCount: Int? = nil,
         roots: [InventoryRootCoverage]? = nil, complete: Bool? = nil) {
        self.syncRunId = syncRunId
        self.syncedSkillCount = syncedSkillCount
        self.reportVersion = reportVersion
        self.mode = mode
        self.deviceId = deviceId
        self.completedAt = completedAt
        self.revision = revision
        self.missingSkillCount = missingSkillCount
        self.roots = roots
        self.complete = complete
    }

    func validateReconciliation(_ payload: ReconciliationSyncPayload, deviceID: String? = nil) throws {
        guard reportVersion == 3, mode == "reconciled",
              let actualDevice = self.deviceId, !actualDevice.isEmpty,
              deviceID == nil || actualDevice == deviceID,
              UUID(uuidString: syncRunId) != nil,
              let revision, revision.lowercased() == syncRunId.lowercased(),
              syncedSkillCount == payload.skills.count,
              let missingSkillCount, missingSkillCount >= 0,
              roots == payload.roots, reportedAt != nil,
              complete == payload.roots.allSatisfy({ $0.state == .complete }) else {
            throw DeviceSyncAPIError.invalidResponse
        }
    }

    var reportedAt: Date? {
        guard let completedAt else { return nil }
        return SkillSyncService.serverDate(completedAt)
    }
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
    static func serverDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    static let defaultEndpoint = URL(string: "https://omgskills.com/api/portal/sync-upload")!
    static let endpointInfoKey = "OMGSkillsSyncEndpoint"

    static func configuredEndpoint(bundle: Bundle = .main) -> URL {
        guard
            let value = bundle.object(forInfoDictionaryKey: endpointInfoKey) as? String,
            let endpoint = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
            isAllowedEndpoint(endpoint, allowLoopbackHTTP: debugAllowsLoopbackHTTP)
        else {
            return defaultEndpoint
        }

        return endpoint
    }

    static func isAllowedEndpoint(_ endpoint: URL, allowLoopbackHTTP: Bool) -> Bool {
        guard let host = endpoint.host?.lowercased() else { return false }
        if endpoint.scheme?.lowercased() == "https" {
            return true
        }
        return allowLoopbackHTTP
            && endpoint.scheme?.lowercased() == "http"
            && ["localhost", "127.0.0.1", "::1"].contains(host)
    }

    private static var debugAllowsLoopbackHTTP: Bool {
        #if OMGSKILLS_DEBUG_GROUP_INSTALL_ROOT_OVERRIDE
        true
        #else
        false
        #endif
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
            source: source,
            installedFromSet: safeSetName(skill.installedFromSet)
        )
    }

    static func presencePayload(installations: [Skill]) throws -> PresenceSyncPayload {
        guard installations.count <= 1000 else { throw PresenceSyncError.tooManyInstallations }
        var locations = Set<String>()
        let skills = try installations.map { skill in
            let row = try presencePayloadSkill(skill)
            guard locations.insert("\(row.source):\(row.installationPath)").inserted else {
                throw PresenceSyncError.duplicateLocation
            }
            return row
        }
        return PresenceSyncPayload(skills: skills)
    }

    static func reconciliationPayload(
        baseRevision: String?, scan: InstalledSkillsScanner.ScanResult
    ) throws -> ReconciliationSyncPayload {
        try Task.checkCancellation()
        guard baseRevision == nil || (baseRevision?.range(of:
            "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
            options: .regularExpression) != nil) else { throw PresenceSyncError.invalidRevision }
        guard scan.roots.count == 3, Set(scan.roots.map(\.source)) == ["claude", "codex", "agents"],
              scan.roots.allSatisfy(\.isValid) else { throw PresenceSyncError.invalidCoverage }
        let skills = try presencePayload(installations: scan.installations).skills
        // A malformed observation must never disappear under a complete-root claim.
        guard scan.issues.allSatisfy({ issue in
            let source: String
            switch issue {
            case .unreadableRoot(let origin), .skippedSkill(let origin, _): source = origin.lowercased()
            }
            return scan.roots.contains { $0.source == source && $0.state != .complete }
        }) else { throw PresenceSyncError.invalidCoverage }
        try Task.checkCancellation()
        return ReconciliationSyncPayload(baseRevision: baseRevision?.lowercased(), roots: scan.roots, skills: skills)
    }

    static func presencePayloadSkill(_ skill: Skill) throws -> PresenceSyncSkill {
        let source = (skill.origin ?? "").lowercased()
        let folder = URL(fileURLWithPath: skill.installCmd).lastPathComponent
        guard ["claude", "codex", "agents"].contains(source),
              validFolder(folder), !skill.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              skill.name.utf16.count <= 200, skill.description.utf16.count <= 2000 else {
            throw PresenceSyncError.invalidInstallation
        }
        let hash = skill.skillMdSha?.lowercased()
        let hint = skill.catalogSkillId.flatMap { value -> String? in
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return !trimmed.isEmpty && trimmed.utf16.count <= 500 ? trimmed : nil
        }
        return PresenceSyncSkill(source: source, installationPath: folder,
            name: skill.name, description: skill.description,
            skillMdSha: hash?.range(of: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$", options: .regularExpression) != nil ? hash : nil,
            githubUrl: safeRepositoryURL(skill.githubUrl),
            gitRelativePath: safeRelativePath(skill.gitRelativePath), catalogSkillIdHint: hint,
            installedFromSet: safeSetName(skill.installedFromSet))
    }

    private static func safeSetName(_ value: String?) -> String? {
        guard let name = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !name.isEmpty, name.utf16.count <= 200 else { return nil }
        return name
    }

    private static func validFolder(_ value: String) -> Bool {
        !value.isEmpty && value.utf16.count <= 500 && value != "." && value != ".."
            && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
            && value.range(of: "[\\\\/\\x00-\\x1f\\x7f]", options: .regularExpression) == nil
    }

    private static func safeRepositoryURL(_ value: String) -> String? {
        var raw = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("git@github.com:") { raw = "https://github.com/" + raw.dropFirst(15) }
        guard raw.utf16.count <= 500, let url = URLComponents(string: raw),
              url.scheme?.lowercased() == "https", url.host?.lowercased() == "github.com",
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.port == nil || url.port == 443 else { return nil }
        var parts = url.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false)
        if parts.last == "" { parts.removeLast() }
        guard parts.count == 3, parts[0].isEmpty else { return nil }
        let owner = String(parts[1]), repoWithSuffix = String(parts[2])
        let repo = repoWithSuffix.hasSuffix(".git") ? String(repoWithSuffix.dropLast(4)) : repoWithSuffix
        guard owner.range(of: "^[A-Za-z0-9-]+$", options: .regularExpression) != nil,
              repo.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil,
              repo != ".", repo != ".." else { return nil }
        return "https://github.com/\(owner.lowercased())/\(repo.lowercased())"
    }

    private static func safeRelativePath(_ value: String?) -> String? {
        guard let value, value.utf16.count <= 500 else { return nil }
        if value == "." || value.isEmpty { return "" }
        guard value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              value.range(of: "[\\\\\\x00-\\x1f\\x7f]|^[A-Za-z]:", options: .regularExpression) == nil,
              value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
        return value
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
