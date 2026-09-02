import Foundation
import Testing
@testable import omgskills

struct DeviceGroupManifestAPITests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func fetchesManifestWithDeviceCredential() async throws {
        let session = GroupManifestHTTPSession(responses: [
            .init(statusCode: 200, body: try fixtureData())
        ])
        let api = makeAPI(session: session)

        let manifest = try await api.fetchManifest(
            route: DeviceGroupManifestRoute(handle: "OpenAI", groupSlug: "Team-Skills"),
            credential: credential()
        )
        let request = try #require(await session.requests().first)

        #expect(manifest.group.slug == "team-skills")
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://example.com/api/device/groups/openai/team-skills/manifest")
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer device-secret")
        #expect(request.httpBody == nil)
    }

    @Test func rejectsExpiredOrInsufficientCredentialBeforeNetwork() async throws {
        let session = GroupManifestHTTPSession(responses: [])
        let api = makeAPI(session: session)
        let route = try DeviceGroupManifestRoute(handle: "owner", groupSlug: "group")

        await #expect(throws: DeviceGroupManifestAPIError.reconnectRequired) {
            try await api.fetchManifest(
                route: route,
                credential: credential(expiresAt: now.addingTimeInterval(-1))
            )
        }
        await #expect(throws: DeviceGroupManifestAPIError.contentReadRequired) {
            try await api.fetchManifest(
                route: route,
                credential: credential(scopes: DeviceScope.metadataOnly)
            )
        }
        #expect(await session.requests().isEmpty)
    }

    @Test func mapsStatusCodesWithoutConflatingReconnect() async throws {
        let fixtures: [(Int, [String: String]?, DeviceGroupManifestAPIError)] = [
            (401, nil, .reconnectRequired),
            (404, nil, .groupUnavailable),
            (429, ["Retry-After": "60"], .rateLimited(retryAfter: "60")),
            (503, ["Retry-After": "300"], .temporarilyUnavailable(retryAfter: "300")),
            (500, nil, .server(statusCode: 500))
        ]
        let route = try DeviceGroupManifestRoute(handle: "owner", groupSlug: "group")

        for (statusCode, headers, expected) in fixtures {
            let session = GroupManifestHTTPSession(responses: [
                .init(statusCode: statusCode, headers: headers, body: Data("{}".utf8))
            ])
            let api = makeAPI(session: session)
            await #expect(throws: expected) {
                try await api.fetchManifest(route: route, credential: credential())
            }
        }
    }

    @Test func rejectsInvalidConfigurationResponseSizeAndPayload() async throws {
        let route = try DeviceGroupManifestRoute(handle: "owner", groupSlug: "group")
        let invalidConfig = DeviceGroupManifestAPI(
            uploadEndpoint: URL(string: "http://example.com/api/portal/sync-upload")!,
            session: GroupManifestHTTPSession(responses: []),
            now: { now }
        )
        await #expect(throws: DeviceGroupManifestAPIError.invalidConfiguration) {
            try await invalidConfig.fetchManifest(route: route, credential: credential())
        }

        let oversized = GroupManifestHTTPSession(responses: [
            .init(
                statusCode: 200,
                body: Data(repeating: 0, count: DeviceGroupManifestAPI.maximumResponseBytes + 1)
            )
        ])
        await #expect(throws: DeviceGroupManifestAPIError.responseTooLarge) {
            try await makeAPI(session: oversized).fetchManifest(
                route: route,
                credential: credential()
            )
        }

        let malformed = GroupManifestHTTPSession(responses: [
            .init(statusCode: 200, body: Data("{\"version\":2}".utf8))
        ])
        await #expect(throws: DeviceGroupManifestAPIError.invalidResponse) {
            try await makeAPI(session: malformed).fetchManifest(
                route: route,
                credential: credential()
            )
        }
    }

    @Test func propagatesCancellationWithoutConvertingItToFailure() async throws {
        let session = GatedGroupManifestHTTPSession(responseBody: try fixtureData())
        let api = makeAPI(session: session)
        let route = try DeviceGroupManifestRoute(handle: "owner", groupSlug: "group")

        let task = Task {
            try await api.fetchManifest(route: route, credential: credential())
        }
        await session.waitUntilRequested()
        task.cancel()
        await session.release()

        await #expect(throws: CancellationError.self) {
            try await task.value
        }
    }

    @Test func normalizesURLSessionCancellation() async throws {
        let api = makeAPI(session: CancelledGroupManifestHTTPSession())
        let route = try DeviceGroupManifestRoute(handle: "owner", groupSlug: "group")

        await #expect(throws: CancellationError.self) {
            try await api.fetchManifest(route: route, credential: credential())
        }
    }

    private func makeAPI(session: any DeviceHTTPSession) -> DeviceGroupManifestAPI {
        DeviceGroupManifestAPI(
            uploadEndpoint: URL(string: "https://example.com/api/portal/sync-upload")!,
            session: session,
            now: { now }
        )
    }

    private func credential(
        expiresAt: Date? = nil,
        scopes: Set<DeviceScope> = Set(DeviceScope.allCases)
    ) -> StoredDeviceCredential {
        StoredDeviceCredential(
            credential: "device-secret",
            connection: DeviceConnectionInfo(
                deviceID: "device-1",
                accountLabel: "jon@example.com",
                expiresAt: expiresAt ?? now.addingTimeInterval(3_600),
                grantedScopes: scopes
            )
        )
    }

    private func fixtureData() throws -> Data {
        let url = try #require(Bundle.module.url(
            forResource: "group-manifest-v2",
            withExtension: "json",
            subdirectory: "Fixtures"
        ))
        return try Data(contentsOf: url)
    }
}

private actor GroupManifestHTTPSession: DeviceHTTPSession {
    struct Response: Sendable {
        let statusCode: Int
        let headers: [String: String]?
        let body: Data

        init(statusCode: Int, headers: [String: String]? = nil, body: Data) {
            self.statusCode = statusCode
            self.headers = headers
            self.body = body
        }
    }

    private var responses: [Response]
    private var recordedRequests: [URLRequest] = []

    init(responses: [Response]) {
        self.responses = responses
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        recordedRequests.append(request)
        guard !responses.isEmpty else {
            throw URLError(.badServerResponse)
        }
        let response = responses.removeFirst()
        let httpResponse = HTTPURLResponse(
            url: request.url!,
            statusCode: response.statusCode,
            httpVersion: nil,
            headerFields: response.headers
        )!
        return (response.body, httpResponse)
    }

    func requests() -> [URLRequest] {
        recordedRequests
    }
}

private actor GatedGroupManifestHTTPSession: DeviceHTTPSession {
    private let responseBody: Data
    private var requested = false
    private var requestWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    init(responseBody: Data) {
        self.responseBody = responseBody
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requested = true
        let waiters = requestWaiters
        requestWaiters.removeAll()
        waiters.forEach { $0.resume() }
        await withCheckedContinuation { continuation in
            releaseContinuation = continuation
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: nil,
            headerFields: nil
        )!
        return (responseBody, response)
    }

    func waitUntilRequested() async {
        guard !requested else { return }
        await withCheckedContinuation { continuation in
            requestWaiters.append(continuation)
        }
    }

    func release() {
        releaseContinuation?.resume()
        releaseContinuation = nil
    }
}

private struct CancelledGroupManifestHTTPSession: DeviceHTTPSession {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        throw URLError(.cancelled)
    }
}
