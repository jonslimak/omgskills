import SwiftUI
import Observation

enum LocalDashboardFilter: String, CaseIterable, Identifiable, Equatable {
    case all
    case codex
    case claude
    case other
    case linked
    case localOnly

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .codex: return "Codex"
        case .claude: return "Claude"
        case .other: return "Other"
        case .linked: return "Linked"
        case .localOnly: return "Local-only"
        }
    }
}

struct LocalDashboardView: View {
    let summary: InstalledSkillSummary
    let logicalSkillCount: Int
    let selectedFilter: LocalDashboardFilter?
    let onSelectFilter: (LocalDashboardFilter) -> Void
    let onSelectRecentSkill: (InstalledSkillSummary.RecentSkill) -> Void
    private var stats: [LocalDashboardStat] {
        [
            LocalDashboardStat(filter: .all, value: logicalSkillCount),
            LocalDashboardStat(filter: .codex, value: summary.codexCount),
            LocalDashboardStat(filter: .claude, value: summary.claudeCount),
            LocalDashboardStat(filter: .other, value: summary.agentsCount)
        ]
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 15) {
            LocalDashboardStatTabs(stats: stats, selectedFilter: selectedFilter) { filter in
                onSelectFilter(filter)
            }

            if selectedFilter == nil, !summary.recentSkills.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Recently installed")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.tertiary)

                    ForEach(summary.recentSkills) { skill in
                        LocalRecentSkillRow(skill: skill) {
                            onSelectRecentSkill(skill)
                        }
                    }
                }
            }

        }
        .padding(.horizontal, 18)
        .padding(.top, 7)
        .padding(.bottom, selectedFilter == nil ? 18 : 12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

}

struct SkillSyncView: View {
    private enum ConnectionMethod {
        case browser
        case manual
    }

    let connectionModel: DeviceConnectionModel
    let installations: [Skill]
    let isReady: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var pairingCode = ""
    @State private var legacyExpanded = false
    @State private var showReplacementConfirmation = false
    @State private var replacementMethod = ConnectionMethod.browser
    @State private var legacyModel = LegacySkillSyncModel()

