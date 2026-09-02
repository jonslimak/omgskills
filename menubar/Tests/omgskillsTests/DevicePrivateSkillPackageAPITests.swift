import Foundation
import Testing
@testable import omgskills

struct DevicePrivateSkillPackageAPITests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func fetchesAndValidatesPrivatePackage() async throws {
        let body = try GroupSkillPackageTestSupport.ndjson()
        let session = PrivatePackageHTTPSession(responses: [
            .init(
                statusCode: 200,
                headers: [
                    "Content-Type": "application/x-ndjson; charset=utf-8",
                    "Content-Length": String(body.count)
                ],
                body: body
            )
        ])
        let api = makeAPI(session: session)

        let package = try await api.fetchPackage(
            sourceID: GroupSkillPackageTestSupport.sourceID,
            release: GroupSkillPackageTestSupport.release(),
            credential: GroupSkillPackageTestSupport.credential()
        )
        let request = try #require(await session.requests().first)

        #expect(package == GroupSkillPackageTestSupport.package)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://example.com/api/portal/private-releases/\(GroupSkillPackageTestSupport.releaseID)/package")
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/x-ndjson")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer device-secret")
    }

    @Test func rejectsExpiredAndInsufficientCredentialBeforeNetwork() async throws {
        let session = PrivatePackageHTTPSession(responses: [])
        let api = makeAPI(session: session)
        let release = try GroupSkillPackageTestSupport.release()

        await #expect(throws: GroupSkillPackageLoaderError.reconnectRequired) {
            try await api.fetchPackage(
                sourceID: GroupSkillPackageTestSupport.sourceID,
                release: release,
                credential: GroupSkillPackageTestSupport.credential(
                    expiresAt: now.addingTimeInterval(-1)
                )
            )
        }
        await #expect(throws: GroupSkillPackageLoaderError.contentReadRequired) {
            try await api.fetchPackage(
                sourceID: GroupSkillPackageTestSupport.sourceID,
                release: release,
                credential: GroupSkillPackageTestSupport.credential(scopes: DeviceScope.metadataOnly)
            )
        }
        #expect(await session.requests().isEmpty)
    }

    @Test func rejectsInvalidOpaqueIdentifiersBeforeNetwork() async throws {
        let session = PrivatePackageHTTPSession(responses: [])
        let api = makeAPI(session: session)

        await #expect(throws: GroupSkillPackageLoaderError.invalidResponse) {
            try await api.fetchPackage(
                sourceID: "../source",
                release: GroupSkillPackageTestSupport.release(),
                credential: GroupSkillPackageTestSupport.credential()
            )
        }
        await #expect(throws: GroupSkillPackageLoaderError.invalidResponse) {
            try await api.fetchPackage(
                sourceID: GroupSkillPackageTestSupport.sourceID,
                release: GroupSkillPackageTestSupport.release(id: "../release"),
                credential: GroupSkillPackageTestSupport.credential()
            )
        }
        #expect(await session.requests().isEmpty)
    }

    @Test func mapsStatusCodesWithoutDiscardingValidCredentials() async throws {
        let fixtures: [(Int, [String: String]?, GroupSkillPackageLoaderError)] = [
            (401, nil, .reconnectRequired),
            (404, nil, .packageUnavailable),
            (429, ["Retry-After": "60"], .rateLimited(retryAfter: "60")),
            (503, ["Retry-After": "300"], .temporarilyUnavailable(retryAfter: "300")),
            (500, nil, .server(statusCode: 500))
        ]
        let release = try GroupSkillPackageTestSupport.release()

        for (statusCode, headers, expected) in fixtures {
            let session = PrivatePackageHTTPSession(responses: [
                .init(statusCode: statusCode, headers: headers, body: Data("{}".utf8))
            ])
            await #expect(throws: expected) {
                try await makeAPI(session: session).fetchPackage(
                    sourceID: GroupSkillPackageTestSupport.sourceID,
                    release: release,
                    credential: GroupSkillPackageTestSupport.credential()
                )
            }
        }
    }

    @Test func rejectsWrongContentTypeAndOversizedResponses() async throws {
        let body = try GroupSkillPackageTestSupport.ndjson()
        let release = try GroupSkillPackageTestSupport.release()
        let wrongType = PrivatePackageHTTPSession(responses: [
            .init(statusCode: 200, headers: ["Content-Type": "application/json"], body: body)
        ])
        await #expect(throws: GroupSkillPackageLoaderError.invalidResponse) {
            try await makeAPI(session: wrongType).fetchPackage(
                sourceID: GroupSkillPackageTestSupport.sourceID,
                release: release,
                credential: GroupSkillPackageTestSupport.credential()
            )
        }

        let oversizedHeader = PrivatePackageHTTPSession(responses: [
            .init(
                statusCode: 200,
                headers: [
                    "Content-Type": "application/x-ndjson",
                    "Content-Length": String(DevicePrivateSkillPackageAPI.maximumResponseBytes + 1)
                ],
                body: body
            )
        ])
        await #expect(throws: GroupSkillPackageLoaderError.responseTooLarge) {
            try await makeAPI(session: oversizedHeader).fetchPackage(
                sourceID: GroupSkillPackageTestSupport.sourceID,
                release: release,
                credential: GroupSkillPackageTestSupport.credential()
            )
        }
    }

    @Test func rejectsMalformedEnvelopeIdentityAndBase64() async throws {
        let release = try GroupSkillPackageTestSupport.release()
        var fixtures: [Data] = []
        fixtures.append(try GroupSkillPackageTestSupport.ndjson(
            sourceID: "33333333-3333-3333-3333-333333333333"
        ))
        fixtures.append(try GroupSkillPackageTestSupport.ndjson(
            releaseID: "44444444-4444-4444-4444-444444444444"
        ))

        let mismatchedCoordinates = SkillPackage(
            coordinates: SkillPackageCoordinates(
                commitSha: String(repeating: "2", count: 40),
                treeSha: GroupSkillPackageTestSupport.treeSha,
                skillMdSha: GroupSkillPackageTestSupport.skillMdSha
            ),
            entries: GroupSkillPackageTestSupport.package.entries
        )
        fixtures.append(try GroupSkillPackageTestSupport.ndjson(package: mismatchedCoordinates))

        var missingEnd = try GroupSkillPackageTestSupport.ndjson()
        let lastLineStart = missingEnd.dropLast().lastIndex(of: 10)!
        missingEnd.removeSubrange(missingEnd.index(after: lastLineStart)..<missingEnd.endIndex)
        fixtures.append(missingEnd)

        let valid = String(data: try GroupSkillPackageTestSupport.ndjson(), encoding: .utf8)!
        fixtures.append(Data(valid.replacingOccurrences(
            of: GroupSkillPackageTestSupport.package.entries[0].data.base64EncodedString(),
            with: "%%%"
        ).utf8))

        for body in fixtures {
            let session = PrivatePackageHTTPSession(responses: [
                .init(
                    statusCode: 200,
                    headers: ["Content-Type": "application/x-ndjson"],
                    body: body
                )
            ])
            await #expect(throws: GroupSkillPackageLoaderError.invalidResponse) {
                try await makeAPI(session: session).fetchPackage(
                    sourceID: GroupSkillPackageTestSupport.sourceID,
                    release: release,
                    credential: GroupSkillPackageTestSupport.credential()
                )
            }
        }
    }

    @Test func rejectsPackageThatFailsBlobValidation() async throws {
        var entries = GroupSkillPackageTestSupport.package.entries
        let original = entries[0]
        entries[0] = SkillPackageEntry(
            path: original.path,
            mode: original.mode,
            data: Data("changed".utf8),
            blobSha: original.blobSha
        )
        let invalid = SkillPackage(
            coordinates: GroupSkillPackageTestSupport.coordinates,
            entries: entries
        )
        let session = PrivatePackageHTTPSession(responses: [
            .init(
                statusCode: 200,
                headers: ["Content-Type": "application/x-ndjson"],
                body: try GroupSkillPackageTestSupport.ndjson(package: invalid)
            )
        ])

        await #expect(throws: SkillPackageValidationError.self) {
            try await makeAPI(session: session).fetchPackage(
                sourceID: GroupSkillPackageTestSupport.sourceID,
                release: GroupSkillPackageTestSupport.release(),
                credential: GroupSkillPackageTestSupport.credential()
            )
        }
    }

    @Test func preservesCancellation() async throws {
        let session = GatedPrivatePackageHTTPSession(
            body: try GroupSkillPackageTestSupport.ndjson()
        )
        let api = makeAPI(session: session)
        let release = try GroupSkillPackageTestSupport.release()
        let task = Task {
            try await api.fetchPackage(
                sourceID: GroupSkillPackageTestSupport.sourceID,
                release: release,
                credential: GroupSkillPackageTestSupport.credential()
            )
        }
        await session.waitUntilRequested()
        task.cancel()
        await session.release()

        await #expect(throws: CancellationError.self) {
            try await task.value
        }
    }

    private func makeAPI(session: any DeviceHTTPSession) -> DevicePrivateSkillPackageAPI {
        DevicePrivateSkillPackageAPI(
            uploadEndpoint: URL(string: "https://example.com/api/portal/sync-upload")!,
            session: session,
            now: { now }
        )
    }
}

private actor PrivatePackageHTTPSession: DeviceHTTPSession {
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
        guard !responses.isEmpty else { throw URLError(.badServerResponse) }
        let response = responses.removeFirst()
        return (
            response.body,
            HTTPURLResponse(
                url: request.url!,
                statusCode: response.statusCode,
                httpVersion: nil,
                headerFields: response.headers
            )!
        )
    }

    func requests() -> [URLRequest] {
        recordedRequests
    }
}

private actor GatedPrivatePackageHTTPSession: DeviceHTTPSession {
    private let body: Data
    private var requested = false
    private var requestWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    init(body: Data) {
        self.body = body
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requested = true
        let waiters = requestWaiters
        requestWaiters.removeAll()
        waiters.forEach { $0.resume() }
        await withCheckedContinuation { continuation in
            releaseContinuation = continuation
        }
        return (
            body,
            HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/x-ndjson"]
            )!
        )
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
