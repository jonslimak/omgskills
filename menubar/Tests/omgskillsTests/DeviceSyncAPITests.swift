import Foundation
import Testing
@testable import omgskills

struct DeviceSyncAPITests {
    @Test func revisionReadUsesExactAuthenticatedGetAndRequiresExplicitRevision() async throws {
        for value in ["null", "\"AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE\""] {
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: 200,
                body: "{\"reportVersion\":3,\"revision\":\(value)}")])
            let api = DeviceSyncAPI(uploadEndpoint: URL(string: "http://127.0.0.1:8888/api/portal/sync-upload")!,
                session: session, reportMode: .reconciliation)
            let revision = try await api.inventoryRevision(credential: "secret")
            #expect(revision == (value == "null" ? nil : "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"))
            let request = try #require(await session.requests().first)
            #expect(request.url?.absoluteString == "http://127.0.0.1:8888/api/portal/sync-upload?reportVersion=3")
            #expect(request.httpMethod == "GET")
            #expect(request.httpBody == nil)
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
        }
        for body in ["{}", "{\"reportVersion\":3}", "{\"reportVersion\":2,\"revision\":null}",
                     "{\"reportVersion\":3,\"revision\":\"bad\"}", "{\"reportVersion\":3,\"revision\":1}"] {
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: 200, body: body)])
            await #expect(throws: DeviceSyncAPIError.invalidResponse) {
                try await DeviceSyncAPI(session: session, reportMode: .reconciliation).inventoryRevision(credential: "secret")
            }
            #expect(await session.requests().count == 1)
        }
    }

    @Test func reconciliationUsesExplicitPayloadAndValidatesEveryAcknowledgementFact() async throws {
        let payload = ReconciliationSyncPayload(baseRevision: nil, roots: ["claude", "codex", "agents"].map {
            .init(source: $0, state: .complete, reason: nil)
        }, skills: [])
        let roots = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload.roots))
        let run = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        let valid: [String: Any] = ["syncRunId": run, "revision": run, "syncedSkillCount": 0,
            "missingSkillCount": 1, "reportVersion": 3, "mode": "reconciled", "deviceId": "d",
            "completedAt": "2026-10-16T12:00:00.123Z", "roots": roots, "complete": true]
        let changes: [[String: Any]] = [[:], ["syncRunId": "bad"], ["revision": "bad"],
            ["syncedSkillCount": 1], ["missingSkillCount": -1], ["reportVersion": 2], ["mode": "presence"],
            ["deviceId": ""], ["completedAt": "bad"], ["roots": []], ["complete": false],
            ["revision": NSNull()], ["missingSkillCount": NSNull()], ["complete": NSNull()]]
        for (index, change) in changes.enumerated() {
            let response = valid.merging(change) { _, new in new }
            let body = String(decoding: try JSONSerialization.data(withJSONObject: response), as: UTF8.self)
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: 200, body: body)])
            let api = DeviceSyncAPI(session: session, reportMode: .reconciliation)
            if index == 0 {
                let result = try await api.reconcile(credential: "secret", payload: payload)
                #expect(result.missingSkillCount == 1)
                #expect(throws: DeviceSyncAPIError.invalidResponse) { try result.validateReconciliation(payload, deviceID: "wrong-device") }
            } else {
                await #expect(throws: DeviceSyncAPIError.invalidResponse) { try await api.reconcile(credential: "secret", payload: payload) }
            }
            let requests = await session.requests()
            #expect(requests.count == 1)
            let request = try #require(requests.first)
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
            let data = try #require(request.httpBody)
            let actual = try #require(JSONSerialization.jsonObject(with: data) as? NSDictionary)
            let expected = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload))
            #expect(actual.isEqual(expected))
        }
    }

    @Test func reconciliationConflictDoesNotBecomePairingLimitOrLegacyRetry() async {
        let payload = ReconciliationSyncPayload(baseRevision: nil, roots: [], skills: [])
        for (code, error) in [(409, DeviceSyncAPIError.inventoryChanged), (401, .reconnectRequired),
                              (429, .rateLimited), (503, .server(statusCode: 503))] {
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: code, body: "{}")])
            let api = DeviceSyncAPI(session: session, reportMode: .reconciliation)
            await #expect(throws: error) { try await api.reconcile(credential: "secret", payload: payload) }
            #expect(await session.requests().count == 1)
        }
        let session = MockDeviceHTTPSession(responses: [.init(statusCode: 409, body: "{}")])
        await #expect(throws: DeviceSyncAPIError.deviceLimitReached) {
            try await DeviceSyncAPI(session: session).exchange(pairingCode: "code", deviceName: "Mac")
        }
        let unused = MockDeviceHTTPSession(responses: [])
        await #expect(throws: DeviceSyncAPIError.unsupportedReportMode) {
            try await DeviceSyncAPI(session: unused).inventoryRevision(credential: "secret")
        }
        await #expect(throws: DeviceSyncAPIError.unsupportedReportMode) {
            try await DeviceSyncAPI(session: unused, reportMode: .reconciliation).upload(credential: "secret", installations: [])
        }
        #expect(await unused.requests().isEmpty)
    }

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
              "accountLabel": "jon@example.com",
              "grantedScopes": ["sync:write", "self:revoke", "content:read"]
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
            codeVerifier: "pkce-verifier"
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
        #expect(json["codeVerifier"] as? String == "pkce-verifier")
        #expect(result.credential == "device-secret")
        #expect(result.connection.deviceID == "device-1")
        #expect(result.connection.grantedScopes == Set(DeviceScope.allCases))
    }

    @Test func exchangeWithoutScopesRemainsMetadataOnly() async throws {
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
        let api = DeviceSyncAPI(session: session)

        let result = try await api.exchange(pairingCode: "code", deviceName: "Mac", codeVerifier: nil)

        #expect(result.connection.grantedScopes == DeviceScope.metadataOnly)
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

    @Test func presenceUploadUsesVersionTwoAndDecodesAcknowledgment() async throws {
        let session = MockDeviceHTTPSession(responses: [.init(statusCode: 200, body: """
            {"syncRunId":"run-2","syncedSkillCount":0,"reportVersion":2,"mode":"presence",
             "deviceId":"device-2","completedAt":"2026-10-16T12:00:00.123Z"}
            """)])
        let api = DeviceSyncAPI(uploadEndpoint: URL(string: "http://127.0.0.1:8888/api/portal/sync-upload")!,
            session: session, reportMode: .presence)
        let result = try await api.upload(credential: "secret", installations: [])
        let request = try #require(await session.requests().first)
        let data = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(Set(body.keys) == ["reportVersion", "skills"])
        #expect(body["reportVersion"] as? Int == 2)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
        #expect(result.deviceId == "device-2")
        #expect(result.completedAt == "2026-10-16T12:00:00.123Z")
        #expect(result.reportedAt != nil)
        #expect(api.reportMode == .presence)
    }

    @Test func presenceRejectsLegacyOrMalformedAcknowledgmentAndNeverRetriesLegacy() async throws {
        for body in ["{\"syncRunId\":\"run\",\"syncedSkillCount\":0}",
                     "{\"syncRunId\":\"run\",\"syncedSkillCount\":0,\"reportVersion\":2,\"mode\":\"presence\",\"deviceId\":\"d\",\"completedAt\":\"bad\"}",
                     "{\"syncRunId\":\"run\",\"syncedSkillCount\":1,\"reportVersion\":2,\"mode\":\"presence\",\"deviceId\":\"d\",\"completedAt\":\"2026-10-16T12:00:00Z\"}"] {
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: 200, body: body)])
            let api = DeviceSyncAPI(session: session, reportMode: .presence)
            await #expect(throws: DeviceSyncAPIError.invalidResponse) { try await api.upload(credential: "secret", installations: []) }
            #expect(await session.requests().count == 1)
        }
    }

    @Test func presenceKeepsUnauthorizedAndServerFailuresAndDoesNotRetry() async {
        for (status, error) in [(401, DeviceSyncAPIError.reconnectRequired), (503, .server(statusCode: 503))] {
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: status, body: "{}")])
            let api = DeviceSyncAPI(session: session, reportMode: .presence)
            await #expect(throws: error) { try await api.upload(credential: "secret", installations: []) }
            #expect(await session.requests().count == 1)
        }
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
