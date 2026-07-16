import SwiftUI

struct InstalledSkillRow: View {
    let item: InstalledSkillDisplayItem
    let selectedSkillId: String?
    let onSelectSkill: (Skill) -> Void
    let onCreatorTap: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                rowTextButton(
                    item.displayName,
                    font: .headline,
                    color: .primary,
                    lineLimit: 1
                )
                .layoutPriority(1)

                creatorButton
                Spacer(minLength: 4)

                HStack(spacing: 4) {
                    ForEach(item.sourceGroups) { sourceGroup in
                        SourceBadge(
                            sourceGroup: sourceGroup,
                            selectedSkillId: selectedSkillId,
                            onSelectSkill: onSelectSkill
                        )
                    }
                }
            }

            rowTextButton(
                item.displayDescription,
                font: .system(size: 10),
                color: .secondary.opacity(0.7),
                lineLimit: 2,
                fillWidth: true
            )
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(item.contains(skillId: selectedSkillId) ? Color.accentColor.opacity(0.18) : .clear)
        .contentShape(.rect)
        .help(item.installationSummary)
    }

    private func rowTextButton(
        _ text: String,
        font: Font,
        color: Color,
        lineLimit: Int,
        fillWidth: Bool = false
    ) -> some View {
        Button(action: { onSelectSkill(item.representative) }) {
            Text(text)
                .font(font)
                .foregroundStyle(color)
                .lineLimit(lineLimit)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: fillWidth ? .infinity : nil, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var creatorButton: some View {
        if !item.representative.authorHandle.isEmpty {
            Button {
                onCreatorTap(item.representative.authorHandle)
            } label: {
                Text("@\(item.representative.authorHandle)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Show all skills by @\(item.representative.authorHandle)")
            .help("Show all skills by @\(item.representative.authorHandle)")
        }
    }

    private struct SourceBadge: View {
        let sourceGroup: InstalledSkillDisplayItem.SourceGroup
        let selectedSkillId: String?
        let onSelectSkill: (Skill) -> Void

        var body: some View {
            if sourceGroup.members.count == 1, let skill = sourceGroup.members.first {
                Button(action: { onSelectSkill(skill) }) {
                    badgeLabel
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(sourceGroup.source) installation")
                .help("Open \(sourceGroup.source) installation")
            } else {
                Menu {
                    ForEach(sourceGroup.members) { skill in
                        Button(compactPath(skill.installCmd)) {
                            onSelectSkill(skill)
                        }
                    }
                } label: {
                    badgeLabel
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel(
                    "Choose \(sourceGroup.source) installation, \(sourceGroup.members.count) locations"
                )
                .help("Choose a \(sourceGroup.source) installation")
            }
        }

        private var badgeLabel: some View {
            Text(sourceGroup.badgeTitle)
                .font(.caption2)
                .fontWeight(.medium)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(originColor.opacity(0.18)))
                .foregroundStyle(originColor)
                .overlay {
                    if sourceGroup.members.contains(where: { $0.id == selectedSkillId }) {
                        Capsule().stroke(originColor.opacity(0.65), lineWidth: 1)
                    }
                }
        }

        private var originColor: Color {
            switch sourceGroup.source.lowercased() {
            case "claude": return .blue
            case "codex": return .green
            case "agents": return .purple
            default: return .secondary
            }
        }

        private func compactPath(_ path: String) -> String {
            let homePath = FileManager.default.homeDirectoryForCurrentUser.path
            if path.hasPrefix(homePath) {
                return "~\(path.dropFirst(homePath.count))"
            }
            return path
        }
    }
}
