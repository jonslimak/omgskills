import Foundation
import Testing
@testable import omgskills

@MainActor
struct BrowserPairingSessionTests {
    private static let code = "pair_" + String(repeating: "c", count: 43)
    private static let connectURL = URL(string:
        "https://omgskills.com/app/connect?inventory=3#state=s1&code_challenge=challenge&scope=inventory:write")!

    private final class Browser {
        var opened: [URL] = []
        var succeeds = true
        var returns = 0
    }

    private func makeSession(_ browser: Browser, timeout: Duration = .seconds(600),
                             sleep: BrowserPairingSession.Sleep? = nil) -> BrowserPairingSession {
        BrowserPairingSession(openURL: { browser.opened.append($0); return browser.succeeds }, timeout: timeout,
            sleep: sleep ?? { try await Task.sleep(for: $0) }, onReturn: { browser.returns += 1 })
    }

    private func start(_ session: BrowserPairingSession, browser: Browser,
                       scheme: String = BrowserPairing.callbackScheme) async -> Task<Result<URL, Error>, Never> {
        let task = Task { @MainActor in
            do { return Result<URL, Error>.success(try await session.authorize(url: Self.connectURL, callbackScheme: scheme)) }
            catch { return .failure(error) }
        }
        while browser.opened.isEmpty && !task.isCancelled { await Task.yield() }
        return task
    }

    @Test func connectOpensTheConnectPageInTheDefaultBrowser() async {
        let browser = Browser()
        let session = makeSession(browser)
        let task = await start(session, browser: browser)
        #expect(browser.opened == [Self.connectURL])
        #expect(session.isPending)
        session.cancel()
        _ = await task.value
        let source = try? String(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/omgskills/BrowserPairingSession.swift"), encoding: .utf8)
        #expect(source?.contains("NSWorkspace.shared.open") == true)
        #expect(source?.contains("ASWebAuthenticationSession") == false)
    }

    @Test func matchingPairLinkIsAcceptedExactlyOnce() async throws {
        let browser = Browser()
        let session = makeSession(browser)
        let task = await start(session, browser: browser)
        let callback = URL(string: "omgskills://pair?state=s1&code=\(Self.code)")!
        #expect(session.handleCallback(callback))
        #expect(try await task.value.get() == callback)
        #expect(browser.returns == 1)
        #expect(!session.handleCallback(callback))
        #expect(!session.isPending)
    }

    @Test func websiteCancelLinkCompletesTheAttempt() async throws {
        let browser = Browser()
        let session = makeSession(browser)
        let task = await start(session, browser: browser)
        let callback = URL(string: "omgskills://pair?error=access_denied&state=s1")!
        #expect(session.handleCallback(callback))
        #expect(try await task.value.get() == callback)
    }

    @Test func wrongStateSchemeOrShapeIsRejectedAndTheAttemptKeepsWaiting() async throws {
        let browser = Browser()
        let session = makeSession(browser)
        let task = await start(session, browser: browser)
        for bad in ["omgskills://pair?state=other&code=\(Self.code)",
                    "omgskills-f1://pair?state=s1&code=\(Self.code)",
                    "omgskills-setup-test://pair?state=s1&code=\(Self.code)",
                    "omgskills://pair?state=s1&code=pair_short",
                    "omgskills://pair?state=s1&state=s1&code=\(Self.code)",
                    "omgskills://pair/extra?state=s1&code=\(Self.code)",
                    "omgskills://catalog-install?state=s1&code=\(Self.code)"] {
            #expect(!session.handleCallback(URL(string: bad)!), "\(bad)")
        }
        #expect(session.isPending)
        #expect(browser.returns == 0)
        let good = URL(string: "omgskills://pair?state=s1&code=\(Self.code)")!
        #expect(session.handleCallback(good))
        #expect(try await task.value.get() == good)
    }

    @Test func connectedTestSchemeWorksTheSameWay() async throws {
        let browser = Browser()
        let session = makeSession(browser)
        let task = await start(session, browser: browser, scheme: BrowserPairing.connectedTestCallbackScheme)
        #expect(!session.handleCallback(URL(string: "omgskills://pair?state=s1&code=\(Self.code)")!))
        let good = URL(string: "omgskills-f1://pair?state=s1&code=\(Self.code)")!
        #expect(session.handleCallback(good))
        #expect(try await task.value.get() == good)
    }

    @Test func pairLinkWithoutAPendingAttemptIsRejected() {
        let browser = Browser()
        let session = makeSession(browser)
        #expect(!session.handleCallback(URL(string: "omgskills://pair?state=s1&code=\(Self.code)")!))
        #expect(browser.opened.isEmpty)
        #expect(browser.returns == 0)
    }

    @Test func expiredAttemptRejectsALatePairLink() async {
        let browser = Browser()
        let session = makeSession(browser, timeout: .seconds(600), sleep: { _ in })
        let task = await start(session, browser: browser)
        let result = await task.value
        guard case .failure(let error) = result else { Issue.record("expected timeout"); return }
        #expect(error as? BrowserPairingError == .timedOut)
        #expect(!session.handleCallback(URL(string: "omgskills://pair?state=s1&code=\(Self.code)")!))
        #expect(browser.returns == 0)
    }

    @Test func cancelEndsTheAttemptAndALatePairLinkIsRejected() async {
        let browser = Browser()
        let session = makeSession(browser)
        let task = await start(session, browser: browser)
        session.cancel()
        guard case .failure(let error) = await task.value else { Issue.record("expected cancellation"); return }
        #expect(error is CancellationError)
        #expect(!session.handleCallback(URL(string: "omgskills://pair?state=s1&code=\(Self.code)")!))
    }

    @Test func taskCancellationEndsTheAttempt() async {
        let browser = Browser()
        let session = makeSession(browser)
        let task = await start(session, browser: browser)
        task.cancel()
        guard case .failure(let error) = await task.value else { Issue.record("expected cancellation"); return }
        #expect(error is CancellationError)
        #expect(!session.isPending)
    }

    @Test func onlyOneAttemptAtATimeAndBrowserFailureIsReported() async throws {
        let browser = Browser()
        let session = makeSession(browser)
        let first = await start(session, browser: browser)
        await #expect(throws: BrowserPairingError.unavailable) {
            _ = try await session.authorize(url: Self.connectURL, callbackScheme: BrowserPairing.callbackScheme)
        }
        #expect(browser.opened.count == 1)
        session.cancel()
        _ = await first.value

        browser.succeeds = false
        browser.opened = []
        let failed = await start(session, browser: browser)
        guard case .failure(let error) = await failed.value else { Issue.record("expected failure"); return }
        #expect(error as? BrowserPairingError == .unavailable)
        #expect(!session.isPending)
    }

    @Test func connectPageWithoutAStateIsRefused() async {
        let browser = Browser()
        let session = makeSession(browser)
        await #expect(throws: BrowserPairingError.unavailable) {
            _ = try await session.authorize(url: URL(string: "https://omgskills.com/app/connect#code_challenge=x")!,
                callbackScheme: BrowserPairing.callbackScheme)
        }
        #expect(browser.opened.isEmpty)
    }
}
