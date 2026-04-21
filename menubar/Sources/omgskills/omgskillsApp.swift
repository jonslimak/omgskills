import SwiftUI
import AppKit
import KeyboardShortcuts

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
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var panel: NSPanel!
    private var clickMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        setupPanel()
        setupGlobalHotkey()

        NotificationCenter.default.addObserver(
            forName: .detailToggled, object: nil, queue: .main
        ) { [weak self] note in
            let show = (note.userInfo?["showDetail"] as? Bool) ?? false
            let width: CGFloat = show ? 750 : 400
            Task { @MainActor [weak self] in
                self?.repositionPanel(width: width, animate: true)
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
        hostingView.layer?.cornerRadius = 12
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
            addClickOutsideMonitor()
        }
    }

    private func repositionPanel(width: CGFloat, animate: Bool) {
        guard let button = statusItem.button, let buttonWindow = button.window else { return }
        let buttonRect = button.convert(button.bounds, to: nil)
        let screenRect = buttonWindow.convertToScreen(buttonRect)

        let x = screenRect.midX - width / 2
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
}

final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

extension Notification.Name {
    static let popoverDidOpen = Notification.Name("popoverDidOpen")
    static let detailToggled = Notification.Name("detailToggled")
}
