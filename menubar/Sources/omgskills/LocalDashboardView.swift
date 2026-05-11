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
