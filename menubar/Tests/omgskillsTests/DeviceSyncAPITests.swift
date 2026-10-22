import Foundation
import Testing
@testable import omgskills

struct DeviceSyncAPITests {
    private static let reconnectKey = String(repeating: "a", count: 64)
    private static let issuedRecordJSON = """
    "credential":"issued-secret","deviceId":"same-id","expiresAt":"2027-07-13T12:00:00Z",
    "accountLabel":"test@example.test","grantedScopes":["sync:write","self:revoke"]
    """

    @Test func keyedExchangePreservesIssuedRecordForEveryAcknowledgement() async throws {
        let cases: [(String, DeviceReconnectSupport)] = [("", .unsupported), (",\"reconnectSupported\":true", .supported),
            (",\"reconnectSupported\":false", .unsupported), (",\"reconnectSupported\":null", .invalid),
            (",\"reconnectSupported\":\"true\"", .invalid), (",\"reconnectSupported\":1", .invalid)]
        for (ack, support) in cases {
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: 200, body: "{\(Self.issuedRecordJSON)\(ack)}")])
            let api = DeviceSyncAPI(uploadEndpoint: URL(string: "https://example.test/api/portal/sync-upload")!, session: session)
            let response = try await api.exchangeForReconnect(pairingCode: " code\n", deviceName: " Mac ",
                codeVerifier: "verifier", reconnectKey: Self.reconnectKey)
            #expect(response.support == support)
            #expect(response.record.credential == "issued-secret")
            #expect(response.record.connection.deviceID == "same-id")
            #expect(response.record.connection.grantedScopes == DeviceScope.metadataOnly)
            let requests = await session.requests()
            #expect(requests.count == 1)
            let request = try #require(requests.first)
            #expect(request.url?.absoluteString == "https://example.test/api/portal/sync-exchange")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            let data = try #require(request.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: data) as? NSDictionary)
            #expect(body.isEqual(to: ["pairingCode": "code", "deviceName": "Mac", "codeVerifier": "verifier", "reconnectKey": Self.reconnectKey]))
        }
    }

    @Test func bindingUsesOnlyKeyAndBearerAndValidatesTargetAndSupport() async throws {
        for body in ["{\"deviceId\":\"same-id\",\"reconnectSupported\":true}",
                     "{\"deviceId\":\"other-id\",\"reconnectSupported\":true}",
                     "{\"deviceId\":\"same-id\",\"reconnectSupported\":false}",
                     "{\"deviceId\":\"same-id\"}", "{\"deviceId\":\"same-id\",\"reconnectSupported\":\"true\"}"] {
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: 200, body: body)])
            let api = DeviceSyncAPI(uploadEndpoint: URL(string: "https://example.test/api/portal/sync-upload")!, session: session)
            if body.contains("other-id") || !body.contains("\"reconnectSupported\":true") {
                let error: DeviceSyncAPIError = body.contains(":false") ? .unsupportedReconnect : .invalidResponse
                await #expect(throws: error) {
                    try await api.bindReconnectKey(credential: "current-secret", reconnectKey: Self.reconnectKey, expectedDeviceID: "same-id")
                }
            } else {
                try await api.bindReconnectKey(credential: "current-secret", reconnectKey: Self.reconnectKey, expectedDeviceID: "same-id")
            }
            #expect(await session.requests().count == 1)
            let request = try #require(await session.requests().first)
            #expect(request.url?.absoluteString == "https://example.test/api/portal/device-reconnect-key")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer current-secret")
            let data = try #require(request.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: data) as? NSDictionary)
            #expect(body.isEqual(to: ["reconnectKey": Self.reconnectKey]))
        }
    }

    @Test func reconnectErrorsRemainTypedWithoutFallbackOrSecretEcho() async throws {
        for (code, exchangeError, bindingError) in [
            (401, DeviceSyncAPIError.invalidPairingCode, DeviceSyncAPIError.reconnectRequired),
            (409, .deviceLimitReached, .reconnectBindingConflict), (429, .rateLimited, .rateLimited),
            (404, .server(statusCode: 404), .server(statusCode: 404)),
            (503, .server(statusCode: 503), .server(statusCode: 503))] {
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: code, body: "secret-server-error"),
                                                           .init(statusCode: code, body: "secret-server-error")])
            let api = DeviceSyncAPI(session: session, reportMode: .reconciliation)
            await #expect(throws: exchangeError) {
                try await api.exchangeForReconnect(pairingCode: "code", deviceName: "Mac", codeVerifier: "pkce", reconnectKey: Self.reconnectKey)
            }
            await #expect(throws: bindingError) {
                try await api.bindReconnectKey(credential: "secret", reconnectKey: Self.reconnectKey, expectedDeviceID: "id")
            }
            #expect(await session.requests().count == 2)
            #expect(!exchangeError.localizedDescription.contains("secret"))
            #expect(!bindingError.localizedDescription.contains(Self.reconnectKey))
        }
    }

    @Test func invalidReconnectInputFailsBeforeHTTP() async throws {
        let session = MockDeviceHTTPSession(responses: [])
        let api = DeviceSyncAPI(session: session)
        for key in ["", "short", Self.reconnectKey + "\n", String(repeating: "A", count: 64)] {
            await #expect(throws: DeviceSyncAPIError.invalidReconnectKey) {
                try await api.exchangeForReconnect(pairingCode: "code", deviceName: "Mac", codeVerifier: nil, reconnectKey: key)
            }
            await #expect(throws: DeviceSyncAPIError.invalidReconnectKey) {
                try await api.bindReconnectKey(credential: "secret", reconnectKey: key, expectedDeviceID: "id")
            }
        }
        for value in ["https://example.test/api/portal/sync-upload?key=secret", "https://example.test/api/portal/sync-upload#key",
                      "https://user:secret@example.test/api/portal/sync-upload"] {
            let invalid = DeviceSyncAPI(uploadEndpoint: URL(string: value)!, session: session)
            await #expect(throws: DeviceSyncAPIError.invalidResponse) {
                try await invalid.exchangeForReconnect(pairingCode: "code", deviceName: "Mac", codeVerifier: nil, reconnectKey: Self.reconnectKey)
            }
        }
        await #expect(throws: DeviceSyncAPIError.invalidResponse) {
            try await api.bindReconnectKey(credential: "secret", reconnectKey: Self.reconnectKey, expectedDeviceID: "")
        }
        #expect(await session.requests().isEmpty)
    }

    @Test func reconnectProtocolDefaultsFailInsteadOfCallingLegacyExchange() async {
        let legacy = LegacyReconnectTestAPI()
        await #expect(throws: DeviceSyncAPIError.unsupportedReconnect) {
            try await legacy.exchangeForReconnect(pairingCode: "code", deviceName: "Mac", codeVerifier: nil, reconnectKey: Self.reconnectKey)
        }
        await #expect(throws: DeviceSyncAPIError.unsupportedReconnect) {
            try await legacy.bindReconnectKey(credential: "secret", reconnectKey: Self.reconnectKey, expectedDeviceID: "id")
        }
        #expect(await legacy.legacyCalls == 0)
    }

    @Test func cancellationBeforeReconnectDoesNotSendARequest() async {
        let session = MockDeviceHTTPSession(responses: [])
        let api = DeviceSyncAPI(session: session)
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await api.exchangeForReconnect(pairingCode: "code", deviceName: "Mac", codeVerifier: nil, reconnectKey: Self.reconnectKey)
        }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(await session.requests().isEmpty)
    }

    @Test func issuedBearerRemainsAvailableIfCancellationArrivesWithResponse() async throws {
        let session = ReconnectCancellationSession(body: "{\(Self.issuedRecordJSON),\"reconnectSupported\":true}")
        let api = DeviceSyncAPI(session: session)
        let task = Task { try await api.exchangeForReconnect(pairingCode: "code", deviceName: "Mac", codeVerifier: nil, reconnectKey: Self.reconnectKey) }
        let result = try await task.value
        #expect(task.isCancelled)
        #expect(result.record.credential == "issued-secret")
        #expect(result.support == .supported)
    }

    @Test func checkUsesOnlyRevisionAndValidatesAcknowledgementWithoutAFullReport() async throws {
        let revision = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        let payload = try InventoryCheckPayload(baseRevision: revision.uppercased())
        let valid: [String: Any] = ["reportVersion": 3, "mode": "checked", "deviceId": "mac",
            "revision": revision, "checkedAt": "2026-10-16T12:05:00.123Z"]
        let changes: [[String: Any]] = [[:], ["reportVersion": 2], ["mode": "reconciled"], ["deviceId": ""],
            ["revision": UUID().uuidString], ["revision": "bad"], ["checkedAt": "bad"],
            ["checkedAt": NSNull()], ["deviceId": NSNull()], ["revision": NSNull()]]
        for (index, change) in changes.enumerated() {
            let body = String(decoding: try JSONSerialization.data(withJSONObject: valid.merging(change) { _, new in new }), as: UTF8.self)
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: 200, body: body)])
            let api = DeviceSyncAPI(uploadEndpoint: URL(string: "http://127.0.0.1:8888/api/portal/sync-upload")!,
                session: session, reportMode: .reconciliation)
            if index == 0 {
                let result = try await api.checkInventory(credential: "secret", payload: payload)
                #expect(result.checkedDate != nil)
                #expect(throws: DeviceSyncAPIError.invalidResponse) { try result.validate(payload, deviceID: "other") }
            } else {
                await #expect(throws: DeviceSyncAPIError.invalidResponse) { try await api.checkInventory(credential: "secret", payload: payload) }
            }
            #expect(await session.requests().count == 1)
            let request = try #require(await session.requests().first)
            #expect(request.url?.absoluteString == "http://127.0.0.1:8888/api/portal/sync-upload")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
            let data = try #require(request.httpBody)
            let json = try #require(JSONSerialization.jsonObject(with: data) as? NSDictionary)
            #expect(json.isEqual(to: ["reportVersion": 3, "mode": "check", "baseRevision": revision]))
        }
        for key in valid.keys {
            var incomplete = valid
            incomplete.removeValue(forKey: key)
            let body = String(decoding: try JSONSerialization.data(withJSONObject: incomplete), as: UTF8.self)
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: 200, body: body)])
            await #expect(throws: DeviceSyncAPIError.invalidResponse) {
                try await DeviceSyncAPI(session: session, reportMode: .reconciliation).checkInventory(credential: "secret", payload: payload)
            }
        }
    }

    @Test func checkPreservesErrorsAndServerDelayWithoutRetryingOrChangingModes() async throws {
        let payload = try InventoryCheckPayload(baseRevision: UUID().uuidString)
        for (code, error) in [(401, DeviceSyncAPIError.reconnectRequired), (409, .inventoryChanged),
                              (408, .retryableServer(statusCode: 408, retryAfter: 90)),
                              (429, .retryableServer(statusCode: 429, retryAfter: 90)),
                              (503, .retryableServer(statusCode: 503, retryAfter: 90)), (400, .server(statusCode: 400))] {
            let session = MockDeviceHTTPSession(responses: [.init(statusCode: code, body: "{}", headers: ["Retry-After": "90"])])
            await #expect(throws: error) {
                try await DeviceSyncAPI(session: session, reportMode: .reconciliation).checkInventory(credential: "secret", payload: payload)
            }
            #expect(await session.requests().count == 1)
        }
        for mode in [DeviceReportMode.legacy, .presence] {
            let session = MockDeviceHTTPSession(responses: [])
            await #expect(throws: DeviceSyncAPIError.unsupportedReportMode) {
                try await DeviceSyncAPI(session: session, reportMode: mode).checkInventory(credential: "secret", payload: payload)
            }
            #expect(await session.requests().isEmpty)
        }
        #expect(throws: PresenceSyncError.invalidRevision) { try InventoryCheckPayload(baseRevision: "bad") }
        let session = MockDeviceHTTPSession(responses: [])
        await #expect(throws: DeviceSyncAPIError.invalidResponse) {
            try await DeviceSyncAPI(uploadEndpoint: URL(string: "http://localhost:8888/api/portal/sync-upload?extra=1")!,
                session: session, reportMode: .reconciliation).checkInventory(credential: "secret", payload: payload)
        }
        #expect(await session.requests().isEmpty)
    }

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
                              (429, .retryableServer(statusCode: 429, retryAfter: nil)),
                              (503, .retryableServer(statusCode: 503, retryAfter: nil))] {
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

    @Test(arguments: [408, 429, 500, 503])
    func reconciliationPreservesServerDelayWithoutRetryingInsideTransport(_ status: Int) async {
        let session = MockDeviceHTTPSession(responses: [.init(statusCode: status, body: "{}", headers: ["Retry-After": "90"])])
        let api = DeviceSyncAPI(session: session, reportMode: .reconciliation)
        await #expect(throws: DeviceSyncAPIError.retryableServer(statusCode: status, retryAfter: 90)) {
            try await api.inventoryRevision(credential: "secret")
        }
        #expect(await session.requests().count == 1)
    }

    @Test func retryAfterParsesSecondsAndHTTPDateButRejectsInvalidValues() {
        let now = Date(timeIntervalSince1970: 0)
        #expect(DeviceSyncAPI.retryDelay(" 60 ", now: now) == 60)
        #expect(DeviceSyncAPI.retryDelay("Thu, 01 Jan 1970 00:02:00 GMT", now: now) == 120)
        #expect(DeviceSyncAPI.retryDelay("Thu, 01 Jan 1970 00:00:00 GMT", now: now) == 0)
        for invalid in ["-1", "nan", "inf", "1.5", "nonsense", ""] {
            #expect(DeviceSyncAPI.retryDelay(invalid, now: now) == nil)
        }
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
        #expect(Set(json.keys) == ["pairingCode", "deviceName", "codeVerifier"])
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

private actor LegacyReconnectTestAPI: DeviceSyncServing {
    private(set) var legacyCalls = 0
    func exchange(pairingCode: String, deviceName: String, codeVerifier: String?) async throws -> StoredDeviceCredential {
        legacyCalls += 1
        throw DeviceSyncAPIError.invalidPairingCode
    }
    func upload(credential: String, installations: [Skill]) async throws -> SkillSyncResult { throw DeviceSyncAPIError.invalidResponse }
    func revoke(credential: String) async throws {}
}

private struct ReconnectCancellationSession: DeviceHTTPSession {
    let body: String
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        withUnsafeCurrentTask { $0?.cancel() }
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

private actor MockDeviceHTTPSession: DeviceHTTPSession {
    struct Response: Sendable {
        let statusCode: Int
        let body: String
        var headers: [String: String] = [:]
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
        return (Data(response.body.utf8), httpResponse)
    }

    func requests() -> [URLRequest] {
        recordedRequests
    }
}
