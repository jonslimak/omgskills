import Foundation

enum DeviceSyncAPIError: LocalizedError, Equatable, Sendable {
    case invalidPairingCode
    case reconnectRequired
    case deviceLimitReached
    case rateLimited
    case server(statusCode: Int)
    case retryableServer(statusCode: Int, retryAfter: TimeInterval?)
    case invalidResponse
    case inventoryChanged
    case unsupportedReportMode
    case unsupportedReconnect
    case invalidReconnectKey
    case reconnectBindingConflict

    var errorDescription: String? {
        switch self {
        case .invalidPairingCode:
            return "This pairing code is invalid or expired. Generate a fresh code and try again."
        case .reconnectRequired:
            return "This Mac is no longer connected. Connect it again to sync."
        case .deviceLimitReached:
            return "Your account has reached its connected-device limit. Revoke a device and try again."
        case .rateLimited:
            return "Too many attempts. Wait briefly and try again."
        case .server, .retryableServer:
            return "The web portal could not complete the request. Try again shortly."
        case .invalidResponse:
            return "The web portal returned an invalid response."
        case .inventoryChanged:
            return "Inventory changed. Resync to scan again."
        case .unsupportedReportMode:
            return "This inventory reporting mode is not configured."
        case .unsupportedReconnect:
            return "This connection does not support reconnect continuity."
        case .invalidReconnectKey:
            return "The reconnect key is invalid."
        case .reconnectBindingConflict:
            return "This reconnect key conflicts with an existing connection."
        }
    }
}

enum DeviceReconnectSupport: Equatable, Sendable {
    case supported
    case unsupported
    case invalid
}

struct DeviceReconnectExchange: Equatable, Sendable {
    let record: StoredDeviceCredential
    let support: DeviceReconnectSupport
}

protocol DeviceSyncServing: Sendable {
    var reportMode: DeviceReportMode { get }
    func exchange(
        pairingCode: String,
        deviceName: String,
        codeVerifier: String?
    ) async throws -> StoredDeviceCredential
    func exchangeForReconnect(pairingCode: String, deviceName: String, codeVerifier: String?,
                              reconnectKey: String) async throws -> DeviceReconnectExchange
    func bindReconnectKey(credential: String, reconnectKey: String, expectedDeviceID: String) async throws
    func upload(credential: String, installations: [Skill]) async throws -> SkillSyncResult
    func inventoryRevision(credential: String) async throws -> String?
    func reconcile(credential: String, payload: ReconciliationSyncPayload) async throws -> SkillSyncResult
    func checkInventory(credential: String, payload: InventoryCheckPayload) async throws -> InventoryCheckResult
    func revoke(credential: String) async throws
}

extension DeviceSyncServing {
    var reportMode: DeviceReportMode { .legacy }
    func exchangeForReconnect(pairingCode: String, deviceName: String, codeVerifier: String?,
                              reconnectKey: String) async throws -> DeviceReconnectExchange {
        throw DeviceSyncAPIError.unsupportedReconnect
    }
    func bindReconnectKey(credential: String, reconnectKey: String, expectedDeviceID: String) async throws {
        throw DeviceSyncAPIError.unsupportedReconnect
    }
    func inventoryRevision(credential: String) async throws -> String? { throw DeviceSyncAPIError.unsupportedReportMode }
    func reconcile(credential: String, payload: ReconciliationSyncPayload) async throws -> SkillSyncResult {
        throw DeviceSyncAPIError.unsupportedReportMode
    }
    func checkInventory(credential: String, payload: InventoryCheckPayload) async throws -> InventoryCheckResult {
        throw DeviceSyncAPIError.unsupportedReportMode
    }
}

protocol DeviceHTTPSession: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: DeviceHTTPSession {}

struct DeviceSyncAPI: DeviceSyncServing, Sendable {
    let reportMode: DeviceReportMode
    struct Endpoints: Equatable, Sendable {
        let exchange: URL
        let upload: URL
        let revoke: URL
        let reconnectKey: URL

        init(upload: URL) {
            let base = upload.deletingLastPathComponent()
            self.exchange = base.appendingPathComponent("sync-exchange")
            self.upload = upload
            self.revoke = base.appendingPathComponent("device-revoke")
            self.reconnectKey = base.appendingPathComponent("device-reconnect-key")
        }
    }

    private struct ExchangePayload: Encodable {
        let pairingCode: String
        let deviceName: String
        let codeVerifier: String?
        var reconnectKey: String? = nil
    }

    private struct ExchangeResponse: Decodable {
        let credential: String
        let deviceId: String
        let expiresAt: Date
        let accountLabel: String
        let grantedScopes: Set<DeviceScope>?

