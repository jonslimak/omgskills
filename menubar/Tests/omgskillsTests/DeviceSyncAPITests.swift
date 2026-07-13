import Foundation
import Testing
@testable import omgskills

struct DeviceSyncAPITests {
    @Test func derivesDeviceEndpointsFromConfiguredUploadEndpoint() {
        let endpoints = DeviceSyncAPI.Endpoints(
            upload: URL(string: "https://example.com/api/portal/sync-upload")!
        )

        #expect(endpoints.exchange.absoluteString == "https://example.com/api/portal/sync-exchange")
        #expect(endpoints.revoke.absoluteString == "https://example.com/api/portal/device-revoke")
    }

    @Test func exchangeTrimsInputAndDecodesCredentialMetadata() async throws {
        let session = MockDeviceHTTPSession(responses: [
            .init(statusCode: 200, body: """
            {
              "credential": "device-secret",
              "deviceId": "device-1",
              "expiresAt": "2027-07-13T12:00:00.000Z",
              "accountLabel": "jon@example.com"
            }
            """)
        ])
        let api = DeviceSyncAPI(
            uploadEndpoint: URL(string: "https://example.com/api/portal/sync-upload")!,
            session: session
        )

        let result = try await api.exchange(
            pairingCode: "  pair-code\n",
            deviceName: " Jon's Mac  ",
            codeVerifier: nil
        )
        let request = try #require(await session.requests().first)
        let body = try #require(request.httpBody)
        let json = try #require(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )

        #expect(request.url?.path == "/api/portal/sync-exchange")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(json["pairingCode"] as? String == "pair-code")
        #expect(json["deviceName"] as? String == "Jon's Mac")
        #expect(result.credential == "device-secret")
        #expect(result.connection.deviceID == "device-1")
    }

    @Test func uploadUsesBearerCredentialAndResolvedPayloadContract() async throws {
        let session = MockDeviceHTTPSession(responses: [
            .init(statusCode: 200, body: "{\"syncRunId\":\"run-1\",\"syncedSkillCount\":0}")
        ])
        let api = DeviceSyncAPI(
            uploadEndpoint: URL(string: "https://example.com/api/portal/sync-upload")!,
            session: session
        )

        let result = try await api.upload(credential: "device-secret", installations: [])
        let request = try #require(await session.requests().first)
        let body = try #require(request.httpBody)
        let json = try #require(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )

        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer device-secret")
        #expect(request.url?.path == "/api/portal/sync-upload")
        #expect((json["skills"] as? [Any])?.isEmpty == true)
        #expect(json["token"] == nil)
        #expect(result == SkillSyncResult(syncRunId: "run-1", syncedSkillCount: 0))
    }

    @Test func unauthorizedErrorsAreOperationSpecific() async {
        let exchangeSession = MockDeviceHTTPSession(responses: [.init(statusCode: 401, body: "{}")])
        let exchangeAPI = DeviceSyncAPI(session: exchangeSession)

        await #expect(throws: DeviceSyncAPIError.invalidPairingCode) {
            try await exchangeAPI.exchange(pairingCode: "code", deviceName: "Mac", codeVerifier: nil)
        }

        let uploadSession = MockDeviceHTTPSession(responses: [.init(statusCode: 401, body: "{}")])
        let uploadAPI = DeviceSyncAPI(session: uploadSession)
        await #expect(throws: DeviceSyncAPIError.reconnectRequired) {
            try await uploadAPI.upload(credential: "credential", installations: [])
        }
    }

    @Test func revokeUsesBearerCredential() async throws {
        let session = MockDeviceHTTPSession(responses: [
            .init(statusCode: 200, body: "{\"revoked\":true}")
        ])
        let api = DeviceSyncAPI(
            uploadEndpoint: URL(string: "https://example.com/api/portal/sync-upload")!,
            session: session
        )

        try await api.revoke(credential: "device-secret")
        let request = try #require(await session.requests().first)

        #expect(request.url?.path == "/api/portal/device-revoke")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer device-secret")
        #expect(request.httpBody == Data("{}".utf8))
    }
}

private actor MockDeviceHTTPSession: DeviceHTTPSession {
    struct Response: Sendable {
        let statusCode: Int
        let body: String
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
            headerFields: nil
        )!
        return (Data(response.body.utf8), httpResponse)
    }

    func requests() -> [URLRequest] {
        recordedRequests
    }
}
