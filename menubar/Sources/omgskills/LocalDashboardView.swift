import SwiftUI

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
    let selectedFilter: LocalDashboardFilter?
    let onSelectFilter: (LocalDashboardFilter) -> Void
    let onSelectRecentSkill: (InstalledSkillSummary.RecentSkill) -> Void
    private var stats: [LocalDashboardStat] {
        [
            LocalDashboardStat(filter: .all, value: summary.totalInstallations, symbol: "square.stack.3d.up"),
            LocalDashboardStat(filter: .codex, value: summary.codexCount, symbol: "person"),
            LocalDashboardStat(filter: .claude, value: summary.claudeCount, symbol: "sparkles"),
            LocalDashboardStat(filter: .other, value: summary.agentsCount, symbol: "tray")
        ]
    }

    private let columns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 18) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                ForEach(stats) { stat in
                    LocalDashboardStatCard(stat: stat, selected: stat.filter == selectedFilter) {
                        onSelectFilter(stat.filter)
                    }
                }
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
        .padding(.top, 18)
        .padding(.bottom, selectedFilter == nil ? 18 : 12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

}

struct SkillSyncView: View {
    let installations: [Skill]
    let isReady: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var token = ""
    @State private var status = ""
    @State private var isError = false
    @State private var isSyncing = false
    @FocusState private var isTokenFocused: Bool

    private var trimmedToken: String {
        token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Resync web portal")
                    .font(.headline)
                Spacer()
                Button("Close", systemImage: "xmark", action: dismiss.callAsFunction)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .help("Close")
            }

            Text("Generate a fresh token on your profile page, then paste it below. Tokens expire after 10 minutes and work once.")
                .font(.callout)
                .foregroundStyle(.secondary)

            SecureField("Paste access token", text: $token)
                .textFieldStyle(.roundedBorder)
                .focused($isTokenFocused)
                .onSubmit(syncInstalledSkills)
                .disabled(isSyncing)

            if !status.isEmpty {
                Text(status)
                    .font(.caption)
                    .foregroundStyle(isError ? .red : .secondary)
                    .accessibilityLabel(status)
            }

            Button(isSyncing ? "Resyncing..." : "Resync", action: syncInstalledSkills)
                .buttonStyle(.borderedProminent)
                .disabled(isSyncing || trimmedToken.isEmpty || !isReady)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(20)
        .frame(width: 380)
        .defaultFocus($isTokenFocused, true)
        .interactiveDismissDisabled(isSyncing)
    }

    private func syncInstalledSkills() {
        guard !trimmedToken.isEmpty, !isSyncing, isReady else { return }

        isSyncing = true
        isError = false
        status = "Uploading installed skill metadata..."
        let submittedToken = trimmedToken
        let snapshot = installations

        Task {
            do {
                let result = try await SkillSyncService.upload(
                    token: submittedToken,
                    installations: snapshot
                )
                status = "Synced \(result.syncedSkillCount) skills."
                token = ""
            } catch {
                status = error.localizedDescription
                isError = true
            }
            isSyncing = false
        }
    }
}

private struct LocalDashboardStat: Identifiable, Equatable {
    let filter: LocalDashboardFilter
    let value: Int
    let symbol: String
    var title: String { filter.title }
    var id: String { filter.id }
}

private struct LocalDashboardStatCard: View {
    let stat: LocalDashboardStat
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .bottom, spacing: 0) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(stat.value)")
                        .font(.system(size: 17, weight: .semibold))
                        .monospacedDigit()
                    Text(stat.title)
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, 15)
            .padding(.trailing, 7)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(selected ? Color.accentColor.opacity(0.14) : Color.primary.opacity(0.055))
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(stat.title) skills, \(stat.value)")
        .accessibilityHint("Shows matching installed skills")
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