        var record: StoredDeviceCredential {
            StoredDeviceCredential(credential: credential, connection: DeviceConnectionInfo(
                deviceID: deviceId, accountLabel: accountLabel, expiresAt: expiresAt,
                grantedScopes: grantedScopes ?? DeviceScope.metadataOnly))
        }
    }

    private struct ReconnectExchangeResponse: Decodable {
        let record: StoredDeviceCredential
        let support: DeviceReconnectSupport

        private enum CodingKeys: String, CodingKey { case reconnectSupported }

        init(from decoder: any Decoder) throws {
            record = try ExchangeResponse(from: decoder).record
            let values = try decoder.container(keyedBy: CodingKeys.self)
            if !values.contains(.reconnectSupported) {
                support = .unsupported
            } else if let supported = try? values.decode(Bool.self, forKey: .reconnectSupported) {
                support = supported ? .supported : .unsupported
            } else {
                // Preserve the issued bearer for caller cleanup even when the
                // acknowledgement is malformed; it must never authorize adoption.
                support = .invalid
            }
        }
    }

    private struct ReconnectBindingResponse: Decodable {
        let deviceId: String
        let reconnectSupported: Bool
    }

    private let endpoints: Endpoints
    private let session: any DeviceHTTPSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(
        uploadEndpoint: URL = SkillSyncService.configuredEndpoint(),
        session: any DeviceHTTPSession = URLSession.shared,
        reportMode: DeviceReportMode = .legacy
    ) {
        self.endpoints = Endpoints(upload: uploadEndpoint)
        self.session = session
        self.reportMode = reportMode
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
    }

    func exchange(
        pairingCode: String,
        deviceName: String,
        codeVerifier: String? = nil
    ) async throws -> StoredDeviceCredential {
        let payload = ExchangePayload(
            pairingCode: pairingCode.trimmingCharacters(in: .whitespacesAndNewlines),
            deviceName: deviceName.trimmingCharacters(in: .whitespacesAndNewlines),
            codeVerifier: codeVerifier
        )
        let response: ExchangeResponse = try await send(
            to: endpoints.exchange,
            body: encoder.encode(payload),
            credential: nil,
            unauthorizedError: .invalidPairingCode
        )
        return response.record
    }

    func exchangeForReconnect(pairingCode: String, deviceName: String, codeVerifier: String?,
                              reconnectKey: String) async throws -> DeviceReconnectExchange {
        try validateReconnectRequest(reconnectKey)
        let payload = ExchangePayload(pairingCode: pairingCode.trimmingCharacters(in: .whitespacesAndNewlines),
            deviceName: deviceName.trimmingCharacters(in: .whitespacesAndNewlines),
            codeVerifier: codeVerifier, reconnectKey: reconnectKey)
        let response: ReconnectExchangeResponse = try await send(to: endpoints.exchange,
            body: encoder.encode(payload), credential: nil, unauthorizedError: .invalidPairingCode)
        return DeviceReconnectExchange(record: response.record, support: response.support)
    }

    func bindReconnectKey(credential: String, reconnectKey: String, expectedDeviceID: String) async throws {
        try validateReconnectRequest(reconnectKey)
        guard !expectedDeviceID.isEmpty else { throw DeviceSyncAPIError.invalidResponse }
        struct Payload: Encodable { let reconnectKey: String }
        let response: ReconnectBindingResponse = try await send(to: endpoints.reconnectKey,
            body: encoder.encode(Payload(reconnectKey: reconnectKey)), credential: credential,
            unauthorizedError: .reconnectRequired, conflictError: .reconnectBindingConflict)
        guard response.deviceId == expectedDeviceID else { throw DeviceSyncAPIError.invalidResponse }
        guard response.reconnectSupported else { throw DeviceSyncAPIError.unsupportedReconnect }
    }

    private func validateReconnectRequest(_ key: String) throws {
        try Task.checkCancellation()
        guard DeviceReconnectKeyStore.isValidKey(key) else { throw DeviceSyncAPIError.invalidReconnectKey }
        guard endpoints.upload.query == nil, endpoints.upload.fragment == nil,
              endpoints.upload.user == nil, endpoints.upload.password == nil else {
            throw DeviceSyncAPIError.invalidResponse
        }
    }

    func upload(credential: String, installations: [Skill]) async throws -> SkillSyncResult {
        let body: Data
        switch reportMode {
        case .legacy:
            body = try encoder.encode(DeviceSkillSyncPayload(skills: SkillSyncService.payloadSkills(installations)))
        case .presence:
            body = try encoder.encode(SkillSyncService.presencePayload(installations: installations))
        case .reconciliation:
            throw DeviceSyncAPIError.unsupportedReportMode
        }
        let result: SkillSyncResult = try await send(
            to: endpoints.upload,
            body: body,
            credential: credential,
            unauthorizedError: .reconnectRequired
        )
        if reportMode == .presence {
            guard result.reportVersion == 2, result.mode == "presence",
                  let deviceId = result.deviceId, !deviceId.isEmpty,
                  !result.syncRunId.isEmpty, result.syncedSkillCount == installations.count,
                  result.reportedAt != nil else { throw DeviceSyncAPIError.invalidResponse }
        }
        return result
    }

