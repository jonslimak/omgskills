import CoreFoundation
import Foundation

struct ConnectedCandidateConfiguration: Equatable, Sendable {
    static let enabledKey = "OMGSkillsConnectedCandidate"
    static let connectKey = "OMGSkillsConnectedCandidateConnectURL"
    static let uploadKey = "OMGSkillsConnectedCandidateUploadURL"
    static let credentialKey = "OMGSkillsConnectedCandidateCredentialService"
    static let keys = [enabledKey, connectKey, uploadKey, credentialKey]
    static let connectURL = CatalogCandidateRuntime.origin.appendingPathComponent("app/connect")
    static let uploadURL = CatalogCandidateRuntime.origin.appendingPathComponent("api/portal/sync-upload")
    static let credentialService = "com.jonslimak.omgskills.catalog-candidate.inventory"

    let connectURL: URL
    let uploadURL: URL
    let keychainService: String
    let callbackScheme: String

    private init() {
        connectURL = Self.connectURL
        uploadURL = Self.uploadURL
        keychainService = Self.credentialService
        callbackScheme = BrowserPairing.callbackScheme
    }

    static var buildRequested: Bool {
        #if OMGSKILLS_CONNECTED_CANDIDATE
        true
        #else
        false
        #endif
    }

    static var buildAllowed: Bool {
        #if OMGSKILLS_CATALOG_CANDIDATE && OMGSKILLS_CONNECTED_CANDIDATE && !OMGSKILLS_SETUP_TEST
        true
        #else
        false
        #endif
    }

    enum Mode: Equatable, Sendable {
        case disabled
        case enabled(ConnectedCandidateConfiguration)
        case invalid
    }

    static func mode(info: [String: Any], allowed: Bool = buildAllowed) -> Mode {
        guard buildRequested || keys.contains(where: { info[$0] != nil }) else { return .disabled }
        guard allowed, let enabled = info[enabledKey] as? NSNumber,
              CFGetTypeID(enabled) == CFBooleanGetTypeID(), enabled.boolValue,
              info[connectKey] as? String == connectURL.absoluteString,
              info[uploadKey] as? String == uploadURL.absoluteString,
              info[credentialKey] as? String == credentialService,
              [AppRuntimeConfiguration.connectedInventoryKey, AppRuntimeConfiguration.inventoryReconciliationKey,
               AppRuntimeConfiguration.inventoryAutomationKey, BrowserPairing.connectURLInfoKey,
               "OMGSkillsSyncEndpoint", DeviceCredentialStore.serviceInfoKey].allSatisfy({ info[$0] == nil })
        else { return .invalid }
        return .enabled(.init())
    }
}

#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
extension ConnectedCandidateConfiguration {
    @MainActor
    func makeRuntime(paths: SkillFilesystemPaths, authorizer: any BrowserPairingAuthorizing,
                     coordinator: UpdateInstallCoordinator,
                     credentialStore: (any DeviceCredentialStoring)? = nil,
                     api: (any DeviceSyncServing)? = nil,
                     automation: ConnectedInventoryRuntime.Automation? = nil) -> ConnectedInventoryRuntime {
        let connection = DeviceConnectionModel(
            credentialStore: credentialStore ?? DeviceCredentialStore(service: keychainService),
            api: api ?? DeviceSyncAPI(uploadEndpoint: uploadURL, reportMode: .reconciliation),
            browserAuthorizer: authorizer, portalConnectURL: connectURL,
            callbackScheme: callbackScheme, updateCoordinator: coordinator,
            inventoryScanner: {
                try await InstalledSkillsScanner.scanForReconciliation(
                    filesystemPaths: paths, pathAnchor: paths.homeDirectory)
            }, inventoryAutomationEnabled: true)
        return ConnectedInventoryRuntime(connection: connection, authorizer: authorizer,
            callbackScheme: callbackScheme, automation: automation)
    }
}
#endif
