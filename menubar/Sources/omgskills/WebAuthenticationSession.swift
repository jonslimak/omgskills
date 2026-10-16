import AppKit
import AuthenticationServices
import Foundation

@MainActor
protocol BrowserPairingAuthorizing: AnyObject {
    func authorize(url: URL, callbackScheme: String) async throws -> URL
    func cancel()
    func handleCallback(_ url: URL) -> Bool
}

@MainActor
final class WebAuthenticationSession: NSObject, BrowserPairingAuthorizing,
    ASWebAuthenticationPresentationContextProviding {
    private let anchorProvider: @MainActor () -> ASPresentationAnchor?
    private let onReturn: @MainActor () -> Void
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, Error>?
    private var activeCallbackScheme: String?
    private var activeAttemptID: UUID?
    private var expectedState: String?

    init(
        anchorProvider: @escaping @MainActor () -> ASPresentationAnchor?,
        onReturn: @escaping @MainActor () -> Void
    ) {
        self.anchorProvider = anchorProvider
        self.onReturn = onReturn
    }

    func authorize(url: URL, callbackScheme: String) async throws -> URL {
        guard session == nil, continuation == nil, anchorProvider() != nil else {
            throw BrowserPairingError.unavailable
        }
        let attemptID = UUID()

        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                self.activeCallbackScheme = callbackScheme
                self.activeAttemptID = attemptID
                self.expectedState = URLComponents(string: "?" + (url.fragment ?? ""))?.queryItems?
                    .first(where: { $0.name == "state" })?.value
                let session = ASWebAuthenticationSession(
                    url: url,
                    callbackURLScheme: callbackScheme,
                    completionHandler: Self.makeCompletionHandler(for: self, attemptID: attemptID)
                )
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false
                self.session = session
                if !session.start() {
                    finish(with: .failure(BrowserPairingError.unavailable), reopenPanel: false)
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                guard self?.activeAttemptID == attemptID else { return }
                self?.cancel()
            }
        }
    }

    func cancel() {
        guard session != nil || continuation != nil else { return }
        session?.cancel()
        finish(with: .failure(CancellationError()), reopenPanel: false)
    }

    func handleCallback(_ url: URL) -> Bool {
        guard session != nil || continuation != nil,
              let activeCallbackScheme, let expectedState,
              (try? BrowserPairing.parseCallback(url, expectedState: expectedState,
                callbackScheme: activeCallbackScheme)) != nil else { return false }
        finish(with: .success(url), reopenPanel: true)
        return true
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchorProvider() ?? ASPresentationAnchor()
    }

    private func complete(callbackURL: URL?, error: Error?, attemptID: UUID) {
        guard activeAttemptID == attemptID else { return }
        if let callbackURL {
            finish(with: .success(callbackURL), reopenPanel: true)
        } else if let sessionError = error as? ASWebAuthenticationSessionError,
                  sessionError.code == .canceledLogin {
            finish(with: .failure(CancellationError()), reopenPanel: true)
        } else {
            finish(
                with: .failure(error ?? BrowserPairingError.invalidCallback),
                reopenPanel: true
            )
        }
    }

    private nonisolated static func makeCompletionHandler(
        for owner: WebAuthenticationSession,
        attemptID: UUID
    ) -> @Sendable (URL?, Error?) -> Void {
        { [weak owner] callbackURL, error in
            Task { @MainActor [weak owner] in
                owner?.complete(callbackURL: callbackURL, error: error, attemptID: attemptID)
            }
        }
    }

    private func finish(
        with result: Result<URL, Error>,
        reopenPanel: Bool
    ) {
        guard let continuation else { return }
        self.continuation = nil
        activeCallbackScheme = nil
        activeAttemptID = nil
        expectedState = nil
        session = nil
        if reopenPanel {
            onReturn()
        }
        continuation.resume(with: result)
    }
}
