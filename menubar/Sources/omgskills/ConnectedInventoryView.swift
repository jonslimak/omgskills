#if DEBUG
import SwiftUI

@MainActor
struct ConnectedInventoryView: View {
    let model: DeviceConnectionModel
    let deviceName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch model.state {
            case .connected(let info):
                Text(info.accountLabel).font(.headline).textSelection(.enabled)
                Text(Self.reportMessage(model.reportStatus)).font(.callout).textSelection(.enabled)
                HStack {
                    Button("Resync", systemImage: "arrow.clockwise") { model.requestInventoryReport() }
                        .disabled(model.reportStatus == .reporting)
                    Button("Disconnect", systemImage: "person.crop.circle.badge.minus") { model.disconnect() }
                }
            case .authorizing, .exchanging, .storingCredential, .syncing:
                HStack {
                    ProgressView().controlSize(.small)
                    Text("Connecting...")
                    Spacer()
                    Button("Cancel") { model.cancelCurrentOperation() }
                }
            case .disconnected, .failed:
                if case .failed(let failure) = model.state {
                    Text(Self.connectionMessage(failure)).font(.callout).foregroundStyle(.red)
                }
                Button("Connect account", systemImage: "person.crop.circle.badge.plus") {
                    model.connectWithBrowser(deviceName: deviceName, installations: [], replacingExisting: true)
                }
            }
            if let warning = model.disconnectWarning {
                Text(warning).font(.caption).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    static func reportMessage(_ status: DeviceConnectionModel.ReportStatus) -> String {
        switch status {
        case .idle: return "Connected. Inventory has not been reported yet."
        case .pending: return "Inventory report pending."
        case .reporting: return "Reporting installed skills..."
        case .failed(let message): return "Inventory needs attention. " + message
        case .uncertain(let message): return "Report outcome uncertain. " + message + " Resync to check with a fresh scan."
        case .reported(let result, let issues):
            if result.reportVersion == 3 {
                guard result.complete == true else { return "Partial inventory reported. Some folders were not fully checked. Resync to retry." }
                let date = result.reportedAt?.formatted(date: .abbreviated, time: .shortened) ?? "unknown time"
                return "\(result.syncedSkillCount) installations seen; \(result.missingSkillCount ?? 0) newly not found at \(date)."
            }
            if issues > 0 { return "Partial inventory reported. \(issues) scan issues need attention. Resync to retry." }
            let date = result.reportedAt?.formatted(date: .abbreviated, time: .shortened) ?? "unknown time"
            return "\(result.syncedSkillCount) installations reported at \(date)."
        }
    }

    private static func connectionMessage(_ failure: DeviceConnectionFailure) -> String {
        switch failure {
        case .reconnectRequired: return "Reconnect this Mac to report inventory."
        case .replacementRequired: return "An account is already connected. Reconnect to replace it."
        case .credentialStorage: return "The account credential could not be stored or read."
        case .authorization(let message), .exchange(let message), .sync(let message): return message
        }
    }
}

// Lifecycle/routing only; the existing connection model owns reporting and credentials.
@MainActor
final class ConnectedInventoryRuntime {
    let connection: DeviceConnectionModel
    private let authorizer: any BrowserPairingAuthorizing
    private var startup: Task<Void, Never>?

    init(connection: DeviceConnectionModel, authorizer: any BrowserPairingAuthorizing) {
        self.connection = connection
        self.authorizer = authorizer
    }

    @discardableResult
    func start() -> Task<Void, Never> {
        if let startup { return startup }
        let task = connection.restore()
        startup = task
        return task
    }

    func receivePairingCallback(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == BrowserPairing.connectedTestCallbackScheme,
              url.host?.lowercased() == "pair" else { return false }
        // Even a stale cold-launch callback must never be interpreted as an install.
        _ = authorizer.handleCallback(url)
        return true
    }

    func installed() { connection.requestInventoryReport() }
    func stop() async {
        await connection.cancelAndAwaitCurrentOperation()
        await startup?.value
    }
}
#endif
