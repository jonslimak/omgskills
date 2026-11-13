import AppKit
import Foundation

@MainActor
protocol BrowserPairingAuthorizing: AnyObject {
    func authorize(url: URL, callbackScheme: String) async throws -> URL
    func cancel()
    func handleCallback(_ url: URL) -> Bool
}

/// Opens the connect page in the user's default browser and waits for the website's
/// `<scheme>://pair?state=...` hand-back, which arrives through the app's URL handling.
/// One attempt is pending at a time; a callback is accepted once, only for the in-flight
/// state and scheme, and only before the attempt times out or is cancelled. The pairing
/// code is useless without this attempt's PKCE verifier, which never leaves the app.
@MainActor
final class BrowserPairingSession: BrowserPairingAuthorizing {
    typealias OpenURL = @MainActor (URL) -> Bool
    typealias Sleep = @Sendable (Duration) async throws -> Void

    static let defaultTimeout: Duration = .seconds(600)

    private let openURL: OpenURL
    private let timeout: Duration
    private let sleep: Sleep
    private let onReturn: @MainActor () -> Void
    private var continuation: CheckedContinuation<URL, Error>?
    private var activeCallbackScheme: String?
    private var activeAttemptID: UUID?
    private var expectedState: String?
    private var timeoutTask: Task<Void, Never>?

    init(
        openURL: @escaping OpenURL = { NSWorkspace.shared.open($0) },
        timeout: Duration = BrowserPairingSession.defaultTimeout,
        sleep: @escaping Sleep = { try await Task.sleep(for: $0) },
        onReturn: @escaping @MainActor () -> Void
    ) {
        self.openURL = openURL
        self.timeout = timeout
        self.sleep = sleep
        self.onReturn = onReturn
    }

    var isPending: Bool { continuation != nil }

    func authorize(url: URL, callbackScheme: String) async throws -> URL {
        guard continuation == nil, ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              let state = Self.state(in: url) else {
            throw BrowserPairingError.unavailable
        }
        let attemptID = UUID()

        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                self.activeCallbackScheme = callbackScheme
                self.activeAttemptID = attemptID
                self.expectedState = state
                self.timeoutTask = Task { @MainActor [weak self, sleep, timeout] in
                    do { try await sleep(timeout) } catch { return }
                    guard let self, self.activeAttemptID == attemptID else { return }
                    self.finish(with: .failure(BrowserPairingError.timedOut), reopenPanel: false)
                }
                if !openURL(url) {
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
        guard continuation != nil else { return }
        finish(with: .failure(CancellationError()), reopenPanel: false)
    }

    func handleCallback(_ url: URL) -> Bool {
        guard continuation != nil,
              let activeCallbackScheme, let expectedState,
              (try? BrowserPairing.parseCallback(url, expectedState: expectedState,
                callbackScheme: activeCallbackScheme)) != nil else { return false }
        finish(with: .success(url), reopenPanel: true)
        return true
    }

    private static func state(in url: URL) -> String? {
        let states = URLComponents(string: "?" + (url.fragment ?? ""))?.queryItems?
            .filter { $0.name == "state" }.compactMap(\.value) ?? []
        guard states.count == 1, !states[0].isEmpty else { return nil }
        return states[0]
    }

    private func finish(with result: Result<URL, Error>, reopenPanel: Bool) {
        guard let continuation else { return }
        self.continuation = nil
        activeCallbackScheme = nil
        activeAttemptID = nil
        expectedState = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        if reopenPanel {
            onReturn()
        }
        continuation.resume(with: result)
    }
}
