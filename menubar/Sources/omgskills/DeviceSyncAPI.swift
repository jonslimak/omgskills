import Foundation

enum DeviceSyncAPIError: LocalizedError, Equatable, Sendable {
    case invalidPairingCode
    case reconnectRequired
    case deviceLimitReached
    case rateLimited
    case server(statusCode: Int)
    case invalidResponse

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
        case .server:
            return "The web portal could not complete the request. Try again shortly."
        case .invalidResponse:
            return "The web portal returned an invalid response."
        }
    }
}

protocol DeviceSyncServing: Sendable {
    func exchange(
        pairingCode: String,
        deviceName: String,
        codeVerifier: String?
    ) async throws -> StoredDeviceCredential
    func upload(credential: String, installations: [Skill]) async throws -> SkillSyncResult
    func revoke(credential: String) async throws
}

protocol DeviceHTTPSession: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: DeviceHTTPSession {}

struct DeviceSyncAPI: DeviceSyncServing, Sendable {
    struct Endpoints: Equatable, Sendable {
        let exchange: URL
        let upload: URL
        let revoke: URL

        init(upload: URL) {
            let base = upload.deletingLastPathComponent()
            self.exchange = base.appendingPathComponent("sync-exchange")
            self.upload = upload
            self.revoke = base.appendingPathComponent("device-revoke")
        }
    }

    private struct ExchangePayload: Encodable {
        let pairingCode: String
        let deviceName: String
        let codeVerifier: String?
    }

    private struct ExchangeResponse: Decodable {
        let credential: String
        let deviceId: String
        let expiresAt: Date
        let accountLabel: String
        let grantedScopes: Set<DeviceScope>?
    }

    private let endpoints: Endpoints
    private let session: any DeviceHTTPSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(
        uploadEndpoint: URL = SkillSyncService.configuredEndpoint(),
        session: any DeviceHTTPSession = URLSession.shared
    ) {
        self.endpoints = Endpoints(upload: uploadEndpoint)
        self.session = session
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
        return StoredDeviceCredential(
            credential: response.credential,
            connection: DeviceConnectionInfo(
                deviceID: response.deviceId,
                accountLabel: response.accountLabel,
                expiresAt: response.expiresAt,
                grantedScopes: response.grantedScopes ?? DeviceScope.metadataOnly
            )
        )
    }

    func upload(credential: String, installations: [Skill]) async throws -> SkillSyncResult {
        let payload = DeviceSkillSyncPayload(skills: SkillSyncService.payloadSkills(installations))
        return try await send(
            to: endpoints.upload,
            body: encoder.encode(payload),
            credential: credential,
            unauthorizedError: .reconnectRequired
        )
    }

    func revoke(credential: String) async throws {
        let _: DeviceRevokeResponse = try await send(
            to: endpoints.revoke,
            body: Data("{}".utf8),
            credential: credential,
            unauthorizedError: .reconnectRequired
        )
    }

    private struct DeviceRevokeResponse: Decodable {
        let revoked: Bool
    }

    private func send<Response: Decodable>(
        to url: URL,
        body: Data,
        credential: String?,
        unauthorizedError: DeviceSyncAPIError
    ) async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
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
            switch httpResponse.statusCode {
            case 401: throw unauthorizedError
            case 409: throw DeviceSyncAPIError.deviceLimitReached
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
}
