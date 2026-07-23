import AppKit
import SwiftUI

struct SkillOriginBadge: View {
    let origin: String
    var count = 1
    var selected = false
    var selectedRow = false

    var body: some View {
        if let iconImage {
            HStack(spacing: 3) {
                ZStack {
                    Circle()
                        .fill(iconBackgroundColor)

                    Image(nsImage: iconImage)
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .foregroundStyle(iconForegroundColor)
                        .frame(width: 10, height: 10)
                        .accessibilityHidden(true)
                }
                .frame(width: 16, height: 16)

                if count > 1 {
                    Text("\(count)")
                        .font(.caption2)
                        .foregroundStyle(countColor)
                        .monospacedDigit()
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityLabel)
        } else {
            Text(count == 1 ? origin : "\(origin) \(count)")
                .font(.caption2)
                .fontWeight(.medium)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color.secondary.opacity(0.18)))
                .foregroundStyle(.secondary)
                .accessibilityLabel(accessibilityLabel)
        }
    }

    private var iconBackgroundColor: Color {
        if selectedRow {
            return selected ? .white : AppUIStyle.activeBlue
        }
        return selected ? Color.accentColor : Color.primary.opacity(0.055)
    }

    private var iconForegroundColor: Color {
        if selectedRow {
            return selected ? AppUIStyle.activeBlue : .white
        }
        return selected ? .white : Color.primary.opacity(0.5)
    }

    private var countColor: Color {
        selectedRow ? AppUIStyle.selectedSecondaryText : .secondary
    }

    private var accessibilityLabel: String {
        count == 1 ? origin : "\(origin), \(count) installations"
    }

    private var iconImage: NSImage? {
        switch origin.lowercased() {
        case "claude": return Self.claudeIcon
        case "codex": return Self.codexIcon
        default: return nil
        }
    }

    private static let claudeIcon = loadIcon(named: "claude-origin")
    private static let codexIcon = loadIcon(named: "codex-origin")

    private static func loadIcon(named name: String) -> NSImage? {
        guard let url = AppResource.url(forResource: name, withExtension: "png") else {
            return nil
        }
        return NSImage(contentsOf: url)
    }
}