    private var trimmedPairingCode: String {
        pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var deviceName: String {
        Host.current().localizedName ?? "Mac"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Sync web portal")
                    .font(.headline)
                Spacer()
                Button("Close", systemImage: "xmark", action: close)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .help("Close")
            }

            deviceContent

            Divider()

            DisclosureGroup(isExpanded: $legacyExpanded) {
                LegacySkillSyncSection(
                    model: legacyModel,
                    installations: installations,
                    isReady: isReady
                )
                .padding(.top, 10)
            } label: {
                Text("Legacy one-time sync")
                    .font(.callout.weight(.medium))
            }
        }
        .padding(20)
        .frame(width: 380)
        .interactiveDismissDisabled(legacyModel.isSyncing)
        .confirmationDialog(
            "Replace current connection?",
            isPresented: $showReplacementConfirmation
        ) {
            Button("Replace connection", role: .destructive) {
                if replacementMethod == .browser {
                    connectWithBrowser(replacingExisting: true)
                } else {
                    connectManually(replacingExisting: true)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The current portal connection stays active unless the new pairing succeeds.")
        }
        .onChange(of: connectionModel.state) { _, state in
            if state == .failed(.replacementRequired) {
                showReplacementConfirmation = true
            }
            if case .connected = state {
                pairingCode = ""
            }
        }
        .onDisappear {
            legacyModel.cancel()
        }
    }

    @ViewBuilder
    private var deviceContent: some View {
        switch connectionModel.state {
        case .connected(let info):
            connectedContent(info)
        case .authorizing:
            progressContent("Waiting for approval in your browser...")
        case .exchanging:
            progressContent("Connecting to your portal account...")
        case .storingCredential:
            progressContent("Securing this connection in Keychain...")
        case .syncing:
            progressContent("Syncing installed skill metadata...")
        case .failed(.sync(let message)):
            retryContent(message)
        case .failed(let failure):
            pairingContent(errorMessage: message(for: failure))
        case .disconnected:
            pairingContent(errorMessage: connectionModel.disconnectWarning)
        }
    }

    private func pairingContent(errorMessage: String?) -> some View {
        DevicePairingSection(
            pairingCode: $pairingCode,
            errorMessage: errorMessage,
            isReady: isReady,
            onConnectWithBrowser: { connectWithBrowser(replacingExisting: false) },
            onConnectManually: { connectManually(replacingExisting: false) }
        )
    }

    private func connectedContent(_ info: DeviceConnectionInfo) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Connected", systemImage: "checkmark.circle.fill")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.green)

            VStack(alignment: .leading, spacing: 3) {
                Text(info.accountLabel)
                    .font(.callout)
                Text("Connection expires \(info.expiresAt.formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Button("Disconnect", role: .destructive) {
                    connectionModel.disconnect()
                }
                Spacer()
                Button("Sync now") {
                    connectionModel.retrySync(installations: installations)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!isReady)
            }
        }
    }

    private func retryContent(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message)
                .font(.caption)
                .foregroundStyle(.red)

            HStack {
                Button("Disconnect", role: .destructive) {
                    connectionModel.disconnect()
                }
                Spacer()
                Button("Retry sync") {
                    connectionModel.retrySync(installations: installations)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!isReady)
            }
        }
    }

    private func progressContent(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ProgressView()
                    .controlSize(.small)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)

            Button("Cancel") {
                connectionModel.cancelCurrentOperation()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
    }

    private func message(for failure: DeviceConnectionFailure) -> String? {
        switch failure {
        case .authorization(let message), .exchange(let message), .sync(let message):
            return message
        case .replacementRequired:
            return "Confirm replacement to connect this portal account."
        case .credentialStorage:
            return "The connection could not be saved securely. Try again."
        case .reconnectRequired:
            return "This Mac needs a fresh pairing code."
        }
    }

    private func connectWithBrowser(replacingExisting: Bool) {
        guard isReady else { return }
        replacementMethod = .browser
        connectionModel.connectWithBrowser(
            deviceName: deviceName,
            installations: installations,
            replacingExisting: replacingExisting
        )
    }

    private func connectManually(replacingExisting: Bool) {
        guard !trimmedPairingCode.isEmpty, isReady else { return }
        replacementMethod = .manual
        connectionModel.connect(
            pairingCode: trimmedPairingCode,
            deviceName: deviceName,
            installations: installations,
            replacingExisting: replacingExisting
        )
    }

    private func close() {
        legacyModel.cancel()
        pairingCode = ""
        dismiss()
    }
}

private struct DevicePairingSection: View {
    @Binding var pairingCode: String
    let errorMessage: String?
    let isReady: Bool
    let onConnectWithBrowser: () -> Void
    let onConnectManually: () -> Void

    @FocusState private var isPairingCodeFocused: Bool
    @State private var manualPairingExpanded = false

    private var trimmedPairingCode: String {
        pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sign in and approve the connection in your browser.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Button("Connect with browser", action: onConnectWithBrowser)
                .buttonStyle(.borderedProminent)
                .disabled(!isReady)

            DisclosureGroup("Use connection code instead", isExpanded: $manualPairingExpanded) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Generate a connection code in the portal, then paste it here.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack {
                        SecureField("Paste connection code", text: $pairingCode)
                            .textFieldStyle(.roundedBorder)
                            .focused($isPairingCodeFocused)
                            .onSubmit(onConnectManually)
                            .accessibilityLabel("Portal connection code")

                        PasteButton(payloadType: String.self) { values in
                            pairingCode = values.first ?? ""
                        }
                        .labelStyle(.iconOnly)
                        .help("Paste connection code")
                    }

                    Button("Connect with code", action: onConnectManually)
                        .disabled(trimmedPairingCode.isEmpty || !isReady)
                }
                .padding(.top, 8)
            }

            if let errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityLabel(errorMessage)
            } else if !isReady {
                Text("Scanning installed skills...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

        }
        .onChange(of: manualPairingExpanded) { _, isExpanded in
            if isExpanded {
                isPairingCodeFocused = true
            }
        }
    }
}

private struct LegacySkillSyncSection: View {
    let model: LegacySkillSyncModel
    let installations: [Skill]
    let isReady: Bool

    @State private var token = ""
    @FocusState private var isTokenFocused: Bool

