#if DEBUG
import SwiftUI
import AppKit

struct PublicSkillInstallView: View {
    let model: PublicSkillInstallModel
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(model.review?.source.targetName ?? "OMGSkills F1 Test").font(.title2.bold())
            if let review = model.review {
                Text(review.source.repositorySlug + "/" + review.source.packageRoot)
                    .foregroundStyle(.secondary).textSelection(.enabled)
                Text("Codex: " + review.destination.path).font(.caption).textSelection(.enabled)
                Text("Commit: " + review.toCoordinates.commitSha).font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                if let from = review.fromCoordinates {
                    Text("From: " + from.commitSha).font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary).textSelection(.enabled)
                }
                Divider()
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        ForEach(review.changes) { change in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(change.kind.rawValue.capitalized + ": " + change.path).bold()
                                if change.oldMode != change.newMode {
                                    Text((change.oldMode ?? "absent") + " -> " + (change.newMode ?? "absent"))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Text(change.diff).font(.system(.caption, design: .monospaced))
                                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
            } else { Spacer() }
            HStack {
                if [.loading, .applying, .cancelling].contains(model.phase) { ProgressView().controlSize(.small) }
                Text(model.message).foregroundStyle(model.phase == .failure ? Color.red : Color.primary)
            }
            if !model.notice.isEmpty { Text(model.notice).foregroundStyle(.secondary) }
            HStack {
                Button(model.phase == .review || model.phase == .loading ? "Cancel" : "Close", action: close)
                    .disabled(model.isApplying || model.phase == .cancelling)
                Spacer()
                if model.phase == .review, let review = model.review {
                    Button(review.action == .install ? "Install in test folder" : review.action == .update ? "Apply update in test folder" : "Done") {
                        model.apply()
                    }.buttonStyle(.borderedProminent)
                }
            }
        }.padding(24).frame(minWidth: 540, minHeight: 420)
    }
}

@MainActor
final class PublicSkillInstallWindowController: NSObject, NSWindowDelegate {
    let model: PublicSkillInstallModel
    private let website: URL
    private var window: NSWindow!
    private var statusItem: NSStatusItem!

    init(root: URL, website: URL) {
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        self.website = website
        model = PublicSkillInstallModel(service: PublicSkillReviewService(
            fetcher: GitPublicSkillPackageFetcher(temporaryRoot: root),
            installer: ManagedSkillInstaller(managedRoot: root.appendingPathComponent("managed"), pathAnchor: paths.homeDirectory),
            paths: paths
        ))
        super.init()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 680),
                          styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "OMGSkills F1 Test"
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = NSHostingView(rootView: PublicSkillInstallView(model: model, close: { [weak self] in self?.closeReview() }))
        window.center()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "F1"
        statusItem.button?.toolTip = "OMGSkills F1 Test"
        let menu = NSMenu()
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
        menu.addItem(withTitle: "OMGSkills F1 Test " + version, action: nil, keyEquivalent: "")
        addItem("Status", action: #selector(showReview), to: menu)
        addItem("Open website", action: #selector(openWebsite), to: menu)
        menu.addItem(.separator())
        addItem("Quit OMGSkills F1 Test", action: #selector(quit), to: menu)
        statusItem.menu = menu
    }

    private func addItem(_ title: String, action: Selector, to menu: NSMenu) {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: "")
        item.target = self
    }

    func receive(_ url: URL) { model.receive(url.absoluteString); showReview() }
    @objc func showReview() { NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil) }
    @objc private func openWebsite() { NSWorkspace.shared.open(website) }
    @objc private func quit() { NSApp.terminate(nil) }

    func windowShouldClose(_ sender: NSWindow) -> Bool { closeReview(); return false }
    private func closeReview() {
        guard !model.isApplying, model.phase != .cancelling else { return }
        Task { [weak self] in
            guard let self else { return }
            await model.cancel()
            window.orderOut(nil)
        }
    }
}
#endif
