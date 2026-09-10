import SwiftUI

struct GroupInstallFlowSheet: View {
    let model: GroupInstallFlowModel
    let installer: any GroupSnapshotInstalling
    let packageLoader: any GroupSkillPackageLoading
    let updateCoordinator: UpdateInstallCoordinator
    let homeDirectory: URL

    var body: some View {
        Group {
            switch model.phase {
            case .idle, .loading:
                VStack(spacing: 14) {
                    ProgressView()
                    Text("Loading Skill Group...")
                        .foregroundStyle(.secondary)
                }
                .frame(width: 360, height: 220)
            case .ready:
                if let context = model.presentationContext {
                    GroupSnapshotInstallSheet(
                        manifest: context.manifest,
                        route: context.route,
                        credential: context.credential,
                        installer: installer,
                        packageLoader: packageLoader,
                        updateCoordinator: updateCoordinator,
                        homeDirectory: homeDirectory
                    )
                    .id(context.id)
                } else {
                    failureView(
                        message: "The Skill Group could not be loaded.",
                        canRetry: false
                    )
                }
            case .failure(let failure):
                failureView(message: failure.message, canRetry: failure.canRetry)
            }
        }
        .onDisappear {
            model.dismiss()
        }
    }

    private func failureView(message: String, canRetry: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Unable to load Skill Group", systemImage: "exclamationmark.triangle.fill")
                .font(.headline)
            Text(message)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Close") {
                    model.dismiss()
                }
                .keyboardShortcut(.cancelAction)
                Spacer()
                if canRetry {
                    Button("Try again") {
                        model.retry()
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(20)
        .frame(width: 380)
    }
}
