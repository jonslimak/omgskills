#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import Foundation

enum ConnectedAppEvent: Equatable, Sendable {
    typealias Track = @MainActor (Self) -> Void

    enum InstallOutcome: String, CaseIterable, Sendable {
        case requested, approved, installed, cancelled, conflict, unavailable, failed
        case alreadyInstalled = "already_installed"
        case needsGit = "needs_git"
    }

    enum ConnectionAction: String, CaseIterable, Sendable { case restore, connect, disconnect }
    enum ConnectionOutcome: String, CaseIterable, Sendable {
        case connected, disconnected
        case disconnectedWithWarning = "disconnected_with_warning"
        case authorizationFailed = "authorization_failed"
        case exchangeFailed = "exchange_failed"
        case credentialStorageFailed = "credential_storage_failed"
        case syncFailed = "sync_failed"
        case replacementRequired = "replacement_required"
        case reconnectRequired = "reconnect_required"
    }

    enum InventoryOutcome: String, CaseIterable, Sendable {
        case reported, partial, retryable
        case revisionConflict = "revision_conflict"
        case needsAttention = "needs_attention"
        case reconnectRequired = "reconnect_required"
    }

    case install(InstallOutcome, agent: SkillInstaller.Target?)
    case connection(ConnectionAction, ConnectionOutcome)
    case inventory(InventoryOutcome)
    case setupFailed
    case watcherUnavailable

    var signalName: String {
        switch self {
        case .install: return "connected.install"
        case .connection: return "connected.connection"
        case .inventory: return "connected.inventory"
        case .setupFailed: return "connected.setup_failed"
        case .watcherUnavailable: return "connected.watcher_unavailable"
        }
    }

    var parameters: [String: String] {
        var values = Analytics.appVersionParameters()
        switch self {
        case .install(let outcome, let agent):
            values["outcome"] = outcome.rawValue
            values["agent"] = agent?.rawValue.lowercased() ?? "unknown"
        case .connection(let action, let outcome):
            values["action"] = action.rawValue
            values["outcome"] = outcome.rawValue
        case .inventory(let outcome): values["outcome"] = outcome.rawValue
        case .setupFailed, .watcherUnavailable: break
        }
        return values
    }

    static func installResult(_ result: CatalogInstallService.Result, agent: SkillInstaller.Target?) -> Self {
        let outcome: InstallOutcome
        switch result {
        case .installed: outcome = .installed
        case .alreadyInstalled: outcome = .alreadyInstalled
        case .conflict: outcome = .conflict
        case .needsGit: outcome = .needsGit
        case .unavailable: outcome = .unavailable
        case .failed: outcome = .failed
        }
        return .install(outcome, agent: agent)
    }

    static func connectionResult(_ state: DeviceConnectionModel.State, action: ConnectionAction,
                                 hasWarning: Bool) -> Self? {
        let outcome: ConnectionOutcome
        switch state {
        case .connected: outcome = .connected
        case .disconnected: outcome = hasWarning ? .disconnectedWithWarning : .disconnected
        case .failed(let failure):
            switch failure {
            case .authorization: outcome = .authorizationFailed
            case .exchange: outcome = .exchangeFailed
            case .credentialStorage: outcome = .credentialStorageFailed
            case .sync: outcome = .syncFailed
            case .replacementRequired: outcome = .replacementRequired
            case .reconnectRequired: outcome = .reconnectRequired
            }
        default: return nil
        }
        return .connection(action, outcome)
    }

    static func inventoryResult(_ result: InventoryReportOutcome) -> Self? {
        switch result {
        case .reported(let partial): return .inventory(partial ? .partial : .reported)
        case .retryable: return .inventory(.retryable)
        case .revisionConflict: return .inventory(.revisionConflict)
        case .needsAttention: return .inventory(.needsAttention)
        case .reconnectRequired: return .inventory(.reconnectRequired)
        // Unchanged checks and cancelled/stale operations are not new reports.
        case .checked, .cancelled: return nil
        }
    }
}
#endif
