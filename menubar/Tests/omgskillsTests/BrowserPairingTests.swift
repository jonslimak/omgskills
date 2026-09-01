import Foundation
import Testing
@testable import omgskills

struct BrowserPairingTests {
    private let request = BrowserPairingRequest(
        state: String(repeating: "s", count: 43),
        codeVerifier: String(repeating: "v", count: 43),
        codeChallenge: String(repeating: "c", count: 43),
        scopes: DeviceScope.allCases
    )

    @Test func defaultConnectURLUsesPortalAPIOrigin() {
        #expect(BrowserPairing.defaultConnectURL.absoluteString == "https://omgskills.com/app/connect")
    }

    @Test func systemRequestUsesPKCECompatibleValues() throws {
        let request = try SystemBrowserPairingRequestGenerator().makeRequest()

        #expect(request.state.count == 43)
        #expect(request.codeVerifier.count == 43)
        #expect(request.codeChallenge.count == 43)
        #expect(request.state != request.codeVerifier)
        #expect(request.codeChallenge != request.codeVerifier)
        #expect(request.scopes == DeviceScope.allCases)
    }

    @Test func authorizationURLKeepsSecretsOutOfQuery() throws {
        let url = try BrowserPairing.authorizationURL(
            connectURL: BrowserPairing.defaultConnectURL,
            request: request
        )
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let fragment = try #require(components.fragment)
        let fragmentItems = URLComponents(string: "?\(fragment)")?.queryItems

        #expect(components.query == nil)
        #expect(fragmentItems?.first(where: { $0.name == "state" })?.value == request.state)
        #expect(fragmentItems?.first(where: { $0.name == "code_challenge" })?.value == request.codeChallenge)
        #expect(fragmentItems?.filter { $0.name == "scope" }.compactMap(\.value) == [
            "sync:write", "self:revoke", "content:read"
        ])
        #expect(url.absoluteString.contains(request.codeVerifier) == false)
    }

    @Test func parsesApprovedAndCancelledCallbacks() throws {
        let pairingCode = "pair_\(String(repeating: "a", count: 43))"

        #expect(try BrowserPairing.parseCallback(
            URL(string: "omgskills://pair?code=\(pairingCode)&state=\(request.state)")!,
            expectedState: request.state
        ) == .approved(pairingCode: pairingCode))
        #expect(try BrowserPairing.parseCallback(
            URL(string: "omgskills://pair?error=access_denied&state=\(request.state)")!,
            expectedState: request.state
        ) == .cancelled)
    }

    @Test func rejectsMismatchedStateAndMalformedCallbacks() {
        let pairingCode = "pair_\(String(repeating: "a", count: 43))"

        #expect(throws: BrowserPairingError.stateMismatch) {
            try BrowserPairing.parseCallback(
                URL(string: "omgskills://pair?code=\(pairingCode)&state=wrong")!,
                expectedState: request.state
            )
        }
        #expect(throws: BrowserPairingError.invalidCallback) {
            try BrowserPairing.parseCallback(
                URL(string: "omgskills://pair?code=\(pairingCode)&state=\(request.state)&state=duplicate")!,
                expectedState: request.state
            )
        }
        #expect(throws: BrowserPairingError.invalidCallback) {
            try BrowserPairing.parseCallback(
                URL(string: "https://evil.example/pair?code=\(pairingCode)&state=\(request.state)")!,
                expectedState: request.state
            )
        }
    }
}
