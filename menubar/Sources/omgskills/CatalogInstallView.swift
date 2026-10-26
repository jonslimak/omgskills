#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI
import AppKit

struct CatalogInstallView: View {
    let model: CatalogInstallModel
    let close: () -> Void
    let hide: () -> Void
    var showAppMenu: (() -> Void)? = nil
    var showStatus: (() -> Void)? = nil
    var openWebsite: () -> Void = {}
    var quit: () -> Void = {}
    var appUpdater: CatalogCandidateUpdater? = nil
    var showsOptions = false
    var resizePanel: (CGFloat) -> Void = { _ in }
    var connection: DeviceConnectionModel? = nil
    var inventoryRuntime: ConnectedInventoryRuntime? = nil
    var connectionSetupError: String? = nil

    static let connectionSetupFailureMessage = "Account connection is unavailable. Skill installation is still available."
    static let panelWidth: CGFloat = 210
    static let panelPadding: CGFloat = 12
    static let iconButtonSize: CGFloat = 28
    static let iconColumnWidth: CGFloat = 16
    static let maximumPanelHeight: CGFloat = 440
    static let initialPanelHeight: CGFloat = 120
    @State private var contentHeight: CGFloat = CatalogInstallView.initialPanelHeight

    static func fittedPanelHeight(_ height: CGFloat) -> CGFloat {
        min(max(ceil(height), 1), maximumPanelHeight)
    }

    var body: some View {
        ScrollView {
            Group {
                if showsOptions { optionsContent }
                else { statusContent }
            }.frame(width: Self.panelWidth - 2 * Self.panelPadding, alignment: .leading)
                .padding(Self.panelPadding)
                .fixedSize(horizontal: false, vertical: true)
                .background {
                    GeometryReader { geometry in
                        Color.clear.onAppear { fitHeight(geometry.size.height) }
                            .onChange(of: geometry.size.height) { _, height in fitHeight(height) }
                    }
                }
        }.frame(width: Self.panelWidth, height: contentHeight)
            .onExitCommand(perform: hide)
    }

    private func fitHeight(_ height: CGFloat) {
        guard height.isFinite else { return }
        let fitted = Self.fittedPanelHeight(height)
        if contentHeight != fitted { contentHeight = fitted }
        resizePanel(fitted)
    }

    private var statusContent: some View {
        Group {
            if model.phase != .idle { installContent }
            else { accountContent }
        }
    }

