import HandoffCore
import SwiftUI

@main
struct HandoffApp: App {
    @State private var model = PreviewModel()
    @State private var installModel: InstallModel?
    private let configurationError: String?
    private let fixtureMode: Bool
    private let testDestination: Bool

    init() {
        let environment = ProcessInfo.processInfo.environment
        do {
            let mode = try InstallLaunchMode.parse(environment)
            let prepared = try mode.makeModel()
            fixtureMode = mode.fixtures
            testDestination = mode.isTest
            _installModel = State(initialValue: prepared)
            configurationError = nil
        } catch {
            fixtureMode = false
            testDestination = true
            _installModel = State(initialValue: nil)
            configurationError = error.localizedDescription
        }
    }

    var body: some Scene {
        Window("OMGSkills Handoff Test", id: "handoff") {
            Group {
                if let installModel {
                    InstallContent(model: installModel, fixtureMode: fixtureMode, testDestination: testDestination)
                } else if let configurationError {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Install destination unavailable").font(.title2)
                        Text(configurationError)
                    }.padding(24).frame(width: 600, height: 240)
                } else {
                    previewContent
                }
            }
            .onOpenURL { url in
                if let installModel { installModel.open(url.absoluteString) }
                else if configurationError == nil { model.open(url.absoluteString) }
                NSApplication.shared.activate()
            }
            .onDisappear { model.cancel(); installModel?.cancel() }
        }
        .windowResizability(.contentSize)
    }

    private var previewContent: some View {
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
    }
}
