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

        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let session = ASWebAuthenticationSession(
                    url: url,
                    callbackURLScheme: callbackScheme,
                    completionHandler: Self.makeCompletionHandler(for: self)
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
        guard session != nil || continuation != nil else { return false }
        finish(with: .success(url), reopenPanel: true)
        return true
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchorProvider() ?? ASPresentationAnchor()
    }

    private func complete(callbackURL: URL?, error: Error?) {
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
        for owner: WebAuthenticationSession
    ) -> @Sendable (URL?, Error?) -> Void {
        { [weak owner] callbackURL, error in
            Task { @MainActor [weak owner] in
                owner?.complete(callbackURL: callbackURL, error: error)
            }
        }
    }

    private func finish(
        with result: Result<URL, Error>,
        reopenPanel: Bool
    ) {
        guard let continuation else { return }
        self.continuation = nil
        session = nil
        if reopenPanel {
            onReturn()
        }
        continuation.resume(with: result)
    }
}
