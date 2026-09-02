import Foundation

enum DeviceGroupManifestAPIError: LocalizedError, Equatable, Sendable {
    case invalidConfiguration
    case contentReadRequired
    case reconnectRequired
    case groupUnavailable
    case rateLimited(retryAfter: String?)
    case temporarilyUnavailable(retryAfter: String?)
    case server(statusCode: Int)
    case responseTooLarge
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "Group loading is not configured correctly."
        case .contentReadRequired:
            return "Reconnect this Mac and allow access to shared skill content."
        case .reconnectRequired:
            return "This Mac is no longer connected. Connect it again to load this group."
        case .groupUnavailable:
            return "This skill group is unavailable or you no longer have access."
        case .rateLimited:
            return "Too many requests. Wait briefly and try again."
        case .temporarilyUnavailable:
            return "Skill Groups are temporarily unavailable."
        case .server:
            return "The web portal could not load this group. Try again shortly."
        case .responseTooLarge, .invalidResponse:
            return "The web portal returned an invalid group."
        }
    }
}

protocol DeviceGroupManifestServing: Sendable {
    func fetchManifest(
        route: DeviceGroupManifestRoute,
        credential: StoredDeviceCredential
    ) async throws -> GroupManifest
}

struct DeviceGroupManifestAPI: DeviceGroupManifestServing, Sendable {
    static let maximumResponseBytes = 1 * 1024 * 1024

    private let origin: URL?
    private let session: any DeviceHTTPSession
    private let now: @Sendable () -> Date

    init(
        uploadEndpoint: URL = SkillSyncService.configuredEndpoint(),
        session: any DeviceHTTPSession = URLSession.shared,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.origin = Self.origin(from: uploadEndpoint)
        self.session = session
        self.now = now
    }

    func fetchManifest(
        route: DeviceGroupManifestRoute,
        credential: StoredDeviceCredential
    ) async throws -> GroupManifest {
        guard credential.connection.expiresAt > now() else {
            throw DeviceGroupManifestAPIError.reconnectRequired
        }
        guard credential.connection.grantedScopes.contains(.contentRead) else {
            throw DeviceGroupManifestAPIError.contentReadRequired
        }
        guard let origin else {
            throw DeviceGroupManifestAPIError.invalidConfiguration
        }

        let url = origin
            .appendingPathComponent("api")
            .appendingPathComponent("device")
            .appendingPathComponent("groups")
            .appendingPathComponent(route.handle)
            .appendingPathComponent(route.groupSlug)
            .appendingPathComponent("manifest")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(credential.credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        }
        try Task.checkCancellation()
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DeviceGroupManifestAPIError.invalidResponse
        }
        try Self.validateStatus(httpResponse)
        guard data.count <= Self.maximumResponseBytes else {
            throw DeviceGroupManifestAPIError.responseTooLarge
        }

        do {
            return try JSONDecoder().decode(GroupManifest.self, from: data)
        } catch {
            throw DeviceGroupManifestAPIError.invalidResponse
        }
    }

    private static func validateStatus(_ response: HTTPURLResponse) throws {
        guard (200..<300).contains(response.statusCode) else {
            let retryAfter = response.value(forHTTPHeaderField: "Retry-After")
            switch response.statusCode {
            case 401:
                throw DeviceGroupManifestAPIError.reconnectRequired
            case 404:
                throw DeviceGroupManifestAPIError.groupUnavailable
            case 429:
                throw DeviceGroupManifestAPIError.rateLimited(retryAfter: retryAfter)
            case 503:
                throw DeviceGroupManifestAPIError.temporarilyUnavailable(retryAfter: retryAfter)
            default:
                throw DeviceGroupManifestAPIError.server(statusCode: response.statusCode)
            }
        }
    }

    private static func origin(from endpoint: URL) -> URL? {
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false),
              components.scheme == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil
        else {
            return nil
        }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }
}
