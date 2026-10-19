import Foundation
import Testing
@testable import omgskills

struct ConnectedCandidateConfigurationTests {
    static var info: [String: Any] {
        CatalogCandidateRuntimeTests.info.merging([
            ConnectedCandidateConfiguration.enabledKey: true,
            ConnectedCandidateConfiguration.connectKey: ConnectedCandidateConfiguration.connectURL.absoluteString,
            ConnectedCandidateConfiguration.uploadKey: ConnectedCandidateConfiguration.uploadURL.absoluteString,
            ConnectedCandidateConfiguration.credentialKey: ConnectedCandidateConfiguration.credentialService,
        ]) { _, new in new }
    }

    @Test func requiresExplicitConnectedBuildAndCompleteCandidateMetadata() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        guard case .invalid = CatalogCandidateRuntime.mode(info: Self.info, home: home,
            allowed: true, connectedAllowed: false) else { Issue.record("Metadata alone enabled connection"); return }
        let configuration = try Self.configuration(home: home)
        let connected = try #require(configuration.connected)
        #expect(connected.connectURL.absoluteString == CatalogCandidateRuntime.origin.absoluteString + "/app/connect")
        #expect(connected.uploadURL.absoluteString == CatalogCandidateRuntime.origin.absoluteString + "/api/portal/sync-upload")
        #expect(connected.callbackScheme == "omgskills")
        #expect(connected.keychainService != DeviceCredentialStore.defaultService)
        #expect(try FileManager.default.contentsOfDirectory(atPath: home.path).isEmpty)
        for key in Self.info.keys {
            var value = Self.info
            value.removeValue(forKey: key)
            guard case .invalid = CatalogCandidateRuntime.mode(info: value, home: home,
                allowed: true, connectedAllowed: true) else { Issue.record("Accepted missing \(key)"); continue }
        }
        #if OMGSKILLS_CATALOG_CANDIDATE && OMGSKILLS_CONNECTED_CANDIDATE && !OMGSKILLS_SETUP_TEST
        #expect(ConnectedCandidateConfiguration.buildAllowed)
        #else
        #expect(!ConnectedCandidateConfiguration.buildAllowed)
        #endif
        if ConnectedCandidateConfiguration.buildRequested {
            #expect(ConnectedCandidateConfiguration.mode(info: [:], allowed: false) == .invalid)
        } else {
            #expect(ConnectedCandidateConfiguration.mode(info: [:], allowed: false) == .disabled)
        }
    }

    @Test func oldCandidateAndPublicDefaultsStayDisconnected() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        // With no connected build request, the old candidate needs no new metadata.
        if !ConnectedCandidateConfiguration.buildRequested {
            let old = try CatalogCandidateRuntimeTests.configuration(home: home)
            #expect(old.connected == nil)
            #expect(ConnectedCandidateConfiguration.mode(info: [:], allowed: true) == .disabled)
        }
        guard case .invalid = CatalogCandidateRuntime.mode(info: Self.info, home: home,
            allowed: false, connectedAllowed: true) else { Issue.record("Connected flag bypassed candidate identity"); return }
        #expect(AppRuntimeConfiguration.connectedInventoryMode(info: Self.info) == .disabled)
    }

    @Test func rejectsRedirectedEndpointsCredentialsAndMixedTestModes() throws {
        let home = try CatalogCandidateRuntimeTests.home()
        defer { try? FileManager.default.removeItem(at: home) }
        var changes: [[String: Any]] = [
            [ConnectedCandidateConfiguration.enabledKey: 1],
            [ConnectedCandidateConfiguration.enabledKey: false],
            [ConnectedCandidateConfiguration.credentialKey: DeviceCredentialStore.defaultService],
            [ConnectedCandidateConfiguration.credentialKey: "com.jonslimak.omgskills.inventory-test.old"],
            [BrowserPairing.connectURLInfoKey: ConnectedCandidateConfiguration.connectURL.absoluteString],
            ["OMGSkillsSyncEndpoint": ConnectedCandidateConfiguration.uploadURL.absoluteString],
            [DeviceCredentialStore.serviceInfoKey: ConnectedCandidateConfiguration.credentialService],
            [AppRuntimeConfiguration.connectedInventoryKey: false],
            [AppRuntimeConfiguration.inventoryReconciliationKey: true],
            [AppRuntimeConfiguration.inventoryAutomationKey: true],
        ]
        for key in [ConnectedCandidateConfiguration.connectKey, ConnectedCandidateConfiguration.uploadKey] {
            let expected = Self.info[key] as! String
            changes += ["https://omgskills.com/app/connect", "http://127.0.0.1:5203/app/connect",
                expected + "?redirect=1", expected + "#fragment", expected.replacingOccurrences(of: "https:", with: "http:"),
                expected.replacingOccurrences(of: "https://", with: "https://user@")].map { [key: $0] }
        }
        for change in changes {
            guard case .invalid = CatalogCandidateRuntime.mode(info: Self.info.merging(change) { _, new in new },
                home: home, allowed: true, connectedAllowed: true) else {
                Issue.record("Accepted mixed candidate settings: \(change.keys)"); continue
            }
        }
    }

    @Test func startupReplaysColdURLsAndRoutesPairingBeforeInstallsWithoutDiscovery() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/omgskills")
        let app = try String(contentsOf: root.appendingPathComponent("omgskillsApp.swift"), encoding: .utf8)
        let begin = try #require(app.range(of: "switch catalogCandidateMode"))
        let end = try #require(app.range(of: "switch catalogInstallMode"))
        let startup = app[begin.lowerBound..<end.lowerBound]
        #expect(startup.contains("pendingConnectedURLs.forEach(controller.receive)"))
        #expect(startup.contains("pendingConnectedURLs.removeAll()"))
        #expect(!startup.contains("SkillsStore.shared"))
        let controller = try String(contentsOf: root.appendingPathComponent("CatalogInstallView.swift"), encoding: .utf8)
        let receive = try #require(controller.range(of: "func receive(_ url: URL)"))
        let stop = try #require(controller.range(of: "func stopReporting()"))
        let routing = String(controller[receive.lowerBound..<stop.lowerBound])
        let pair = try #require(routing.range(of: "connectedRuntime?.receivePairingCallback(url)"))
        let install = try #require(routing.range(of: "model.receive(url)"))
        #expect(pair.lowerBound < install.lowerBound)
        #expect(!routing.contains("#if DEBUG"))
        #expect(controller.contains("connected.makeRuntime(paths: candidate.paths"))
        #expect(controller.contains("runtime.observeInstalls(in: model)"))
    }

    static func configuration(home: URL) throws -> CatalogCandidateRuntime.Configuration {
        let mode = CatalogCandidateRuntime.mode(info: info, home: home, allowed: true, connectedAllowed: true)
        guard case .enabled(let configuration) = mode else { throw InvalidConfiguration() }
        return configuration
    }

    private struct InvalidConfiguration: Error {}
}
