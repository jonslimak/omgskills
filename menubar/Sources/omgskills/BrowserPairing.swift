import CryptoKit
import Foundation
import Security

struct BrowserPairingRequest: Equatable, Sendable {
    let state: String
    let codeVerifier: String
    let codeChallenge: String
}

enum BrowserPairingCallback: Equatable, Sendable {
    case approved(pairingCode: String)
    case cancelled
}

enum BrowserPairingError: LocalizedError, Equatable, Sendable {
    case invalidConfiguration
    case invalidCallback
    case stateMismatch
    case unavailable

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "Browser pairing is not configured correctly."
        case .invalidCallback:
            return "The portal returned an invalid connection response."
        case .stateMismatch:
            return "The portal connection response did not match this attempt."
        case .unavailable:
            return "The browser connection could not be started."
        }
    }
}

protocol BrowserPairingRequestGenerating: Sendable {
    func makeRequest() throws -> BrowserPairingRequest
}

struct SystemBrowserPairingRequestGenerator: BrowserPairingRequestGenerating {
    func makeRequest() throws -> BrowserPairingRequest {
        let state = try randomBase64URL(byteCount: 32)
        let verifier = try randomBase64URL(byteCount: 32)
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return BrowserPairingRequest(
            state: state,
            codeVerifier: verifier,
            codeChallenge: Data(digest).base64URLEncodedString()
        )
    }

    private func randomBase64URL(byteCount: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else {
            throw BrowserPairingError.unavailable
        }
        return Data(bytes).base64URLEncodedString()
    }
}

enum BrowserPairing {
    static let callbackScheme = "omgskills"
    static let defaultConnectURL = URL(string: "https://app.omgskills.com/connect")!
    static let connectURLInfoKey = "OMGSkillsPortalConnectURL"

    static func configuredConnectURL(bundle: Bundle = .main) -> URL {
        guard
            let value = bundle.object(forInfoDictionaryKey: connectURLInfoKey) as? String,
            let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
            url.scheme == "https",
            url.host != nil
        else {
            return defaultConnectURL
        }
        return url
    }

    static func authorizationURL(
        connectURL: URL,
        request: BrowserPairingRequest
    ) throws -> URL {
        guard connectURL.scheme == "https", connectURL.host != nil else {
            throw BrowserPairingError.invalidConfiguration
        }
        var components = URLComponents(url: connectURL, resolvingAgainstBaseURL: false)
        components?.fragment = URLComponents(queryItems: [
            URLQueryItem(name: "state", value: request.state),
            URLQueryItem(name: "code_challenge", value: request.codeChallenge)
        ]).percentEncodedQuery
        guard let url = components?.url else {
            throw BrowserPairingError.invalidConfiguration
        }
        return url
    }

    static func parseCallback(
        _ url: URL,
        expectedState: String
    ) throws -> BrowserPairingCallback {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == callbackScheme,
            components.host?.lowercased() == "pair",
            components.path.isEmpty,
            components.fragment == nil,
            components.user == nil,
            components.password == nil,
            components.port == nil
        else {
            throw BrowserPairingError.invalidCallback
        }

        let items = components.queryItems ?? []
        let allowedNames = Set(["code", "state", "error"])
        guard items.allSatisfy({ allowedNames.contains($0.name) }) else {
            throw BrowserPairingError.invalidCallback
        }
        let states = items.filter { $0.name == "state" }.compactMap(\.value)
        guard states.count == 1 else {
            throw BrowserPairingError.invalidCallback
        }
        guard states[0] == expectedState else {
            throw BrowserPairingError.stateMismatch
        }

        let codes = items.filter { $0.name == "code" }.compactMap(\.value)
        let errors = items.filter { $0.name == "error" }.compactMap(\.value)
        if errors == ["access_denied"], codes.isEmpty {
            return .cancelled
        }
        guard errors.isEmpty, codes.count == 1, isPairingCode(codes[0]) else {
            throw BrowserPairingError.invalidCallback
        }
        return .approved(pairingCode: codes[0])
    }

    private static func isPairingCode(_ value: String) -> Bool {
        guard value.hasPrefix("pair_") else { return false }
        let secret = value.dropFirst("pair_".count)
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
        return secret.count == 43 && secret.unicodeScalars.allSatisfy(allowed.contains)
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private extension URLComponents {
    init(queryItems: [URLQueryItem]) {
        self.init()
        self.queryItems = queryItems
    }
}