    private struct RevisionResponse: Decodable {
        let revision: String?
        private enum CodingKeys: String, CodingKey { case reportVersion, revision }
        init(from decoder: any Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            guard try values.decode(Int.self, forKey: .reportVersion) == 3,
                  values.contains(.revision) else { throw DeviceSyncAPIError.invalidResponse }
            revision = try values.decodeIfPresent(String.self, forKey: .revision)
            if let revision, UUID(uuidString: revision) == nil { throw DeviceSyncAPIError.invalidResponse }
        }
    }

    func inventoryRevision(credential: String) async throws -> String? {
        guard reportMode == .reconciliation else { throw DeviceSyncAPIError.unsupportedReportMode }
        guard var url = URLComponents(url: endpoints.upload, resolvingAgainstBaseURL: false) else {
            throw DeviceSyncAPIError.invalidResponse
        }
        url.queryItems = [.init(name: "reportVersion", value: "3")]
        guard let endpoint = url.url else { throw DeviceSyncAPIError.invalidResponse }
        let result: RevisionResponse = try await send(to: endpoint, body: nil, credential: credential,
            unauthorizedError: .reconnectRequired, method: "GET", conflictError: .inventoryChanged)
        return result.revision?.lowercased()
    }

    func reconcile(credential: String, payload: ReconciliationSyncPayload) async throws -> SkillSyncResult {
        guard reportMode == .reconciliation else { throw DeviceSyncAPIError.unsupportedReportMode }
        try Task.checkCancellation()
        let result: SkillSyncResult = try await send(to: endpoints.upload, body: encoder.encode(payload),
            credential: credential, unauthorizedError: .reconnectRequired, conflictError: .inventoryChanged)
        try result.validateReconciliation(payload)
        return result
    }

    func revoke(credential: String) async throws {
        let _: DeviceRevokeResponse = try await send(
            to: endpoints.revoke,
            body: Data("{}".utf8),
            credential: credential,
            unauthorizedError: .reconnectRequired
        )
    }

    func checkInventory(credential: String, payload: InventoryCheckPayload) async throws -> InventoryCheckResult {
        guard reportMode == .reconciliation else { throw DeviceSyncAPIError.unsupportedReportMode }
        guard endpoints.upload.query == nil else { throw DeviceSyncAPIError.invalidResponse }
        try Task.checkCancellation()
        let result: InventoryCheckResult = try await send(to: endpoints.upload, body: encoder.encode(payload),
            credential: credential, unauthorizedError: .reconnectRequired, conflictError: .inventoryChanged)
        try result.validate(payload)
        return result
    }

    private struct DeviceRevokeResponse: Decodable {
        let revoked: Bool
    }

    private func send<Response: Decodable>(
        to url: URL,
        body: Data?,
        credential: String?,
        unauthorizedError: DeviceSyncAPIError,
        method: String = "POST",
        conflictError: DeviceSyncAPIError = .deviceLimitReached
    ) async throws -> Response {
        var request = URLRequest(url: url)
        try Task.checkCancellation()
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let credential {
            request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = 20
        request.httpBody = body

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DeviceSyncAPIError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            if reportMode == .reconciliation, url.path == endpoints.upload.path,
               httpResponse.statusCode == 408 || httpResponse.statusCode == 429 || (500...599).contains(httpResponse.statusCode) {
                throw DeviceSyncAPIError.retryableServer(statusCode: httpResponse.statusCode,
                    retryAfter: Self.retryDelay(httpResponse.value(forHTTPHeaderField: "Retry-After")))
            }
            switch httpResponse.statusCode {
            case 401: throw unauthorizedError
            case 409: throw conflictError
            case 429: throw DeviceSyncAPIError.rateLimited
            default: throw DeviceSyncAPIError.server(statusCode: httpResponse.statusCode)
            }
        }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw DeviceSyncAPIError.invalidResponse
        }
    }

    static func retryDelay(_ header: String?, now: Date = Date()) -> TimeInterval? {
        guard let header else { return nil }
        let value = header.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty, value.utf8.allSatisfy({ (48...57).contains($0) }),
           let seconds = Double(value), seconds.isFinite { return seconds }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        formatter.isLenient = false
        return formatter.date(from: value).map { max(0, $0.timeIntervalSince(now)) }
    }
}
