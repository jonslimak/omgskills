import AppKit
import HandoffCore
import HandoffUI
import SwiftUI

@MainActor
private enum LaunchAdmission {
    static func verify() throws {
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: HelperIdentity.bundleID)
        try HelperIdentity.verify(bundleID: Bundle.main.bundleIdentifier,
                                  currentPID: ProcessInfo.processInfo.processIdentifier,
                                  runningPIDs: running.filter { !$0.isTerminated }.map(\.processIdentifier))
    }
}

@main
struct HelperApp: App {
    @State private var model = InstallModel(codex: UserInstallService(agent: .codex),
                                            claude: UserInstallService(agent: .claude),
                                            admissionCheck: LaunchAdmission.verify)
    private let launchError: String?

    init() {
        do { try LaunchAdmission.verify(); launchError = nil }
        catch { launchError = error.localizedDescription }
    }

    var body: some Scene {
        Window(HelperIdentity.name, id: "helper") {
            Group {
                if let launchError {
                    VStack(alignment: .leading, spacing: 16) {
                        Label("Helper unavailable", systemImage: "exclamationmark.triangle").font(.title2)
                        Text(launchError)
                        Button("Quit") { NSApplication.shared.terminate(nil) }
                    }.padding(24).frame(width: 480)
                } else {
                    InstallContent(model: model)
                }
            }
            .onOpenURL { url in
                guard launchError == nil else { return }
                model.open(url.absoluteString)
                NSApplication.shared.activate()
            }
            .onDisappear { model.cancel() }
        }
        .windowResizability(.contentSize)
    }
}
