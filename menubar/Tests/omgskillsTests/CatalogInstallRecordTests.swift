import Foundation
import os
import Testing
@testable import omgskills

struct CatalogInstallRecordTests {
    @Test(arguments: ["claude", "codex"])
    func requestContainsOnlyIdentityAndAgent(_ agent: String) throws {
        let request = try CatalogInstallRequest(url: URL(string: "omgskills-f1://catalog-install?v=1&id=owner%2Frepo%3Aalias&agent=\(agent)")!, client: .f1)
        #expect(request.catalogID == "owner/repo:alias")
        #expect(request.target == (agent == "claude" ? .claude : .codex))
    }

    @Test(arguments: [
        "omgskills://catalog-install?v=1&id=x&agent=codex",
        "omgskills-f1://review?v=1&id=x&agent=codex",
        "omgskills-f1://catalog-install?v=2&id=x&agent=codex",
        "omgskills-f1://catalog-install?v=1&id=x&agent=agents",
        "omgskills-f1://catalog-install?v=1&id=x&agent=codex&repo=evil",
        "omgskills-f1://catalog-install?v=1&id=x&id=y&agent=codex",
        "omgskills-f1://catalog-install?v=1&id=x&agent=codex#",
        "omgskills-f1://user@catalog-install?v=1&id=x&agent=codex",
        "omgskills-f1://catalog-install:80?v=1&id=x&agent=codex",
        "omgskills-f1://catalog-install/extra?v=1&id=x&agent=codex",
        "omgskills-f1://catalog-install?v=1&id=%00&agent=codex",
        "omgskills-f1://catalog-install?v=1&id=%E2%80%8B&agent=codex",
        "omgskills-f1://catalog-install?v=1&id=\(String(repeating: "x", count: 501))&agent=codex"
    ])
    func unsafeRequestsAreRefused(_ link: String) {
        #expect(throws: CatalogInstallRequest.RequestError.self) {
            try CatalogInstallRequest(url: URL(string: link)!, client: .f1)
        }
    }

    @Test func rawFieldsPreserveLegacyAliasesAndIncompletePins() throws {
        let legacy = try decodeRecord()
        #expect(legacy.skill.pinnedInstallMetadataState == .legacy)
        #expect(legacy.skill.skillMdPath == nil)
        #expect(try SkillInstaller.installationSpec(for: legacy.skill).targetName == "old-alias")
        let partial = try decodeRecord(extra: ",\"repo_commit_sha\":\"broken\"")
        #expect(partial.commitSHA == "broken")
        #expect(partial.skill.pinnedInstallMetadataState == .invalid)
        let complete = try decodeRecord(extra: """
        ,"repo_slug":"owner/repo","skill_md_path":"skills/design/SKILL.md",
        "repo_commit_sha":"\(String(repeating: "1", count: 40))","skill_tree_sha":"\(String(repeating: "2", count: 40))",
        "skill_md_sha":"\(String(repeating: "3", count: 40))","install_target_name":"old-alias"
        """)
        guard case .complete(let metadata) = complete.skill.pinnedInstallMetadataState else {
            Issue.record("Complete pins must not be downgraded"); return
        }
        #expect(metadata.targetName == "old-alias")
        #expect(metadata.packageRoot == "skills/design")
        #expect(!legacy.hasSameInstallation(as: complete))
        #expect(legacy.hasSameInstallation(as: legacy))
    }

    @Test func fixedOriginAndBoundedClientDecodeOneRecord() async throws {
        let client = CatalogInstallRecordClient(session: session())
        let record = try #require(await client.fetch(id: "owner/repo:alias"))
        #expect(record.skill.pinnedInstallMetadataState == .legacy)
        #expect(record.targetName == nil)
        #expect(try await client.fetch(id: "missing") == nil)
    }

    @Test(arguments: ["bad-version", "wrong-id", "wrong-found", "malformed"])
    func malformedResponsesAreRefused(_ id: String) async throws {
        let client = CatalogInstallRecordClient(session: session())
        await #expect(throws: CatalogInstallRecordClient.ClientError.invalidResponse) { try await client.fetch(id: id) }
    }

    @Test(arguments: ["large", "large-header"])
    func responsesAreBounded(_ id: String) async throws {
        let client = CatalogInstallRecordClient(session: session())
        await #expect(throws: CatalogInstallRecordClient.ClientError.responseTooLarge) { try await client.fetch(id: id) }
    }

    @Test func unavailableAndCancellationStayFailures() async throws {
        let client = CatalogInstallRecordClient(session: session())
        await #expect(throws: CatalogInstallRecordClient.ClientError.unavailable) { try await client.fetch(id: "offline") }
        let task = Task { () throws -> CatalogInstallRecord? in
            withUnsafeCurrentTask { $0?.cancel() }
            return try await client.fetch(id: "owner/repo:alias")
        }
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test(arguments: ["once-timeout", "once-disconnect", "once-503"])
    func temporaryLookupFailureRetriesOnce(_ scenario: String) async throws {
        let id = "\(scenario):\(UUID().uuidString)"
        let waits = OSAllocatedUnfairLock(initialState: 0)
        let client = CatalogInstallRecordClient(session: session(), waitBeforeRetry: {
            waits.withLock { $0 += 1 }
        })
        #expect(try await client.fetch(id: id)?.id == id)
        #expect(CatalogRecordURLProtocol.attempts(for: id) == 2)
        #expect(waits.withLock { $0 } == 1)
    }

    @Test(arguments: ["always-timeout", "always-503"])
    func repeatedFailuresStopAfterTwoRequests(_ scenario: String) async throws {
        let id = "\(scenario):\(UUID().uuidString)"
        let client = CatalogInstallRecordClient(session: session(), waitBeforeRetry: {})
        do {
            _ = try await client.fetch(id: id)
            Issue.record("Expected exhausted lookup to fail")
        } catch {
            if scenario == "always-timeout" {
                #expect((error as? URLError)?.code == .timedOut)
            } else {
                #expect(error as? CatalogInstallRecordClient.ClientError == .unavailable)
            }
        }
        #expect(CatalogRecordURLProtocol.attempts(for: id) == 2)
    }

    @Test(arguments: ["terminal-401", "terminal-403", "terminal-404", "terminal-429",
                      "terminal-redirect", "terminal-tls", "terminal-cancel",
                      "terminal-malformed", "terminal-large", "terminal-wrong-id"])
    func nonTemporaryFailuresNeverRetry(_ scenario: String) async throws {
        let id = "\(scenario):\(UUID().uuidString)"
        let client = CatalogInstallRecordClient(session: session(), waitBeforeRetry: {
            Issue.record("Must not retry a permanent failure or cancellation")
        })
        do {
            _ = try await client.fetch(id: id)
            Issue.record("Expected lookup failure")
        } catch {
            if scenario == "terminal-cancel" { #expect(error is CancellationError) }
        }
        #expect(CatalogRecordURLProtocol.attempts(for: id) == 1)
    }

    @Test func cancellationDuringRetryDelayStopsWithoutAnotherRequest() async throws {
        let id = "once-timeout:\(UUID().uuidString)"
        let task = Task {
            let client = CatalogInstallRecordClient(session: session(), waitBeforeRetry: {
                withUnsafeCurrentTask { $0?.cancel() }
                try Task.checkCancellation()
            })
            return try await client.fetch(id: id)
        }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(CatalogRecordURLProtocol.attempts(for: id) == 1)
    }

    #if DEBUG
    @Test func testOriginMustBeExplicitLoopback() throws {
        _ = try CatalogInstallRecordClient(localOrigin: URL(string: "http://127.0.0.1:5197")!)
        for origin in ["https://evil.test", "http://localhost", "http://u@localhost:5197", "http://localhost:5197/path"] {
            #expect(throws: CatalogInstallRecordClient.ClientError.invalidOrigin) {
                try CatalogInstallRecordClient(localOrigin: URL(string: origin)!)
            }
        }
    }
    #endif

    private func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CatalogRecordURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

private func recordJSON(id: String = "owner/repo:alias", extra: String = "") -> String {
    """
    {"id":"\(id)","name":"alias","description":"Skill","author_handle":"owner",
    "github_url":"https://github.com/owner/repo",
    "install_cmd":"ln -s /tmp/repo/skills/design ~/.claude/skills/old-alias"\(extra)}
    """
}
private func decodeRecord(extra: String = "") throws -> CatalogInstallRecord {
    try JSONDecoder().decode(CatalogInstallRecord.self, from: Data(recordJSON(extra: extra).utf8))
}

private final class CatalogRecordURLProtocol: URLProtocol, @unchecked Sendable {
    private static let requestCounts = OSAllocatedUnfairLock(initialState: [String: Int]())
    static func attempts(for id: String) -> Int { requestCounts.withLock { $0[id, default: 0] } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let id = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.first!.value!
        let attempt = Self.requestCounts.withLock { counts in
            counts[id, default: 0] += 1
            return counts[id]!
        }
        #expect(request.url!.host == "omgskills.com")
        #expect(request.url!.path == "/api/catalog/install-record")
        #expect(request.timeoutInterval == 20)
        #expect(!request.httpShouldHandleCookies)
        var body = "{\"version\":1,\"found\":true,\"skill\":\(recordJSON())}"
        let scenario = String(id.split(separator: ":").first!)
        var status = id == "offline" ? 503 : 200
        if ["once-timeout", "once-disconnect", "always-timeout"].contains(scenario),
           attempt == 1 || scenario == "always-timeout" {
            client?.urlProtocol(self, didFailWithError: URLError(scenario == "once-disconnect" ? .networkConnectionLost : .timedOut))
            return
        }
        if scenario == "terminal-cancel" || scenario == "terminal-tls" {
            client?.urlProtocol(self, didFailWithError: URLError(scenario == "terminal-cancel" ? .cancelled : .serverCertificateUntrusted))
            return
        }
        if scenario.hasPrefix("once-") || scenario.hasPrefix("always-") || scenario.hasPrefix("terminal-") {
            body = "{\"version\":1,\"found\":true,\"skill\":\(recordJSON(id: id))}"
            if scenario == "always-503" || (scenario == "once-503" && attempt == 1) { status = 503 }
            if scenario.hasPrefix("terminal-"), let code = Int(scenario.dropFirst("terminal-".count)) { status = code }
            if scenario == "terminal-redirect" { status = 302 }
            if scenario == "terminal-malformed" { body = "{" }
            if scenario == "terminal-wrong-id" { body = "{\"version\":1,\"found\":true,\"skill\":\(recordJSON())}" }
            if scenario == "terminal-large" { body = String(repeating: "x", count: CatalogInstallRecordClient.maximumResponseBytes + 1) }
        }
        switch id {
        case "missing": body = "{\"version\":1,\"found\":false,\"skill\":null}"
        case "bad-version": body = "{\"version\":2,\"found\":false,\"skill\":null}"
        case "wrong-found": body = "{\"version\":1,\"found\":true,\"skill\":null}"
        case "malformed": body = "{"
        case "large", "large-header": body = String(repeating: "x", count: CatalogInstallRecordClient.maximumResponseBytes + 1)
        default: break
        }
        let headers = id == "large-header" ? ["Content-Length": "\(body.utf8.count)"] : [:]
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
