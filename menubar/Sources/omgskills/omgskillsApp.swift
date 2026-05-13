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
    private static let libraryRefreshTimerInterval: TimeInterval = 60 * 60
    private var statusItem: NSStatusItem!
    private var panel: NSPanel!
    private var clickMonitor: Any?
    private var updaterController: SPUStandardUpdaterController!
    private var updateProbeAttempts = 0
    private let updateProbeInterval: TimeInterval = 30 * 60
    private var lastUpdateProbeAt: Date?
    private var libraryRefreshScheduler: NSBackgroundActivityScheduler?
    private var libraryRefreshTask: Task<Void, Never>?
    private var libraryRefreshTimer: Timer?
    private var workspaceDidWakeObserver: NSObjectProtocol?
    private var isSharePickerActive = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        Analytics.start()
        setupUpdater()
        setupStatusItem()
        setupPanel()
        setupGlobalHotkey()
        setupLibraryRefreshObservers()
        setupLibraryRefreshTimer()
        setupLibraryRefreshScheduler()
        triggerLibraryRefreshIfNeeded()

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
            forName: .checkForUpdates, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.updaterController.checkForUpdates(nil)
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

    func applicationWillTerminate(_ notification: Notification) {
        libraryRefreshTask?.cancel()
        libraryRefreshTimer?.invalidate()
        libraryRefreshTimer = nil
        if let workspaceDidWakeObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(workspaceDidWakeObserver)
        }
    }

    private func setupUpdater() {
        updaterController = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: self,
            userDriverDelegate: nil
        )
        scheduleUpdateAvailabilityProbe()
    }

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

    private func scheduleUpdateAvailabilityProbe() {
        updateProbeAttempts += 1
        let attempt = updateProbeAttempts

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self else { return }

            if self.updaterController.updater.canCheckForUpdates,
               !self.updaterController.updater.sessionInProgress {
                self.lastUpdateProbeAt = Date()
                self.updaterController.updater.checkForUpdateInformation()
            } else if attempt < 6 {
                self.scheduleUpdateAvailabilityProbe()
            }
        }
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
        let hostingView = NSHostingView(rootView: ContentView())
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
    }

    @objc private func togglePanel() {
        if panel.isVisible {
            closePopover()
        } else {
            repositionPanel(width: 400, animate: false)
            panel.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            NotificationCenter.default.post(name: .popoverDidOpen, object: nil)
            probeForUpdateOnPanelOpen()
            triggerLibraryRefreshIfNeeded(trigger: .panelOpen)
            addClickOutsideMonitor()
        }
    }

    private func probeForUpdateOnPanelOpen(now: Date = Date()) {
        guard updaterController.updater.canCheckForUpdates else { return }
        guard !updaterController.updater.sessionInProgress else { return }
        guard Self.shouldProbeForUpdates(
            now: now,
            lastProbeAt: lastUpdateProbeAt,
            interval: updateProbeInterval
        ) else { return }

        lastUpdateProbeAt = now
        updaterController.updater.checkForUpdateInformation()
    }

    nonisolated static func shouldProbeForUpdates(
        now: Date,
        lastProbeAt: Date?,
        interval: TimeInterval
    ) -> Bool {
        guard let lastProbeAt else { return true }
        return now.timeIntervalSince(lastProbeAt) >= interval
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
        postUpdateAvailability(true)
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: Error) {
        postUpdateAvailability(false)
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        postUpdateAvailability(false)
    }

    private func postUpdateAvailability(_ available: Bool) {
        NotificationCenter.default.post(
            name: .updateAvailabilityChanged,
            object: nil,
            userInfo: ["available": available]
        )
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
    static let checkForUpdates = Notification.Name("checkForUpdates")
    static let updateAvailabilityChanged = Notification.Name("updateAvailabilityChanged")
    static let libraryDataDidRefresh = Notification.Name("libraryDataDidRefresh")
    static let sharePickerDidOpen = Notification.Name("sharePickerDidOpen")
    static let sharePickerDidClose = Notification.Name("sharePickerDidClose")
}
