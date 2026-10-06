import Foundation

enum PreviewFailure: LocalizedError, Equatable {
    case unpinned, invalidMetadata, invalidPackage, tooLarge, unavailable, redirect
    case rateLimited(String?), http(Int)

    var errorDescription: String? {
        switch self {
        case .unpinned: "This catalog skill has no pinned version. Nothing was downloaded."
        case .invalidMetadata: "The published version information could not be verified."
        case .invalidPackage: "The complete package could not be verified against its pinned version."
        case .tooLarge: "This package exceeds the preview size or file limit."
        case .unavailable: "The pinned repository, version, or file is unavailable."
        case .redirect: "The download redirected unexpectedly and was refused."
        case .rateLimited(let retry): "GitHub is limiting requests. Try again later."
            + (retry.map { " Retry after: \($0)." } ?? "")
        case .http(let code): "The download failed (HTTP \(code))."
        }
    }
}

protocol PublicHTTPClient: Sendable {
    func data(for request: URLRequest, limit: Int) async throws -> Data
}

final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

struct BoundedPublicHTTP: PublicHTTPClient {
    func data(for request: URLRequest, limit: Int) async throws -> Data {
        guard let url = request.url,
              url.scheme == "https", ["omgskills.com", "api.github.com"].contains(url.host),
              url.user == nil, url.password == nil, url.port == nil else {
            throw PreviewFailure.invalidMetadata
        }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 45
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        let session = URLSession(configuration: config, delegate: RejectRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        try Task.checkCancellation()
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw PreviewFailure.invalidMetadata }
        try Self.check(http, limit: limit)
        return try await Self.collect(bytes, limit: limit)
    }

    static func collect<S: AsyncSequence>(_ bytes: S, limit: Int) async throws -> Data where S.Element == UInt8 {
        var result = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard result.count < limit else { throw PreviewFailure.tooLarge }
            result.append(byte)
        }
        try Task.checkCancellation()
        return result
    }

    static func check(_ response: HTTPURLResponse, limit: Int) throws {
        let code = response.statusCode
        if (300..<400).contains(code) { throw PreviewFailure.redirect }
        if code == 404 || code == 410 { throw PreviewFailure.unavailable }
        if code == 429 || (code == 403 && (
            response.value(forHTTPHeaderField: "X-RateLimit-Remaining") == "0"
            || response.value(forHTTPHeaderField: "Retry-After") != nil
        )) {
            let retry = response.value(forHTTPHeaderField: "Retry-After")
                .flatMap(Int.init).map { "\($0) seconds" }
            throw PreviewFailure.rateLimited(retry)
        }
        guard code == 200 else { throw PreviewFailure.http(code) }
        guard response.expectedContentLength <= limit else { throw PreviewFailure.tooLarge }
    }
}
