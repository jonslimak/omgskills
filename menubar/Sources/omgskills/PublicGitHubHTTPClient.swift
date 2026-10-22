import Foundation

enum PublicGitHubHTTPError: LocalizedError, Equatable {
    case invalidMetadata, tooLarge, unavailable, redirect
    case rateLimited(retryAfterSeconds: Int?)
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .invalidMetadata: "The GitHub package information could not be verified."
        case .tooLarge: "The GitHub response exceeds the download limit."
        case .unavailable: "The GitHub repository, version, or file is unavailable."
        case .redirect: "The GitHub download redirected unexpectedly and was refused."
        case .rateLimited: "GitHub is limiting requests. Try again later."
        case .http(let code): "The GitHub download failed (HTTP \(code))."
        }
    }
}

protocol PublicGitHubHTTPClient: Sendable {
    func data(for request: URLRequest, limit: Int) async throws -> Data
}

// Public, credential-free downloads only. Redirects cannot change the source or host.
struct BoundedPublicGitHubHTTPClient: PublicGitHubHTTPClient {
    func data(for request: URLRequest, limit: Int) async throws -> Data {
        try Self.validate(request, limit: limit)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 45
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration, delegate: GitHubRejectRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            try Task.checkCancellation()
            let (bytes, response) = try await session.bytes(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw PublicGitHubHTTPError.invalidMetadata
            }
            try Self.check(response, limit: limit)
            return try await Self.collect(bytes, limit: limit)
        } catch {
            try Task.checkCancellation()
            throw error
        }
    }

    static func validate(_ request: URLRequest, limit: Int) throws {
        guard limit >= 0, let url = request.url, url.scheme == "https",
              ["api.github.com", "raw.githubusercontent.com"].contains(url.host),
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              request.httpMethod == "GET", request.httpBody == nil,
              request.value(forHTTPHeaderField: "Authorization") == nil,
              request.value(forHTTPHeaderField: "Cookie") == nil else {
            throw PublicGitHubHTTPError.invalidMetadata
        }
    }

    static func check(_ response: HTTPURLResponse, limit: Int) throws {
        let code = response.statusCode
        if (300..<400).contains(code) { throw PublicGitHubHTTPError.redirect }
        if code == 404 || code == 410 { throw PublicGitHubHTTPError.unavailable }
        if code == 429 || (code == 403 && (
            response.value(forHTTPHeaderField: "X-RateLimit-Remaining") == "0"
            || response.value(forHTTPHeaderField: "Retry-After") != nil
        )) {
            let retry = response.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init)
            throw PublicGitHubHTTPError.rateLimited(retryAfterSeconds: retry.flatMap { $0 >= 0 ? $0 : nil })
        }
        guard code == 200 else { throw PublicGitHubHTTPError.http(code) }
        guard limit >= 0, response.expectedContentLength <= limit else { throw PublicGitHubHTTPError.tooLarge }
    }

    static func collect<S: AsyncSequence>(_ bytes: S, limit: Int) async throws -> Data where S.Element == UInt8 {
        var result = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard result.count < limit else { throw PublicGitHubHTTPError.tooLarge }
            result.append(byte)
        }
        try Task.checkCancellation()
        return result
    }
}

private final class GitHubRejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
