#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI
import AppKit

@MainActor
struct ConnectedInventoryView: View {
    let model: DeviceConnectionModel
    let deviceName: String
    var runtime: ConnectedInventoryRuntime? = nil
    /// The panel shows Connect account on its top row, next to the app menu.
    var connectInHeader = false

    /// Signed out or failed: the one thing to do is connect.
    static func needsConnect(_ model: DeviceConnectionModel) -> Bool {
        switch model.state { case .disconnected, .failed: return true; default: return false }
    }

    /// While the connect page is open in the browser, say where the user has to act.
    static func progressText(_ state: DeviceConnectionModel.State) -> String {
        state == .authorizing ? "Waiting for approval in your browser..." : "Connecting..."
    }

    static func connectButton(model: DeviceConnectionModel, deviceName: String, runtime: ConnectedInventoryRuntime?) -> some View {
        Button("Connect account", systemImage: "person.crop.circle.badge.plus") {
            if let runtime { runtime.connect(deviceName: deviceName) }
            else { model.connectWithBrowser(deviceName: deviceName, installations: [], replacingExisting: true) }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch model.state {
            case .connected:
                // Sync runs in the background: the panel shows the count, and a message only when something needs a look.
                // The sync switch, Resync and Disconnect live in Options.
                let status = Self.shownStatus(model)
                if let count = Self.reportedCount(status) {
                    let here = model.skillCount ?? count
                    let cloud = runtime?.cloudSave.flatMap { $0.isAvailable ? $0.shownSummary : nil }
                    Text(Self.headerText(here: here, summary: cloud)).font(.body)
                    Text(Self.lineText(here: here, summary: cloud)).font(.caption).foregroundStyle(.secondary)
                }
                if let attention = Self.reportAttention(status) {
                    Text(attention).font(.callout).textSelection(.enabled)
                    if Self.attentionOffersResync(status) {
                        Button("Resync") { resync() }.controlSize(.small)
                    }
                }
                if let warning = runtime?.watchWarning { Text(warning).font(.caption).foregroundStyle(.secondary) }
                if let cloudSave = runtime?.cloudSave, cloudSave.isAvailable {
                    // While the header is hidden (reporting, or a failed report), this says how sync is doing.
                    CloudSaveAttention(controller: cloudSave, showsStatus: Self.reportedCount(status) == nil,
                                       reconnect: { runtime?.connect(deviceName: deviceName) })
                }
            case .authorizing, .exchanging, .storingCredential, .syncing:
                HStack {
                    ProgressView().controlSize(.small)
                    Text(Self.progressText(model.state))
                    Spacer()
                    Button("Cancel") {
                        if let runtime { runtime.cancel() } else { model.cancelCurrentOperation() }
                    }
                }
            case .disconnected, .failed:
                if case .failed(let failure) = model.state {
                    Text(Self.connectionMessage(failure)).font(.callout).foregroundStyle(.red)
                }
                if !connectInHeader { Self.connectButton(model: model, deviceName: deviceName, runtime: runtime) }
                Text("Share skills across teams & agents.").font(.caption).foregroundStyle(.secondary)
            }
            if let warning = model.continuityWarning {
                Text(warning).font(.caption).foregroundStyle(.secondary)
            }
            if let warning = model.disconnectWarning {
                Text(warning).font(.caption).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func resync() {
        if let runtime { runtime.resync() } else { model.requestInventoryReport() }
    }

    /// Sync on the main panel: status while the count is hidden, and only what needs attention.
    private struct CloudSaveAttention: View {
        let controller: CloudSaveController
        let showsStatus: Bool
        let reconnect: () -> Void

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                if showsStatus, let summary = controller.shownSummary, summary.status != .off {
                    Text(CloudSaveController.statusText(summary)).font(.caption).foregroundStyle(.secondary)
                }
                if let summary = controller.summary,
                   summary.status == .permissionRequired || summary.status == .reconnectRequired {
                    Button("Reconnect", action: reconnect).controlSize(.small)
                }
                if let message = controller.message { Text(message).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    /// Whether Resync is the fix for the attention message, so the panel can offer it in place.
    static func attentionOffersResync(_ status: DeviceConnectionModel.ReportStatus) -> Bool {
        switch status {
        case .idle, .failed, .uncertain: return true
        case .reported(let result, let issues): return issues > 0 || (result.reportVersion == 3 && result.complete != true)
        case .pending, .reporting: return false
        }
    }

    /// While a check waits or runs after an earlier report, the panel keeps that report's count instead of "Checking...".
    static func shownStatus(_ model: DeviceConnectionModel) -> DeviceConnectionModel.ReportStatus {
        shownStatus(model.reportStatus, lastReported: model.lastReportedStatus)
    }

    nonisolated static func shownStatus(_ status: DeviceConnectionModel.ReportStatus,
                                        lastReported: DeviceConnectionModel.ReportStatus?) -> DeviceConnectionModel.ReportStatus {
        switch status {
        case .idle, .pending, .reporting: return lastReported ?? status
        case .failed, .uncertain, .reported: return status
        }
    }

    /// The My skills count: everything in the account once sync has reported, else what this Mac has.
    nonisolated static func headerText(here: Int, summary: CloudSaveSummary?) -> String {
        let total = summary.flatMap { [.upToDate, .incomplete].contains($0.status) ? $0.mySkillsCount : nil } ?? here
        return "\(total) \(total == 1 ? "skill" : "skills")"
    }

    /// "75 on this Mac · 5 can't sync · 2 left out", or why sync isn't reporting.
    nonisolated static func lineText(here: Int, summary: CloudSaveSummary?) -> String {
        guard let summary else { return "\(here) on this Mac" }
        switch summary.status {
        case .upToDate, .incomplete: return CloudSaveController.statusText(summary)
        case .off: return "\(here) on this Mac · Not synced"
        default: return "\(here) on this Mac · " + CloudSaveController.statusText(summary)
        }
    }

    static func reportedCount(_ status: DeviceConnectionModel.ReportStatus) -> Int? {
        guard case .reported(let result, _) = status else { return nil }
        return result.syncedSkillCount
    }

    static func reportAttention(_ status: DeviceConnectionModel.ReportStatus) -> String? {
        if case .reported(let result, let issues) = status {
            if issues > 0 { return "Partial inventory reported. \(issues) scan issues need attention. Resync to retry." }
            if result.reportVersion == 3 && result.complete != true { return reportMessage(status) }
            // Skills that left this Mac (often deleted on purpose) need no attention; the count shows it.
            return nil
        }
        return reportMessage(status)
    }

    static func reportMessage(_ status: DeviceConnectionModel.ReportStatus) -> String {
        switch status {
        case .idle: return "Connected. Inventory has not been reported yet."
        case .pending: return "Waiting to check your skills."
        case .reporting: return "Checking your skills..."
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

/// Sync settings in Options: the My skills switch, Resync, when it last checked, and Disconnect.
@MainActor
struct ConnectedSyncOptions: View {
    let model: DeviceConnectionModel
    var runtime: ConnectedInventoryRuntime? = nil
    let iconWidth: CGFloat
    var reconnect: () -> Void = {}
    /// After Disconnect, the status panel shows Connect account.
    var didDisconnect: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let cloudSave = runtime?.cloudSave, cloudSave.isAvailable {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Label {
                            Text("Sync My skills").lineLimit(1)
                        } icon: {
                            Image(systemName: "icloud").frame(width: iconWidth)
                        }
                        if cloudSave.isRunning { ProgressView().controlSize(.mini) }
                        Spacer(minLength: 0)
                        Toggle("Sync My skills", isOn: Binding(
                            get: { cloudSave.isEnabled },
                            set: { cloudSave.setEnabled($0) }))
                        .toggleStyle(.switch).controlSize(.small).labelsHidden()
                    }
                    if !cloudSave.isEnabled {
                        Text("Off: My skills lists names only, and files stay on this Mac.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    // A switch change that fails says so here, where it was made.
                    if let summary = cloudSave.summary,
                       summary.status == .permissionRequired || summary.status == .reconnectRequired {
                        Text(CloudSaveController.statusText(summary)).font(.caption).foregroundStyle(.secondary)
                        Button("Reconnect", action: reconnect).controlSize(.small)
                    }
                    if let message = cloudSave.message { Text(message).font(.caption).foregroundStyle(.secondary) }
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    if let runtime { runtime.resync() } else { model.requestInventoryReport() }
                } label: {
                    HStack(spacing: 8) {
                        Label {
                            Text("Resync")
                        } icon: {
                            Image(systemName: "arrow.clockwise").frame(width: iconWidth)
                        }
                        if model.reportStatus == .reporting { ProgressView().controlSize(.mini) }
                    }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                }.buttonStyle(.plain)
                .disabled(model.reportStatus == .reporting)
                if let checked = model.lastInventoryCheckedAt {
                    Text("Last " + checked.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }
            Button {
                if let runtime { runtime.disconnect() } else { model.disconnect() }
                didDisconnect()
            } label: {
                Label {
                    Text("Disconnect")
                } icon: {
                    Image(systemName: "person.crop.circle.badge.minus").frame(width: iconWidth)
                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(.plain)
        }
    }
}

#endif
