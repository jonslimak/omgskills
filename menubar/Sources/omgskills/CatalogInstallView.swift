#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI
import AppKit

struct CatalogInstallView: View {
    let model: CatalogInstallModel
    let close: () -> Void
    var connection: DeviceConnectionModel? = nil
    var inventoryRuntime: ConnectedInventoryRuntime? = nil
    var connectionSetupError: String? = nil

    static let connectionSetupFailureMessage = "Account connection is unavailable. Skill installation is still available."

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(model.record?.name ?? model.appName).font(.title2.bold())
                .textSelection(.enabled)
            if let connection {
                ConnectedInventoryView(model: connection, deviceName: Host.current().localizedName ?? "Test Mac", runtime: inventoryRuntime)
                Divider()
            }
            if let connectionSetupError {
                Text(connectionSetupError).font(.callout).foregroundStyle(.red)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let record = model.record, let request = model.request {
                        LabeledContent("Source") {
                            Text(record.githubURL).textSelection(.enabled)
                        }
                        LabeledContent("Install in", value: request.target.rawValue)
                        if let destination = model.destination {
                            Text(destination.path).font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary).textSelection(.enabled)
                        }
                        if case .complete(let metadata) = record.skill.pinnedInstallMetadataState {
                            Text("Catalog commit: " + metadata.coordinates.commitSha)
                                .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .top, spacing: 10) {
                if model.isWorking { ProgressView().controlSize(.small) }
                else if model.result == .installed || model.result == .alreadyInstalled {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                } else if model.hasFailure {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
                }
                Text(model.message).foregroundStyle(model.hasFailure ? Color.red : Color.primary)
                    .textSelection(.enabled)
            }
            if !model.notice.isEmpty { Text(model.notice).font(.callout).foregroundStyle(.secondary) }
            if model.result == .installed, model.request?.target == .codex {
                Text("Restart Codex if the skill does not appear.").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Button(model.ownsRequest ? "Cancel" : "Close", action: close)
                    .keyboardShortcut(.cancelAction).disabled(!model.canClose)
                Spacer()
                if model.phase == .confirm, let target = model.request?.target {
                    Button("Install in " + target.rawValue) { model.install() }
                        .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                }
            }
        }.padding(24).frame(minWidth: 480, minHeight: 320)
    }
}

@MainActor
final class CatalogInstallWindowController: NSObject, NSWindowDelegate, NSMenuItemValidation {
    let model: CatalogInstallModel
    private let website: URL
    private let window: NSWindow
    private let statusItem: NSStatusItem
    private var appUpdater: CatalogCandidateUpdater?
    private var connectedRuntime: ConnectedInventoryRuntime?

    #if DEBUG
    convenience init(root: URL, website: URL, coordinator: UpdateInstallCoordinator,
                     connected: AppRuntimeConfiguration.ConnectedInventoryConfiguration? = nil) throws {
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        var origin = URLComponents(url: website, resolvingAgainstBaseURL: false)!
        origin.path = ""
        origin.query = nil
        origin.fragment = nil
        let records = try CatalogInstallRecordClient(localOrigin: origin.url!)
        let managed = ManagedSkillInstaller(managedRoot: root.appendingPathComponent("managed"), pathAnchor: paths.homeDirectory)
        let installer = CatalogSkillInstaller(packageFetcher: GitPublicSkillPackageFetcher(temporaryRoot: root),
            managedInstaller: managed, filesystemPaths: paths)
        let service = CatalogInstallFlowService(records: records, installer: CatalogInstallService(installer: installer))
        self.init(model: CatalogInstallModel(service: service, coordinator: coordinator,
            appName: connected == nil ? nil : "OMGSkills Connected Test"), website: website)
        if let connected {
            let authorizer = WebAuthenticationSession(anchorProvider: { [weak self] in self?.window },
                onReturn: { [weak self] in self?.showStatus() })
            let connection = DeviceConnectionModel(
                credentialStore: DeviceCredentialStore(service: connected.keychainService),
                api: DeviceSyncAPI(uploadEndpoint: connected.uploadURL,
                    reportMode: connected.inventoryReconciliation ? .reconciliation : .presence),
                browserAuthorizer: authorizer, portalConnectURL: connected.connectURL,
                callbackScheme: BrowserPairing.connectedTestCallbackScheme,
                updateCoordinator: coordinator,
                inventoryScanner: {
                    if connected.inventoryReconciliation {
                        return try await InstalledSkillsScanner.scanForReconciliation(
                            filesystemPaths: connected.filesystemPaths, pathAnchor: connected.root)
                    }
                    return try await InstalledSkillsScanner.scanForPresence(
                        filesystemPaths: connected.filesystemPaths, pathAnchor: connected.root)
                }, inventoryAutomationEnabled: connected.inventoryAutomation)
            let runtime = ConnectedInventoryRuntime(connection: connection, authorizer: authorizer,
                automation: connected.inventoryAutomation ? .live(paths: connected.filesystemPaths) : nil)
            connectedRuntime = runtime
            runtime.observeInstalls(in: model)
            window.contentView = NSHostingView(rootView: CatalogInstallView(model: model,
                close: { [weak self] in self?.closeRequest() }, connection: connection, inventoryRuntime: runtime))
            runtime.start()
        }
    }
    #endif

