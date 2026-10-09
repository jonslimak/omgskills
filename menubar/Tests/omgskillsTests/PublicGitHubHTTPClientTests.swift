import Foundation
import Testing
@testable import omgskills

struct PublicGitHubHTTPClientTests {
    @Test(arguments: ["http://api.github.com/repos/a/b", "https://example.com/file",
                      "https://api.github.com.evil.test/file", "https://user:secret@api.github.com/file",
                      "https://api.github.com:8443/file", "https://raw.githubusercontent.com/file#fragment"])
    func refusesOtherOriginsBeforeConnecting(url: String) async throws {
        await #expect(throws: PublicGitHubHTTPError.invalidMetadata) {
            try await BoundedPublicGitHubHTTPClient().data(for: URLRequest(url: URL(string: url)!), limit: 10)
        }
    }

    @Test(arguments: ["Authorization", "Cookie", "POST"])
    func refusesCredentialsAndWrites(kind: String) throws {
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/a/b")!)
        if kind == "POST" { request.httpMethod = kind }
        else { request.setValue("secret", forHTTPHeaderField: kind) }
        #expect(throws: PublicGitHubHTTPError.invalidMetadata) {
            try BoundedPublicGitHubHTTPClient.validate(request, limit: 10)
        }
    }

    @Test(arguments: [301, 302, 307, 308, 404, 410, 429, 500])
    func classifiesHTTPFailuresWithoutRetries(code: Int) throws {
        let response = try #require(HTTPURLResponse(url: URL(string: "https://api.github.com/repos/a/b")!,
            statusCode: code, httpVersion: nil, headerFields: ["Retry-After": "60"]))
        let expected: PublicGitHubHTTPError = (300..<400).contains(code) ? .redirect :
            [404, 410].contains(code) ? .unavailable : code == 429 ? .rateLimited(retryAfterSeconds: 60) : .http(code)
        #expect(throws: expected) { try BoundedPublicGitHubHTTPClient.check(response, limit: 10) }
    }

    @Test(arguments: ["0", "1"])
    func handlesBothPrimaryAndSecondaryRateLimits(remaining: String) throws {
        let response = try #require(HTTPURLResponse(url: URL(string: "https://api.github.com/repos/a/b")!,
            statusCode: 403, httpVersion: nil, headerFields: ["X-RateLimit-Remaining": remaining, "Retry-After": "-1"]))
        #expect(throws: PublicGitHubHTTPError.rateLimited(retryAfterSeconds: nil)) {
            try BoundedPublicGitHubHTTPClient.check(response, limit: 10)
        }
    }

    @Test func boundsResponsesWithAndWithoutContentLength() async throws {
        let url = URL(string: "https://raw.githubusercontent.com/a/b/sha/file")!
        let oversized = try #require(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Length": "5"]))
        #expect(throws: PublicGitHubHTTPError.tooLarge) { try BoundedPublicGitHubHTTPClient.check(oversized, limit: 4) }
        let unknown = try #require(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: [:]))
        try BoundedPublicGitHubHTTPClient.check(unknown, limit: 4)
        func bytes(_ count: Int) -> AsyncStream<UInt8> {
            AsyncStream { continuation in
                for value in 0..<count { continuation.yield(UInt8(value)) }
                continuation.finish()
            }
        }
        #expect(try await BoundedPublicGitHubHTTPClient.collect(bytes(4), limit: 4) == Data([0, 1, 2, 3]))
        #expect(try await BoundedPublicGitHubHTTPClient.collect(bytes(0), limit: 0) == Data())
        await #expect(throws: PublicGitHubHTTPError.tooLarge) {
            try await BoundedPublicGitHubHTTPClient.collect(bytes(5), limit: 4)
        }
    }

    @Test func cancellationStopsStreamingWithoutReturningPartialBytes() async throws {
        let started = AsyncStream<Void>.makeStream()
        let bytes = AsyncStream<UInt8>.makeStream()
        defer { started.continuation.finish(); bytes.continuation.finish() }
        let task = Task {
            started.continuation.yield(())
            return try await BoundedPublicGitHubHTTPClient.collect(bytes.stream, limit: 4)
        }
        var events = started.stream.makeAsyncIterator()
        _ = await events.next()
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
    }
}
