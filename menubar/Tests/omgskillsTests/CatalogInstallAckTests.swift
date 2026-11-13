import Foundation
import Testing
@testable import omgskills

private func credential(expiresAt: Date = .distantFuture) -> StoredDeviceCredential {
    StoredDeviceCredential(credential: "device_secret", connection: DeviceConnectionInfo(
        deviceID: "device-1", accountLabel: "jon@example.com", expiresAt: expiresAt, grantedScopes: Set(DeviceScope.allCases)))
}

private actor AckHTTPSession: DeviceHTTPSession {
    var requests: [URLRequest] = []
    private let failure: URLError?
    private let status: Int
    init(status: Int = 204, failure: URLError? = nil) { self.status = status; self.failure = failure }
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        if let failure { throw failure }
        return (Data(), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

struct CatalogInstallAckTests {
    private let upload = URL(string: "https://omgskills.com/api/portal/sync-upload")!

    private func request(agent: String = "claude") throws -> CatalogInstallRequest {
        try CatalogInstallRequest(url: URL(string: "omgskills://catalog-install?v=1&id=owner%2Frepo%3Aalias&agent=\(agent)")!,
            client: .product)
    }

    @Test(arguments: ["claude", "codex"])
    func postsTheReceivedLinkToTheSameOrigin(_ agent: String) async throws {
        let session = AckHTTPSession()
        let ack = CatalogInstallAck(uploadEndpoint: upload, session: session)
        await ack.fire(try request(agent: agent), credential: credential())?.value
        let sent = await session.requests
        #expect(sent.count == 1)
        let first = try #require(sent.first)
        #expect(first.url?.absoluteString == "https://omgskills.com/api/portal/install-ack")
        #expect(first.httpMethod == "POST")
        #expect(first.value(forHTTPHeaderField: "Authorization") == "Bearer device_secret")
        #expect(first.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(first.timeoutInterval == 10)
        let data = try #require(first.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        #expect(body == ["catalogId": "owner/repo:alias", "agent": agent])
    }

    @Test func usesTheCandidateOrigin() async throws {
        let session = AckHTTPSession()
        let ack = CatalogInstallAck(uploadEndpoint: CatalogRuntimeProfile.candidate.uploadURL, session: session)
        await ack.fire(try request(), credential: credential())?.value
        let url = try #require(await session.requests.first?.url)
        #expect(url == CatalogRuntimeProfile.candidate.origin.appendingPathComponent("api/portal/install-ack"))
    }

    @Test func sendsNothingWhenNotConnected() async throws {
        let session = AckHTTPSession()
        let ack = CatalogInstallAck(uploadEndpoint: upload, session: session)
        #expect(ack.fire(try request(), credential: nil) == nil)
        #expect(ack.fire(try request(), credential: credential(expiresAt: .distantPast)) == nil)
        #expect(await session.requests.isEmpty)
    }

    @Test func refusesAnInsecureOrigin() async throws {
        let session = AckHTTPSession()
        let ack = CatalogInstallAck(uploadEndpoint: URL(string: "http://omgskills.com/api/portal/sync-upload")!,
            session: session, allowLoopbackHTTP: false)
        #expect(ack.fire(try request(), credential: credential()) == nil)
        #expect(await session.requests.isEmpty)
    }

    @Test func ignoresErrorsAndMissingRoutes() async throws {
        for session in [AckHTTPSession(failure: URLError(.timedOut)), AckHTTPSession(status: 404), AckHTTPSession(status: 500)] {
            let ack = CatalogInstallAck(uploadEndpoint: upload, session: session)
            await ack.fire(try request(), credential: credential())?.value
            #expect(await session.requests.count == 1)
        }
    }
}