    private var accountContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 8) {
                if let connection, case .connected(let info) = connection.state {
                    Text(info.accountLabel).font(.headline).textSelection(.enabled)
                }
                Spacer()
                if let showAppMenu {
                    Button(action: showAppMenu) {
                        Label("App menu", systemImage: "ellipsis").labelStyle(.iconOnly)
                            .frame(width: Self.iconButtonSize, height: Self.iconButtonSize, alignment: .trailing)
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain).help("App menu")
                }
            }.frame(minHeight: Self.iconButtonSize)
            VStack(alignment: .leading, spacing: 16) {
                if let connection {
                    ConnectedInventoryView(model: connection, deviceName: Host.current().localizedName ?? "Test Mac", runtime: inventoryRuntime)
                }
                if let connectionSetupError {
                    Text(connectionSetupError).font(.callout).foregroundStyle(.red)
                }
                if model.message != "Ready" { Text(model.message).font(.callout).textSelection(.enabled) }
                if !model.notice.isEmpty { Text(model.notice).font(.callout).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var installContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let name = model.record?.name {
                Text(name).font(.headline).textSelection(.enabled)
            }
            if let record = model.record {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Source")
                    Text(record.githubURL).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }
            }
            if let destination = model.destination {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Install in")
                    Text(destination.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }
            }
            if model.hasFailure || model.phase == .loading || model.phase == .cancelling
                || (model.phase == .confirm && model.message != "Ready to install in \(model.request?.target.rawValue ?? "").") {
                HStack(alignment: .top, spacing: 10) {
                    if model.isWorking { ProgressView().controlSize(.small) }
                    else if model.hasFailure {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
                    }
                    Text(model.message).foregroundStyle(model.hasFailure ? Color.red : Color.primary)
                        .textSelection(.enabled)
                }
            }
            if !model.notice.isEmpty { Text(model.notice).font(.callout).foregroundStyle(.secondary) }
            if model.result == .installed, model.request?.target == .codex {
                Text("Restart Codex if the skill does not appear.").font(.caption).foregroundStyle(.secondary)
            }
            VStack(spacing: 8) {
                if model.ownsRequest {
                    Button(action: close) { Text("Cancel").frame(maxWidth: .infinity) }
                        .disabled(!model.canClose)
                } else if model.phase == .result {
                    Button(action: close) { Text("Done").frame(maxWidth: .infinity) }
                }
                if let target = model.request?.target {
                    if model.phase == .confirm {
                        Button(action: model.install) { Text("Install in " + target.rawValue).frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    } else if model.phase == .rechecking || model.phase == .installing {
                        Button {} label: { Text("Installing...").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent).disabled(true)
                    } else if model.result == .installed || model.result == .alreadyInstalled {
                        Label(model.message, systemImage: "checkmark")
                            .frame(maxWidth: .infinity).padding(.vertical, 6).padding(.horizontal, 4)
                            .foregroundStyle(.white).background(.green, in: RoundedRectangle(cornerRadius: 5))
                    }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var optionsContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            ZStack(alignment: .leading) {
                // Match the row labels while keeping Back's larger click area.
                Label {
                    Text("Options").font(.headline)
                } icon: {
                    Image(systemName: "chevron.left").frame(width: Self.iconColumnWidth)
                        .hidden().accessibilityHidden(true)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Button { showStatus?() } label: {
                    Label("Back to status", systemImage: "chevron.left").labelStyle(.iconOnly)
                        .frame(width: Self.iconColumnWidth)
                        .frame(width: Self.iconButtonSize, height: Self.iconButtonSize, alignment: .leading)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).help("Back to status")
            }.frame(minHeight: Self.iconButtonSize)
            VStack(alignment: .leading, spacing: 16) {
                Button(action: openWebsite) {
                    Label {
                        Text("Open website")
                    } icon: {
                        Image(systemName: "safari").frame(width: Self.iconColumnWidth)
                    }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                }.buttonStyle(.plain)
                if let appUpdater {
                    Button {
                        appUpdater.check()
                        showStatus?()
                    } label: {
                        Label {
                            Text("Check for app updates...")
                        } icon: {
                            Image(systemName: "arrow.down.circle").frame(width: Self.iconColumnWidth)
                        }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }.buttonStyle(.plain).disabled(!appUpdater.canCheck)
                }
                Divider()
                HStack(alignment: .bottom) {
                    Button(action: quit) {
                        Label {
                            Text("Quit")
                        } icon: {
                            Image(systemName: "power").frame(width: Self.iconColumnWidth)
                        }.contentShape(Rectangle())
                    }.buttonStyle(.plain).disabled(!model.canClose)
                    Spacer(minLength: 4)
                    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
                    Text("Version " + version).font(.caption).foregroundStyle(.secondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

@MainActor
final class CatalogInstallWindowController: NSObject, NSPopoverDelegate {
    let model: CatalogInstallModel
    private let website: URL
    private let popover = NSPopover()
    private let contentController: NSHostingController<CatalogInstallView>
    private let statusItem: NSStatusItem
    private var authenticationAnchor: NSWindow?
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
            let authorizer = WebAuthenticationSession(anchorProvider: { [weak self] in self?.browserPresentationAnchor() },
                onReturn: { [weak self] in self?.returnFromBrowser() })
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
            setContent(connection: connection, inventoryRuntime: runtime)
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
            let authorizer = WebAuthenticationSession(anchorProvider: { [weak self] in self?.browserPresentationAnchor() },
                onReturn: { [weak self] in self?.returnFromBrowser() })
            do {
                let runtime = try connected.makeRuntime(paths: candidate.paths, authorizer: authorizer,
                    coordinator: coordinator, automation: .live(paths: candidate.paths), track: track)
                connectedRuntime = runtime
                runtime.observeInstalls(in: model)
                setContent(connection: runtime.connection, inventoryRuntime: runtime)
                runtime.start()
            } catch {
                track(.setupFailed)
                setContent(connectionSetupError: CatalogInstallView.connectionSetupFailureMessage)
            }
        }
    }

    init(model: CatalogInstallModel, website: URL) {
        self.model = model
        self.website = website
        contentController = NSHostingController(rootView: CatalogInstallView(model: model, close: {}, hide: {}))
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        popover.contentViewController = contentController
        popover.contentSize = NSSize(width: CatalogInstallView.panelWidth, height: CatalogInstallView.initialPanelHeight)
        popover.behavior = .transient
        popover.delegate = self
        setContent()
        if let button = statusItem.button, model.client == .product {
            let image = NSImage(systemSymbolName: "eyes", accessibilityDescription: model.appName)
            image?.isTemplate = true
            button.image = image
            button.imagePosition = .imageLeading
            button.title = "*"
            button.setAccessibilityLabel(model.appName)
        } else {
            statusItem.button?.title = "F1"
        }
        statusItem.button?.toolTip = model.appName + " - catalog installation"
        statusItem.button?.target = self
        statusItem.button?.action = #selector(togglePanel)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    private func setContent(connection: DeviceConnectionModel? = nil,
                            inventoryRuntime: ConnectedInventoryRuntime? = nil, connectionSetupError: String? = nil) {
        contentController.rootView = CatalogInstallView(model: model,
            close: { [weak self] in self?.closeRequest() }, hide: { [weak self] in self?.hidePanel() },
            showAppMenu: { [weak self] in self?.showAppMenu() }, showStatus: { [weak self] in self?.showStatus() },
            openWebsite: { [weak self] in self?.openWebsite() }, quit: { [weak self] in self?.quit() },
            appUpdater: appUpdater, resizePanel: { [weak self] in self?.resizePanel(to: $0) }, connection: connection,
            inventoryRuntime: inventoryRuntime, connectionSetupError: connectionSetupError)
    }

    private func browserPresentationAnchor() -> NSWindow? {
        // Keep the login's presentation window alive when the transient panel hides.
        authenticationAnchor = contentController.view.window ?? statusItem.button?.window
        return authenticationAnchor
    }

    private func returnFromBrowser() {
        showStatus()
        authenticationAnchor = nil
    }

    @objc private func togglePanel() {
        if NSApp.currentEvent?.type == .rightMouseUp { showAppMenu(); return }
        if popover.isShown { hidePanel() } else { showStatus() }
    }

    private func showAppMenu() {
        contentController.rootView.showsOptions = true
        presentPanel()
    }

    private func hidePanel() {
        popover.performClose(nil)
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
    @objc func showStatus() {
        contentController.rootView.showsOptions = false
        presentPanel()
    }

    private func presentPanel() {
        guard let button = statusItem.button else { return }
        NSApp.activate()
        if !popover.isShown {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
        contentController.view.window?.makeKey()
    }
    private func resizePanel(to height: CGFloat) {
        let size = NSSize(width: CatalogInstallView.panelWidth, height: CatalogInstallView.fittedPanelHeight(height))
        if popover.contentSize != size { popover.contentSize = size }
    }
    @objc private func openWebsite() { NSWorkspace.shared.open(website) }
    @objc private func quit() {
        guard model.canClose else { return }
        NSApp.terminate(nil)
    }
    func configureUpdates(_ updater: CatalogCandidateUpdater) {
        guard appUpdater == nil, model.client == .product else { return }
        appUpdater = updater
        contentController.rootView.appUpdater = updater
    }

    func popoverShouldDetach(_ popover: NSPopover) -> Bool { false }
    private func closeRequest() {
        guard model.canClose else { return }
        let request = model.request
        let phase = model.phase
        Task { [weak self] in
            guard let self, model.request == request, model.phase == phase else { return }
            if await model.close(), model.phase == .idle { hidePanel() }
        }
    }
}
#endif