    private var trimmedToken: String {
        token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("For older portal tokens. Tokens expire after 10 minutes and work once.")
                .font(.caption)
                .foregroundStyle(.secondary)

            SecureField("Paste legacy access token", text: $token)
                .textFieldStyle(.roundedBorder)
                .focused($isTokenFocused)
                .onSubmit(sync)
                .disabled(model.isSyncing)
                .accessibilityLabel("Legacy portal access token")

            if !model.status.isEmpty {
                Text(model.status)
                    .font(.caption)
                    .foregroundStyle(model.isError ? .red : .secondary)
                    .accessibilityLabel(model.status)
            }

            Button(model.isSyncing ? "Syncing..." : "Sync once", action: sync)
                .buttonStyle(.bordered)
                .disabled(model.isSyncing || trimmedToken.isEmpty || !isReady)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .defaultFocus($isTokenFocused, true)
        .onChange(of: model.completedSyncCount) {
            token = ""
        }
    }

    private func sync() {
        guard !trimmedToken.isEmpty, isReady else { return }
        model.sync(token: trimmedToken, installations: installations)
    }
}

@MainActor
@Observable
private final class LegacySkillSyncModel {
    private(set) var status = ""
    private(set) var isError = false
    private(set) var isSyncing = false
    private(set) var completedSyncCount = 0

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var attemptID: UUID?

    func sync(token: String, installations: [Skill]) {
        cancel()
        let currentAttemptID = UUID()
        attemptID = currentAttemptID
        isSyncing = true
        isError = false
        status = "Uploading installed skill metadata..."
        let snapshot = installations

        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let result = try await SkillSyncService.upload(
                    token: token,
                    installations: snapshot
                )
                guard attemptID == currentAttemptID, !Task.isCancelled else { return }
                status = "Synced \(result.syncedSkillCount) skills."
                completedSyncCount += 1
            } catch is CancellationError {
                return
            } catch {
                guard attemptID == currentAttemptID, !Task.isCancelled else { return }
                status = error.localizedDescription
                isError = true
            }
            guard attemptID == currentAttemptID else { return }
            isSyncing = false
            attemptID = nil
            task = nil
        }
    }

    func cancel() {
        attemptID = nil
        task?.cancel()
        task = nil
        isSyncing = false
    }
}

private struct LocalDashboardStat: Identifiable, Equatable {
    let filter: LocalDashboardFilter
    let value: Int
    var title: String { filter.title }
    var id: String { filter.id }
}

private struct LocalDashboardStatTabs: View {
    let stats: [LocalDashboardStat]
    let selectedFilter: LocalDashboardFilter?
    let onSelect: (LocalDashboardFilter) -> Void

    var body: some View {
        ZStack {
            HStack(spacing: 0) {
                ForEach(stats) { stat in
                    LocalDashboardStatTab(stat: stat, selected: stat.filter == selectedFilter) {
                        onSelect(stat.filter)
                    }
                    .frame(maxWidth: .infinity)
                }
            }

            HStack(spacing: 0) {
                Spacer(minLength: 0)
                ForEach(0..<3, id: \.self) { _ in
                    Rectangle()
                        .fill(Color.primary.opacity(0.12))
                        .frame(width: 1, height: 14)
                    Spacer(minLength: 0)
                }
            }
            .allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 28)
    }
}

private struct LocalDashboardStatTab: View {
    let stat: LocalDashboardStat
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(stat.title)
                    .font(.system(size: 11, weight: .regular))
                Text("\(stat.value)")
                    .font(.system(size: 11, weight: .bold))
                    .monospacedDigit()
            }
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .foregroundStyle(selected ? AppUIStyle.selectedPrimaryText : .primary)
            .padding(.horizontal, 12)
            .frame(height: 22)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(selected ? AppUIStyle.activeBlue : Color.clear)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(stat.title) skills, \(stat.value)")
        .accessibilityHint("Shows matching installed skills")
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

private struct LocalRecentSkillRow: View {
    let skill: InstalledSkillSummary.RecentSkill
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(skill.name)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                Spacer()
                Text(skill.origin)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
                Text(relativeDate(skill.installedAt))
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(skill.name), \(skill.origin), installed \(relativeDate(skill.installedAt))")
        .accessibilityHint("Opens this installed skill")
    }

    private func relativeDate(_ date: Date) -> String {
        let seconds = max(0, Int(Date().timeIntervalSince(date)))
        if seconds < 60 { return "now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 48 { return "\(hours)h" }
        return "\(hours / 24)d"
    }
}
