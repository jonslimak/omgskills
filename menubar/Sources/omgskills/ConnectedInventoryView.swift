#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI
import AppKit

@MainActor
struct ConnectedInventoryView: View {
    let model: DeviceConnectionModel
    let deviceName: String
    var runtime: ConnectedInventoryRuntime? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch model.state {
            case .connected:
                if let count = Self.reportedCount(model.reportStatus) {
                    Text("\(count) Skills").font(.body)
                }
                if let attention = Self.reportAttention(model.reportStatus) {
                    Text(attention).font(.callout).textSelection(.enabled)
                }
                if let checked = model.lastInventoryCheckedAt {
                    Text("Last " + checked.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption).foregroundStyle(.tertiary).padding(.top, 8)
                }
                if let warning = runtime?.watchWarning { Text(warning).font(.caption).foregroundStyle(.secondary) }
                HStack(spacing: 8) { inventoryActions }.buttonStyle(.bordered)
            case .authorizing, .exchanging, .storingCredential, .syncing:
                HStack {
                    ProgressView().controlSize(.small)
                    Text("Connecting...")
                    Spacer()
                    Button("Cancel") {
                        if let runtime { runtime.cancel() } else { model.cancelCurrentOperation() }
                    }
                }
            case .disconnected, .failed:
                if case .failed(let failure) = model.state {
                    Text(Self.connectionMessage(failure)).font(.callout).foregroundStyle(.red)
                }
                Button("Connect account", systemImage: "person.crop.circle.badge.plus") {
                    if let runtime { runtime.connect(deviceName: deviceName) }
                    else { model.connectWithBrowser(deviceName: deviceName, installations: [], replacingExisting: true) }
                }
            }
            if let warning = model.continuityWarning {
                Text(warning).font(.caption).foregroundStyle(.secondary)
            }
            if let warning = model.disconnectWarning {
                Text(warning).font(.caption).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var inventoryActions: some View {
        Button {
            if let runtime { runtime.resync() } else { model.requestInventoryReport() }
        } label: { Text("Resync").frame(maxWidth: .infinity) }
        .disabled(model.reportStatus == .reporting)
        Button {
            if let runtime { runtime.disconnect() } else { model.disconnect() }
        } label: { Text("Disconnect").frame(maxWidth: .infinity) }
    }

    static func reportedCount(_ status: DeviceConnectionModel.ReportStatus) -> Int? {
        guard case .reported(let result, _) = status else { return nil }
        return result.syncedSkillCount
    }

    static func reportAttention(_ status: DeviceConnectionModel.ReportStatus) -> String? {
        if case .reported(let result, let issues) = status {
            if issues > 0 { return "Partial inventory reported. \(issues) scan issues need attention. Resync to retry." }
            if result.reportVersion == 3 && result.complete != true { return reportMessage(status) }
            if let missing = result.missingSkillCount, missing > 0 { return "\(missing) newly not found on last scan." }
            return nil
        }
        return reportMessage(status)
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

#endif
