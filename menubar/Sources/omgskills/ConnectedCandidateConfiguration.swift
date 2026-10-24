import CoreFoundation
import Foundation

struct ConnectedCandidateConfiguration: Equatable, Sendable {
    static let enabledKey = CatalogRuntimeProfile.compiled.connectedKeys[0]
    static let connectKey = CatalogRuntimeProfile.compiled.connectedKeys[1]
    static let uploadKey = CatalogRuntimeProfile.compiled.connectedKeys[2]
    static let credentialKey = CatalogRuntimeProfile.compiled.connectedKeys[3]
    static let keys = [enabledKey, connectKey, uploadKey, credentialKey]
    static let connectURL = CatalogRuntimeProfile.compiled.connectURL
    static let uploadURL = CatalogCandidateRuntime.origin.appendingPathComponent("api/portal/sync-upload")
    static let credentialService = CatalogRuntimeProfile.compiled.credentialService

    let connectURL: URL
    let uploadURL: URL
    let keychainService: String
    let callbackScheme: String
    let profile: CatalogRuntimeProfile

    private init(profile: CatalogRuntimeProfile) {
        self.profile = profile
        connectURL = profile.connectURL
        uploadURL = profile.uploadURL
        keychainService = profile.credentialService
        callbackScheme = BrowserPairing.callbackScheme
    }

    static var buildRequested: Bool {
        #if OMGSKILLS_CONNECTED_CANDIDATE || OMGSKILLS_CONNECTED_PRODUCTION
        true
        #else
        false
        #endif
    }

    static var buildAllowed: Bool {
        #if OMGSKILLS_CATALOG_CANDIDATE && (OMGSKILLS_CONNECTED_CANDIDATE || OMGSKILLS_CONNECTED_PRODUCTION) && !OMGSKILLS_SETUP_TEST && !(OMGSKILLS_CONNECTED_CANDIDATE && OMGSKILLS_CONNECTED_PRODUCTION)
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

    static func mode(info: [String: Any], allowed: Bool = buildAllowed, profile: CatalogRuntimeProfile = .compiled) -> Mode {
        let keys = profile.connectedKeys
        let enabledKey = keys[0], connectKey = keys[1], uploadKey = keys[2], credentialKey = keys[3]
        guard buildRequested || profile == .production || keys.contains(where: { info[$0] != nil }) else { return .disabled }
        guard allowed, let enabled = info[enabledKey] as? NSNumber,
              CFGetTypeID(enabled) == CFBooleanGetTypeID(), enabled.boolValue,
              info[connectKey] as? String == profile.connectURL.absoluteString,
              info[uploadKey] as? String == profile.uploadURL.absoluteString,
              info[credentialKey] as? String == profile.credentialService,
              [AppRuntimeConfiguration.connectedInventoryKey, AppRuntimeConfiguration.inventoryReconciliationKey,
               AppRuntimeConfiguration.inventoryAutomationKey, BrowserPairing.connectURLInfoKey,
               "OMGSkillsSyncEndpoint", DeviceCredentialStore.serviceInfoKey].allSatisfy({ info[$0] == nil })
        else { return .invalid }
        return .enabled(.init(profile: profile))
    }
}

#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
extension ConnectedCandidateConfiguration {
    @MainActor
    func makeRuntime(paths: SkillFilesystemPaths, authorizer: any BrowserPairingAuthorizing,
                     coordinator: UpdateInstallCoordinator,
                     credentialStore: (any DeviceCredentialStoring)? = nil,
                     makeReconnectKeyStore: (URL, String) throws -> any DeviceReconnectKeyStoring = {
                         try DeviceReconnectKeyStore(apiOrigin: $0, credentialService: $1)
                     },
                     api: (any DeviceSyncServing)? = nil,
                     automation: ConnectedInventoryRuntime.Automation? = nil,
                     track: @escaping ConnectedAppEvent.Track = { _ in }) throws -> ConnectedInventoryRuntime {
        let reconnectKeyStore = try makeReconnectKeyStore(profile.origin, keychainService)
        let connection = DeviceConnectionModel(
            credentialStore: credentialStore ?? DeviceCredentialStore(service: keychainService),
            reconnectKeyStore: reconnectKeyStore,
            api: api ?? DeviceSyncAPI(uploadEndpoint: uploadURL, reportMode: .reconciliation),
            browserAuthorizer: authorizer, portalConnectURL: connectURL,
            callbackScheme: callbackScheme, updateCoordinator: coordinator,
            inventoryScanner: {
                try await InstalledSkillsScanner.scanForReconciliation(
                    filesystemPaths: paths, pathAnchor: paths.homeDirectory)
            }, inventoryAutomationEnabled: true)
        return ConnectedInventoryRuntime(connection: connection, authorizer: authorizer,
            callbackScheme: callbackScheme, automation: automation, track: track)
    }
}
#endif
