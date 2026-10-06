import HandoffCore
import SwiftUI

@main
struct HandoffApp: App {
    @State private var model = PreviewModel()

    var body: some Scene {
        Window("OMGSkills Handoff Test", id: "handoff") {
            VStack(alignment: .leading, spacing: 16) {
                Text("OMGSkills")
                    .font(.headline)

                if let preview = model.preview {
                    Label("Verified package preview", systemImage: "checkmark.shield")
                        .font(.title2)
                    Text(preview.skillID).font(.headline).textSelection(.enabled)
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                        GridRow { Text("Source"); Text("\(preview.repo)/\(preview.path)") }
                        GridRow { Text("Commit"); Text(preview.commit).font(.system(.caption, design: .monospaced)) }
                        GridRow { Text("Package"); Text("\(preview.files.count) files, \(preview.totalBytes) bytes") }
                    }
                    .textSelection(.enabled)
                    List(preview.files) { file in
                        HStack {
                            Text(file.path).textSelection(.enabled)
                            Spacer()
                            Text("\(file.size) bytes").foregroundStyle(.secondary)
                        }
                    }
                    Text("Not installed. Temporary downloads removed.").foregroundStyle(.secondary)
                } else if model.isLoading {
                    ProgressView("Downloading and verifying pinned package...")
                    Text(model.request?.skillID ?? "").font(.caption)
                } else if let error = model.errorMessage {
                    Label("Preview unavailable", systemImage: "exclamationmark.triangle").font(.title2)
                    Text(error).foregroundStyle(.secondary)
                } else {
                    Text("No package selected.")
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
                if model.request != nil || model.errorMessage != nil {
                    Button("Cancel", role: .cancel) { model.cancel() }
                        .keyboardShortcut(.cancelAction)
                }
            }
            .padding(24)
            .frame(width: 660, height: 480)
            .onOpenURL { url in
                model.open(url.absoluteString)
                NSApplication.shared.activate()
            }
            .onDisappear { model.cancel() }
        }
        .windowResizability(.contentSize)
    }
}
