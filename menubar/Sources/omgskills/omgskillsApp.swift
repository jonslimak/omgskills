import SwiftUI
import AppKit
import KeyboardShortcuts
import Sparkle

@main
struct OmgskillsApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, SPUUpdaterDelegate {
    private let f1Mode = AppRuntimeConfiguration.f1Mode()
    private let setupTestMode = SetupTestRuntime.mode()
    private let catalogInstallMode = AppRuntimeConfiguration.catalogInstallMode()
    private let catalogCandidateMode = CatalogCandidateRuntime.mode()
    private let connectedInventoryMode = AppRuntimeConfiguration.connectedInventoryMode()
    #if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
    private var catalogInstallController: CatalogInstallWindowController?
    private var pendingCatalogInstallURL: URL?
    private var pendingConnectedURLs: [URL] = []
    #endif
    #if OMGSKILLS_CATALOG_CANDIDATE
    private var catalogCandidateUpdater: CatalogCandidateUpdater?
    private var catalogCandidateUpdaterStarted = false
    #endif
    #if DEBUG || OMGSKILLS_SETUP_TEST
    private var f1Controller: PublicSkillInstallWindowController?
    private var pendingF1URL: URL?
    #endif
    #if OMGSKILLS_SETUP_TEST
    private var setupTestUpdater: SetupTestUpdater?
    private var setupTestUpdaterStarted = false
    #endif
    nonisolated static let debugAppcastURLEnvironmentKey = "OMGSKILLS_DEBUG_APPCAST_URL"
    private static let libraryRefreshTimerInterval: TimeInterval = 60 * 60
    private let skillGroupsBuildSupported = AppRuntimeConfiguration.skillGroupsAuthSupported
    private var statusItem: NSStatusItem!
    private var panel: NSPanel!
    private var clickMonitor: Any?
    private var updaterController: SPUStandardUpdaterController!
    private let updateInstallCoordinator = UpdateInstallCoordinator()
    private lazy var updateInstallHandler = UpdateInstallHandler(coordinator: updateInstallCoordinator)
    private var libraryRefreshScheduler: NSBackgroundActivityScheduler?
    private var libraryRefreshTask: Task<Void, Never>?
    private var libraryRefreshTimer: Timer?
    private var workspaceDidWakeObserver: NSObjectProtocol?
    private var skillGroupsFeatureRefreshTask: Task<Void, Never>?
    private var skillGroupsFeatureRefreshID: UUID?
    private var hasFinishedLaunching = false
    private var isSharePickerActive = false
    private var pendingSkillGroupsURLs: [URL] = []
    private var pendingGroupInstallRoute: DeviceGroupManifestRoute?
    private let runtimeContext = AppRuntimeConfiguration.runtimeContext
    private var groupInstallRuntimePaths: GroupInstallRuntimePaths {
        runtimeContext.groupInstallRuntimePaths
    }
    private lazy var deviceCredentialStore = DeviceCredentialStore(
        service: DeviceCredentialStore.configuredService()
    )
    private lazy var browserPairingSession = WebAuthenticationSession(
        anchorProvider: { [weak self] in self?.panel },
        onReturn: { [weak self] in self?.showPanelAfterAuthentication() }
    )
    private lazy var deviceConnectionModel = DeviceConnectionModel(
        credentialStore: deviceCredentialStore,
        browserAuthorizer: browserPairingSession,
        updateCoordinator: updateInstallCoordinator
    )
    private lazy var skillGroupsFeatureAvailability = SkillGroupsFeatureAvailability(
        buildSupportsSkillGroups: skillGroupsBuildSupported
    )
    private lazy var groupInstallFlowModel: GroupInstallFlowModel? = {
        guard skillGroupsBuildSupported else { return nil }
        return GroupInstallFlowModel(credentialStore: deviceCredentialStore)
    }()
    private lazy var managedSkillInstaller = ManagedSkillInstaller(
        managedRoot: groupInstallRuntimePaths.managedRoot,
        pathAnchor: groupInstallRuntimePaths.pathAnchor
    )
    private lazy var groupSnapshotInstaller: any GroupSnapshotInstalling = managedSkillInstaller
    private lazy var catalogSkillInstaller: any CatalogSkillInstalling = CatalogSkillInstaller(
        managedInstaller: managedSkillInstaller,
        filesystemPaths: runtimeContext.skillFilesystemPaths
    )

