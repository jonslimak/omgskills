import AppKit
import HandoffCore
import HandoffUI
import HelperUpdates
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

@MainActor
final class HelperApplicationDelegate: NSObject, NSApplicationDelegate {
    let model = InstallModel(codex: UserInstallService(agent: .codex),
                             claude: UserInstallService(agent: .claude),
                             admissionCheck: LaunchAdmission.verify)
    lazy var updater = HelperUpdater(model: model)
    let launchError: String?
    private var termination: Task<Void, Never>?

    override init() {
        do { try LaunchAdmission.verify(); launchError = nil }
        catch { launchError = error.localizedDescription }
        super.init()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard model.beginTermination() else { return .terminateCancel }
        guard model.hasPendingWork else { return .terminateNow }
        if termination == nil {
            termination = Task { [model] in
                await model.waitForPendingWork()
                sender.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }
}

@main
struct HelperApp: App {
    @NSApplicationDelegateAdaptor(HelperApplicationDelegate.self) private var delegate

    var body: some Scene {
        Window(HelperIdentity.name, id: "helper") {
            Group {
                if let launchError = delegate.launchError {
                    VStack(alignment: .leading, spacing: 16) {
                        Label("Helper unavailable", systemImage: "exclamationmark.triangle").font(.title2)
                        Text(launchError)
                        Button("Quit") { NSApplication.shared.terminate(nil) }
                    }.padding(24).frame(width: 480)
                } else {
                    InstallContent(model: delegate.model)
                }
            }
            .onOpenURL { url in
                guard delegate.launchError == nil else { return }
                delegate.model.open(url.absoluteString)
                NSApplication.shared.activate()
            }
            .onDisappear { delegate.model.cancel() }
        }
        .windowResizability(.contentSize)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for Updates...") { delegate.updater.checkForUpdates() }
                    .disabled(delegate.launchError != nil || !delegate.updater.canCheck)
                    .help(delegate.updater.status ?? "Close any skill review before checking for helper updates.")
            }
        }
    }
}