    convenience init(candidate: CatalogCandidateRuntime.Configuration, coordinator: UpdateInstallCoordinator) {
        let track = Analytics.connectedTracker(profile: candidate.profile)
        let installer = CatalogSkillInstaller(managedInstaller: ManagedSkillInstaller(
            managedRoot: candidate.managedRoot, pathAnchor: candidate.home), filesystemPaths: candidate.paths)
        let service = CatalogInstallFlowService(records: CatalogInstallRecordClient(catalogCandidate: candidate),
            installer: CatalogInstallService(installer: installer))
        self.init(model: CatalogInstallModel(service: service, coordinator: coordinator, client: .product, track: track),
            website: candidate.profile.website)
        if let connected = candidate.connected {
            let authorizer = WebAuthenticationSession(anchorProvider: { [weak self] in self?.window },
                onReturn: { [weak self] in self?.showStatus() })
            do {
                let runtime = try connected.makeRuntime(paths: candidate.paths, authorizer: authorizer,
                    coordinator: coordinator, automation: .live(paths: candidate.paths), track: track)
                connectedRuntime = runtime
                runtime.observeInstalls(in: model)
                window.contentView = NSHostingView(rootView: CatalogInstallView(model: model,
                    close: { [weak self] in self?.closeRequest() }, connection: runtime.connection, inventoryRuntime: runtime))
                runtime.start()
            } catch {
                track(.setupFailed)
                window.contentView = NSHostingView(rootView: CatalogInstallView(model: model,
                    close: { [weak self] in self?.closeRequest() },
                    connectionSetupError: CatalogInstallView.connectionSetupFailureMessage))
            }
        }
    }

    init(model: CatalogInstallModel, website: URL) {
        self.model = model
        self.website = website
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 580, height: 370),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        window.title = model.appName
        window.contentMinSize = NSSize(width: 480, height: 320)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = NSHostingView(rootView: CatalogInstallView(model: model, close: { [weak self] in self?.closeRequest() }))
        window.center()
        statusItem.button?.title = model.client == .product ? "OMG" : "F1"
        statusItem.button?.toolTip = model.appName + " - catalog installation"
        let menu = NSMenu()
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
        menu.addItem(withTitle: model.appName + " " + version, action: nil, keyEquivalent: "")
        addItem("Status", action: #selector(showStatus), to: menu)
        addItem("Open website", action: #selector(openWebsite), to: menu)
        menu.addItem(.separator())
        addItem("Quit " + model.appName, action: #selector(quit), to: menu)
        statusItem.menu = menu
    }

    private func addItem(_ title: String, action: Selector, to menu: NSMenu) {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: "")
        item.target = self
    }

    func receive(_ url: URL) {
        if connectedRuntime != nil && url.absoluteString == "omgskills://connect" { showStatus(); return }
        if connectedRuntime?.receivePairingCallback(url) == true { showStatus(); return }
        model.receive(url)
        showStatus()
    }
    func stopReporting() async {
        await connectedRuntime?.stop()
    }
    @objc func showStatus() { NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil) }
    @objc private func openWebsite() { NSWorkspace.shared.open(website) }
    @objc private func quit() { NSApp.terminate(nil) }
    func configureUpdates(_ updater: CatalogCandidateUpdater) {
        guard appUpdater == nil, model.client == .product, let menu = statusItem.menu else { return }
        appUpdater = updater
        let item = NSMenuItem(title: "Check for app updates...", action: #selector(checkForAppUpdates), keyEquivalent: "")
        item.target = self
        menu.insertItem(item, at: menu.numberOfItems - 2)
    }

    @objc private func checkForAppUpdates() { appUpdater?.check(); showStatus() }
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(checkForAppUpdates) { return appUpdater?.canCheck == true }
        return menuItem.action != #selector(quit) || model.canClose
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { closeRequest(); return false }
    private func closeRequest() {
        guard model.canClose else { return }
        let request = model.request
        let phase = model.phase
        Task { [weak self] in
            guard let self, model.request == request, model.phase == phase else { return }
            if await model.close(), model.phase == .idle { window.orderOut(nil) }
        }
    }
}
#endif
