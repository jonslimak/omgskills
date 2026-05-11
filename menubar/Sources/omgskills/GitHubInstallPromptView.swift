import SwiftUI

enum GitHubInstallPromptTone: Equatable {
    case neutral
    case success
    case error
}

struct GitHubInstallPromptView: View {
    @Binding var urlText: String
    @Binding var installCodex: Bool
    @Binding var installClaude: Bool

    let title: String
    let message: String?
    let tone: GitHubInstallPromptTone
    let showInstallControls: Bool
    let canInstall: Bool
    let isInstalling: Bool
    let onInstall: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Install from GitHub")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.tertiary)

            TextField("Paste GitHub repo URL", text: $urlText)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 11))
                .accessibilityLabel("GitHub repository URL")

            if showInstallControls {
                HStack(spacing: 8) {
                    installTargetButton("Codex", selected: $installCodex)
                    installTargetButton("Claude", selected: $installClaude)
                    Spacer(minLength: 0)
                    Button(isInstalling ? "Installing..." : "Install") {
                        onInstall()
                    }
                    .disabled(!canInstall || isInstalling)
                    .controlSize(.small)
                    .accessibilityLabel("Install pasted GitHub skill")
                }
            }

            if !title.isEmpty || message != nil {
                VStack(alignment: .leading, spacing: 2) {
                    if !title.isEmpty {
                        Text(title)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(statusColor)
                    }
                    if let message {
                        Text(message)
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func installTargetButton(_ title: String, selected: Binding<Bool>) -> some View {
        Button {
            selected.wrappedValue.toggle()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: selected.wrappedValue ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 10))
                Text(title)
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(selected.wrappedValue ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title) install target")
        .accessibilityValue(selected.wrappedValue ? "Selected" : "Not selected")
    }

    private var statusColor: Color {
        switch tone {
        case .neutral: return .secondary
        case .success: return .green
        case .error: return .red
        }
    }
}