    func applicationDidFinishLaunching(_ notification: Notification) {
        switch connectedInventoryMode {
        case .invalid(let reason):
            let alert = NSAlert()
            alert.messageText = "Cannot start connected inventory test"
            alert.informativeText = reason
            alert.runModal()
            NSApp.terminate(nil)
            return
        case .enabled(let configuration):
            #if DEBUG
            do {
                let controller = try CatalogInstallWindowController(root: configuration.root,
                    website: configuration.website, coordinator: updateInstallCoordinator, connected: configuration)
                catalogInstallController = controller
                pendingConnectedURLs.forEach(controller.receive)
                pendingConnectedURLs.removeAll()
            } catch {
                let alert = NSAlert()
                alert.messageText = "Cannot start connected inventory test"
                alert.informativeText = error.localizedDescription
                alert.runModal()
                NSApp.terminate(nil)
            }
            #endif
            return
        case .disabled: break
        }
        switch catalogCandidateMode {
        case .invalid(let reason):
            let alert = NSAlert()
            alert.messageText = "Cannot start OMGSkills Candidate"
            alert.informativeText = reason
            alert.runModal()
            NSApp.terminate(nil)
            return
        case .enabled(let configuration):
            #if OMGSKILLS_CATALOG_CANDIDATE
            let controller = CatalogInstallWindowController(candidate: configuration, coordinator: updateInstallCoordinator)
            catalogInstallController = controller
            let updater = CatalogCandidateUpdater(model: controller.model) { [weak self] in
                guard let self else { throw Self.catalogCandidateUpdateUnavailable() }
                try checkCatalogCandidateUpdates()
            }
            catalogCandidateUpdater = updater
            controller.configureUpdates(updater)
            if let pendingCatalogInstallURL {
                controller.receive(pendingCatalogInstallURL)
                self.pendingCatalogInstallURL = nil
            }
            #endif
            return
        case .disabled: break
        }
        switch catalogInstallMode {
        case .invalid(let reason):
            let alert = NSAlert()
            alert.messageText = "Cannot start catalog install test"
            alert.informativeText = reason
            alert.runModal()
            NSApp.terminate(nil)
            return
        case .enabled(let root, let website):
            #if DEBUG
            do {
                catalogInstallController = try CatalogInstallWindowController(root: root, website: website,
                    coordinator: updateInstallCoordinator)
                if let pendingCatalogInstallURL {
                    catalogInstallController?.receive(pendingCatalogInstallURL)
                    self.pendingCatalogInstallURL = nil
                }
            } catch {
                let alert = NSAlert()
                alert.messageText = "Cannot start catalog install test"
                alert.informativeText = error.localizedDescription
                alert.runModal()
                NSApp.terminate(nil)
            }
            #endif
            return
        case .disabled: break
        }
        switch setupTestMode {
        case .invalid(let reason):
            refuseSetupTestLaunch(reason)
            return
        case .enabled(let configuration):
            #if OMGSKILLS_SETUP_TEST
            do {
                try configuration.prepareStorage()
                f1Controller = PublicSkillInstallWindowController(service: try .setupTest(configuration),
                    website: configuration.website, client: .setupTest)
                if configuration.updatesEnabled, let f1Controller {
                    let updater = SetupTestUpdater(model: f1Controller.model) { [weak self] in
                        guard let self else { throw Self.setupUpdateUnavailable() }
                        try self.checkSetupTestUpdates()
                    }
                    setupTestUpdater = updater
                    f1Controller.configureUpdates(updater)
                }
                if let pendingF1URL { f1Controller?.receive(pendingF1URL); self.pendingF1URL = nil }
                else { f1Controller?.showReview() }
            } catch { refuseSetupTestLaunch(error.localizedDescription) }
            #endif
            return
        case .disabled: break
        }
        switch f1Mode {
        case .invalid(let reason):
            let alert = NSAlert()
            alert.messageText = "Cannot start OMGSkills F1 Test"
            alert.informativeText = reason
            alert.runModal()
            NSApp.terminate(nil)
            return
        case .enabled(let root, let website):
            #if DEBUG
            f1Controller = PublicSkillInstallWindowController(root: root, website: website)
            if let pendingF1URL { f1Controller?.receive(pendingF1URL); self.pendingF1URL = nil }
            else { f1Controller?.showReview() }
            #endif
            return
        case .disabled: break
        }
        if case .invalid(let reason) = runtimeContext.catalogTestMode {
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = "Invalid catalog test mode"
            alert.informativeText = reason
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        let usesBundledLibraryPreview = runtimeContext.usesBundledLibraryPreview
        Analytics.start()
        let shouldStartUpdater = !usesBundledLibraryPreview
        setupUpdater(startingUpdater: shouldStartUpdater)
        if Self.shouldCheckForUpdatesInBackground(updaterStarted: shouldStartUpdater) {
            checkForUpdatesInBackground()
        }
        setupStatusItem()
        setupPanel()
        setupGlobalHotkey()
        hasFinishedLaunching = true
        refreshSkillGroupsFeatureAvailability()
        if !usesBundledLibraryPreview {
            setupLibraryRefreshObservers()
            setupLibraryRefreshTimer()
            setupLibraryRefreshScheduler()
            triggerLibraryRefreshIfNeeded()
        }

        NotificationCenter.default.addObserver(
            forName: .detailToggled, object: nil, queue: .main
        ) { [weak self] note in
            let show = (note.userInfo?["showDetail"] as? Bool) ?? false
            let width: CGFloat = show ? 750 : 400
            Task { @MainActor [weak self] in
                self?.repositionPanel(width: width, animate: true)
            }
        }

        NotificationCenter.default.addObserver(
            forName: .sharePickerDidOpen, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.isSharePickerActive = true
            }
        }

        NotificationCenter.default.addObserver(
            forName: .sharePickerDidClose, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.isSharePickerActive = false
            }
        }
    }

    private func refuseSetupTestLaunch(_ reason: String) {
        let alert = NSAlert()
        alert.messageText = "Cannot start OMGSkills Setup Test"
        alert.informativeText = reason
        alert.runModal()
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        skillGroupsFeatureRefreshTask?.cancel()
        libraryRefreshTask?.cancel()
        libraryRefreshTimer?.invalidate()
        libraryRefreshTimer = nil
        if let workspaceDidWakeObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(workspaceDidWakeObserver)
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        #if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
        if let catalogInstallController {
            guard catalogInstallController.model.canClose else { return .terminateCancel }
            Task {
                let closed = await catalogInstallController.model.close()
                if closed { await catalogInstallController.stopReporting() }
                sender.reply(toApplicationShouldTerminate: closed)
            }
            return .terminateLater
        }
        #endif
        #if DEBUG || OMGSKILLS_SETUP_TEST
        if let f1Controller {
            guard !f1Controller.model.isApplying, f1Controller.model.phase != .cancelling else { return .terminateCancel }
            Task {
                await f1Controller.model.cancel()
                sender.reply(toApplicationShouldTerminate: true)
            }
            return .terminateLater
        }
        #endif
        return .terminateNow
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        guard hasFinishedLaunching else { return }
        refreshSkillGroupsFeatureAvailability()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        if connectedInventoryMode != .disabled {
            #if DEBUG
            if case .enabled = connectedInventoryMode {
                if let catalogInstallController { urls.forEach(catalogInstallController.receive) }
                else { pendingConnectedURLs.append(contentsOf: urls) }
            }
            #endif
            return
        }
        if catalogCandidateMode != .disabled {
            #if OMGSKILLS_CATALOG_CANDIDATE
            if case .enabled = catalogCandidateMode, let url = urls.first {
                if let catalogInstallController { catalogInstallController.receive(url) }
                else if pendingCatalogInstallURL == nil { pendingCatalogInstallURL = url }
            }
            #endif
            return
        }
        if catalogInstallMode != .disabled {
            #if DEBUG
            if case .enabled = catalogInstallMode, let url = urls.first {
                if let catalogInstallController { catalogInstallController.receive(url) }
                else if pendingCatalogInstallURL == nil { pendingCatalogInstallURL = url }
            }
            #endif
            return
        }
        if setupTestMode != .disabled {
            #if OMGSKILLS_SETUP_TEST
            if case .enabled = setupTestMode, let url = urls.first {
                if let f1Controller { f1Controller.receive(url) }
                else if pendingF1URL == nil { pendingF1URL = url }
            }
            #endif
            return
        }
        if f1Mode != .disabled {
            #if DEBUG
            if case .enabled = f1Mode, let url = urls.first {
                if let f1Controller { f1Controller.receive(url) }
                else if pendingF1URL == nil { pendingF1URL = url }
            }
            #endif
            return
        }
        for url in urls {
            guard GroupInstallDeepLink.classify(url) != .unsupported else { continue }
            switch skillGroupsFeatureAvailability.deepLinkDisposition {
            case .handle:
                handleSkillGroupsURL(url)
            case .queueUntilResolved:
                if !pendingSkillGroupsURLs.contains(url) {
                    pendingSkillGroupsURLs.append(url)
                }
            case .discard:
                break
            }
        }
    }

    private func handleSkillGroupsURL(_ url: URL) {
        switch GroupInstallDeepLink.classify(url) {
        case .group(let route):
            openGroupInstall(route)
        case .pairing(let callbackURL):
            _ = browserPairingSession.handleCallback(callbackURL)
        case .unsupported:
            break
        }
    }

    private func refreshSkillGroupsFeatureAvailability() {
        guard skillGroupsBuildSupported, skillGroupsFeatureRefreshTask == nil else { return }
        let refreshID = UUID()
        let wasEnabled = skillGroupsFeatureAvailability.isEnabled
        skillGroupsFeatureRefreshID = refreshID
        skillGroupsFeatureRefreshTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let isEnabled = await skillGroupsFeatureAvailability.refresh()
            guard !Task.isCancelled, skillGroupsFeatureRefreshID == refreshID else { return }
            skillGroupsFeatureRefreshID = nil
            skillGroupsFeatureRefreshTask = nil
            applySkillGroupsFeatureAvailability(isEnabled, wasEnabled: wasEnabled)
        }
    }

    private func applySkillGroupsFeatureAvailability(_ isEnabled: Bool, wasEnabled: Bool) {
        if isEnabled {
            if !wasEnabled {
                deviceConnectionModel.restore()
            }
            let pendingURLs = pendingSkillGroupsURLs
            pendingSkillGroupsURLs.removeAll()
            pendingURLs.forEach(handleSkillGroupsURL)
            return
        }

        pendingSkillGroupsURLs.removeAll()
        pendingGroupInstallRoute = nil
        groupInstallFlowModel?.dismiss()
        if wasEnabled {
            browserPairingSession.cancel()
            deviceConnectionModel.cancelCurrentOperation()
        }
    }

    private func setupUpdater(startingUpdater: Bool) {
        updaterController = SPUStandardUpdaterController(
            startingUpdater: startingUpdater,
            updaterDelegate: self,
            userDriverDelegate: nil
        )
    }

    nonisolated static func shouldCheckForUpdatesInBackground(updaterStarted: Bool) -> Bool {
        updaterStarted
    }

    private func checkForUpdatesInBackground() {
        updaterController.updater.checkForUpdatesInBackground()
    }

    #if OMGSKILLS_CATALOG_CANDIDATE
    private static func catalogCandidateUpdateUnavailable() -> NSError {
        NSError(domain: "com.jonslimak.omgskills.catalog-candidate.updates", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Finish pending work before checking for candidate app updates."])
    }

    private func checkCatalogCandidateUpdates() throws {
        guard case .enabled = catalogCandidateMode, catalogCandidateUpdater?.phase == .checking,
              catalogCandidateUpdater?.permitsUpdate == true else { throw Self.catalogCandidateUpdateUnavailable() }
        if updaterController == nil { setupUpdater(startingUpdater: false) }
        if !catalogCandidateUpdaterStarted {
            // Candidate runs are VM-only; never inherit automatic checks from the product defaults.
            updaterController.updater.automaticallyChecksForUpdates = false
            updaterController.updater.automaticallyDownloadsUpdates = false
            updaterController.updater.sendsSystemProfile = false
            try updaterController.updater.start()
            catalogCandidateUpdaterStarted = true
        }
        guard updaterController.updater.canCheckForUpdates else { throw Self.catalogCandidateUpdateUnavailable() }
        updaterController.checkForUpdates(nil)
    }
    #endif

    #if OMGSKILLS_SETUP_TEST
    private static func setupUpdateUnavailable() -> NSError {
        NSError(domain: "com.jonslimak.omgskills.setuptest.updates", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Close the skill review and finish pending work before checking for app updates."])
    }

    private func checkSetupTestUpdates() throws {
        guard setupTestUpdater?.phase == .checking, setupTestUpdater?.permitsUpdate == true else {
            throw Self.setupUpdateUnavailable()
        }
        if updaterController == nil { setupUpdater(startingUpdater: false) }
        if !setupTestUpdaterStarted {
            // Ignore persisted automatic-check preferences only in this isolated test identity.
            updaterController.updater.automaticallyChecksForUpdates = false
            updaterController.updater.automaticallyDownloadsUpdates = false
            updaterController.updater.sendsSystemProfile = false
            try updaterController.updater.start()
            setupTestUpdaterStarted = true
        }
        guard updaterController.updater.canCheckForUpdates else { throw Self.setupUpdateUnavailable() }
        updaterController.checkForUpdates(nil)
    }
    #endif

    private func setupLibraryRefreshObservers() {
        workspaceDidWakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.triggerLibraryRefreshIfNeeded(trigger: .wake)
            }
        }
    }

    private func setupLibraryRefreshTimer() {
        let timer = Timer(timeInterval: Self.libraryRefreshTimerInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.triggerLibraryRefreshIfNeeded(trigger: .timer)
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        libraryRefreshTimer = timer
    }

    private func setupLibraryRefreshScheduler() {
        let scheduler = NSBackgroundActivityScheduler(identifier: "com.jonslimak.omgskills.library-refresh")
        scheduler.repeats = true
        scheduler.interval = 24 * 60 * 60
        scheduler.tolerance = 60 * 60
        scheduler.schedule { completion in
            Task { @MainActor [weak self] in
                self?.triggerLibraryRefreshIfNeeded(trigger: .scheduler) {
                    completion(.finished)
                }
            }
        }
        libraryRefreshScheduler = scheduler
    }

    private func triggerLibraryRefreshIfNeeded(
        trigger: DataRefreshService.RefreshTrigger = .launch,
        force: Bool = false,
        onCompletion: (() -> Void)? = nil
    ) {
        guard !AppRuntimeConfiguration.usesBundledLibraryPreview else {
            onCompletion?()
            return
        }
        guard Self.shouldStartLibraryRefresh(isRefreshActive: libraryRefreshTask != nil) else {
            onCompletion?()
            return
        }

        libraryRefreshTask = Task { [weak self] in
            let result = await DataRefreshService.refreshIfNeeded(trigger: trigger, force: force)
            guard !Task.isCancelled else { return }
            if result == .updated {
                Analytics.signal("data.refreshed")
                NotificationCenter.default.post(name: .libraryDataDidRefresh, object: nil)
            }
            self?.libraryRefreshTask = nil
            onCompletion?()
        }
    }

    nonisolated static func shouldStartLibraryRefresh(isRefreshActive: Bool) -> Bool {
        !isRefreshActive
    }

    nonisolated static func shouldRunLibraryRefreshTimer(interval: TimeInterval) -> Bool {
        interval > 0
    }

    private func setupGlobalHotkey() {
        KeyboardShortcuts.onKeyDown(for: .togglePopover) { [weak self] in
            self?.togglePanel()
        }
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            let image = NSImage(systemSymbolName: "eyes", accessibilityDescription: "omgskills")
            image?.isTemplate = true
            button.image = image
            button.action = #selector(togglePanel)
            button.target = self
        }
    }

    private func setupPanel() {
        let hostingView = NSHostingView(
            rootView: ContentView(
                deviceConnectionModel: deviceConnectionModel,
                updateInstallCoordinator: updateInstallCoordinator,
                skillGroupsFeatureAvailability: skillGroupsFeatureAvailability,
                groupInstallFlowModel: groupInstallFlowModel,
                groupSnapshotInstaller: groupSnapshotInstaller,
                catalogSkillInstaller: catalogSkillInstaller,
                runtimeContext: runtimeContext
            )
        )
        hostingView.wantsLayer = true
        hostingView.layer?.cornerRadius = 20
        hostingView.layer?.masksToBounds = true

        panel = FloatingPanel(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 855),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = hostingView
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.becomesKeyOnlyIfNeeded = true

        if let pendingGroupInstallRoute {
            self.pendingGroupInstallRoute = nil
            openGroupInstall(pendingGroupInstallRoute)
        }
    }

    private func openGroupInstall(_ route: DeviceGroupManifestRoute) {
        guard skillGroupsFeatureAvailability.isEnabled, let groupInstallFlowModel else { return }
        guard panel != nil else {
            pendingGroupInstallRoute = route
            return
        }
        showPanelAfterAuthentication()
        groupInstallFlowModel.open(route)
    }

    @objc private func togglePanel() {
        if panel.isVisible {
            closePopover()
        } else {
            refreshSkillGroupsFeatureAvailability()
            repositionPanel(width: 400, animate: false)
            panel.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            NotificationCenter.default.post(name: .popoverDidOpen, object: nil)
            triggerLibraryRefreshIfNeeded(trigger: .panelOpen)
            addClickOutsideMonitor()
        }
    }

    private func showPanelAfterAuthentication() {
        let width = panel.frame.width > 0 ? panel.frame.width : 400
        repositionPanel(width: width, animate: false)
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .popoverDidOpen, object: nil)
        addClickOutsideMonitor()
    }

    nonisolated static func debugAppcastFeedURLString(environment: [String: String] = ProcessInfo.processInfo.environment) -> String? {
        #if OMGSKILLS_DEBUG_APPCAST_OVERRIDE
        guard let rawValue = environment[debugAppcastURLEnvironmentKey]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawValue.isEmpty,
              let url = URL(string: rawValue),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else {
            return nil
        }

        return rawValue
        #else
        return nil
        #endif
    }

    private func repositionPanel(width: CGFloat, animate: Bool) {
        guard let button = statusItem.button, let buttonWindow = button.window else { return }
        let buttonRect = button.convert(button.bounds, to: nil)
        let screenRect = buttonWindow.convertToScreen(buttonRect)

        let visibleFrame = buttonWindow.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? buttonWindow.screen?.frame ?? .zero
        let horizontalPadding: CGFloat = 20
        let proposedX = screenRect.midX - width / 2
        let minX = visibleFrame.minX + horizontalPadding
        let maxX = max(minX, visibleFrame.maxX - width - horizontalPadding)
        let x = min(max(proposedX, minX), maxX)
        let y = screenRect.minY - 855 - 4

        let newFrame = NSRect(x: x, y: y, width: width, height: 855)
        if animate && panel.isVisible {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.15
                ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                panel.animator().setFrame(newFrame, display: true)
            }
        } else {
            panel.setFrame(newFrame, display: true)
        }
    }

    private func addClickOutsideMonitor() {
        guard clickMonitor == nil else { return }
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard self?.isSharePickerActive != true else { return }
            self?.closePopover()
        }
    }

    private func removeClickOutsideMonitor() {
        if let monitor = clickMonitor {
            NSEvent.removeMonitor(monitor)
            clickMonitor = nil
        }
    }

    func closePopover() {
        panel.orderOut(nil)
        removeClickOutsideMonitor()
    }

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        #if OMGSKILLS_CATALOG_CANDIDATE
        if catalogCandidateMode != .disabled { return }
        #endif
        #if OMGSKILLS_SETUP_TEST
        if setupTestMode != .disabled { return }
        #endif
        Analytics.signal(
            "app.update_found",
            parameters: Analytics.updateParameters(
                targetVersion: item.displayVersionString,
                targetBuild: item.versionString
            )
        )
    }

    func feedURLString(for updater: SPUUpdater) -> String? {
        #if OMGSKILLS_CATALOG_CANDIDATE
        if catalogCandidateMode != .disabled { return CatalogCandidateRuntime.feedURL }
        #endif
        #if OMGSKILLS_SETUP_TEST
        if setupTestMode != .disabled { return SetupTestUpdateConfiguration.feedURL }
        #endif
        return Self.debugAppcastFeedURLString()
    }

    func allowedSystemProfileKeys(for updater: SPUUpdater) -> [String]? {
        #if OMGSKILLS_CATALOG_CANDIDATE
        if catalogCandidateMode != .disabled { return [] }
        #endif
        #if OMGSKILLS_SETUP_TEST
        if setupTestMode != .disabled { return [] }
        #endif
        return nil
    }

    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        #if OMGSKILLS_CATALOG_CANDIDATE
        if catalogCandidateMode != .disabled {
            guard updateCheck == .updates, catalogCandidateUpdater?.phase == .checking,
                  catalogCandidateUpdater?.permitsUpdate == true else { throw Self.catalogCandidateUpdateUnavailable() }
        }
        #endif
        #if OMGSKILLS_SETUP_TEST
        if setupTestMode != .disabled {
            guard updateCheck == .updates, setupTestUpdater?.phase == .checking,
                  setupTestUpdater?.permitsUpdate == true else { throw Self.setupUpdateUnavailable() }
        }
        #endif
    }

    func updater(_ updater: SPUUpdater, shouldProceedWithUpdate item: SUAppcastItem,
                 updateCheck: SPUUpdateCheck) throws {
        #if OMGSKILLS_CATALOG_CANDIDATE
        if catalogCandidateMode != .disabled {
            try self.updater(updater, mayPerform: updateCheck)
            guard CatalogCandidateRuntime.acceptsArchive(url: item.fileURL, build: item.versionString,
                version: item.displayVersionString, installationType: item.installationType, isDelta: item.isDeltaUpdate)
            else { throw Self.catalogCandidateUpdateUnavailable() }
        }
        #endif
        #if OMGSKILLS_SETUP_TEST
        if setupTestMode != .disabled {
            try self.updater(updater, mayPerform: updateCheck)
            guard SetupTestUpdateConfiguration.acceptsArchive(url: item.fileURL, build: item.versionString,
                version: item.displayVersionString, installationType: item.installationType, isDelta: item.isDeltaUpdate) else {
                throw Self.setupUpdateUnavailable()
            }
        }
        #endif
    }

    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        #if OMGSKILLS_CATALOG_CANDIDATE
        catalogCandidateUpdater?.installationStarted()
        #endif
        #if OMGSKILLS_SETUP_TEST
        setupTestUpdater?.installationStarted()
        #endif
    }

    func updater(_ updater: SPUUpdater, userDidMake choice: SPUUserUpdateChoice,
                 forUpdate item: SUAppcastItem, state: SPUUserUpdateState) {
        #if OMGSKILLS_CATALOG_CANDIDATE
        if state.stage == .installing { catalogCandidateUpdater?.installationStarted() }
        #endif
        #if OMGSKILLS_SETUP_TEST
        if state.stage == .installing { setupTestUpdater?.installationStarted() }
        #endif
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: (any Error)?) {
        #if OMGSKILLS_CATALOG_CANDIDATE
        if catalogCandidateMode != .disabled {
            guard updateCheck == .updates else { return }
            let error = error as NSError?
            let failed = error != nil && !(error?.domain == SUSparkleErrorDomain && error?.code == Int(SUError.noUpdateError.rawValue))
            catalogCandidateUpdater?.finish(failed: failed)
            return
        }
        #endif
        #if OMGSKILLS_SETUP_TEST
        guard updateCheck == .updates else { return }
        let error = error as NSError?
        let failed = error != nil && !(error?.domain == SUSparkleErrorDomain && error?.code == Int(SUError.noUpdateError.rawValue))
        setupTestUpdater?.finish(failed: failed)
        #endif
    }

    func updater(
        _ updater: SPUUpdater,
        willInstallUpdateOnQuit item: SUAppcastItem,
        immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
    ) -> Bool {
        #if OMGSKILLS_CATALOG_CANDIDATE
        if catalogCandidateMode != .disabled {
            guard catalogCandidateUpdater?.permitsUpdate == true else { return true }
            catalogCandidateUpdater?.installationStarted()
            return updateInstallCoordinator.requestInstall(targetVersion: item.displayVersionString,
                targetBuild: item.versionString) {
                immediateInstallHandler()
            }
        }
        #endif
        #if OMGSKILLS_SETUP_TEST
        if setupTestMode != .disabled {
            // Retain the skill lock once replacement is pending, even if Sparkle's UI is dismissed.
            guard setupTestUpdater?.permitsUpdate == true else { return true }
            setupTestUpdater?.installationStarted()
            immediateInstallHandler()
            return true
        }
        #endif
        return updateInstallHandler.handleInstallOnQuit(
            targetVersion: item.displayVersionString,
            targetBuild: item.versionString
        ) {
            immediateInstallHandler()
        }
    }

}

final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

extension Notification.Name {
    static let popoverDidOpen = Notification.Name("popoverDidOpen")
    static let detailToggled = Notification.Name("detailToggled")
    static let libraryDataDidRefresh = Notification.Name("libraryDataDidRefresh")
    static let sharePickerDidOpen = Notification.Name("sharePickerDidOpen")
    static let sharePickerDidClose = Notification.Name("sharePickerDidClose")
}
