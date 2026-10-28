import Foundation
import Testing
@testable import omgskills

struct CatalogPopoverTests {
    private func source(_ name: String = "CatalogInstallView.swift") throws -> String {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/omgskills/" + name)
        return try String(contentsOf: file, encoding: .utf8)
    }

    @Test func inventoryButtonsShareTheAvailableWidth() throws {
        let code = try source("ConnectedInventoryView.swift")
        #expect(code.contains("HStack(spacing: 8) { inventoryActions }.buttonStyle(.bordered)"))
        #expect(code.contains("Text(\"Resync\").frame(maxWidth: .infinity)"))
        #expect(code.contains("Text(\"Disconnect\").frame(maxWidth: .infinity)"))
        #expect(!code.contains("HStack { inventoryActions }.fixedSize()"))
        #expect(code.contains(".disabled(model.reportStatus == .reporting)"))
    }

    @Test func panelKeepsWidthAndFitsContentHeight() throws {
        let code = try source()
        #expect(code.contains("static let panelWidth: CGFloat = 210"))
        #expect(code.contains("static let maximumPanelHeight: CGFloat = 440"))
        #expect(code.contains(".frame(width: Self.panelWidth, height: contentHeight)"))
        #expect(code.contains("if popover.contentSize != size { popover.contentSize = size }"))
        #expect(code.contains(".onChange(of: geometry.size.height)"))
        #expect(code.contains("if showsOptions { optionsContent }"))
        #expect(code.contains("else { statusContent }"))
        #expect(code.components(separatedBy: ".frame(width: Self.panelWidth, height: contentHeight)").count == 2)
        #expect(!code.contains("minWidth: 480"))
        #expect(code.contains("ScrollView"))
    }

    #if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
    @MainActor @Test(arguments: [(72.0, 72.0), (123.25, 124.0), (900.0, 440.0)])
    func contentHeightFitsShortContentAndCapsLongContent(_ sample: (Double, Double)) {
        #expect(CatalogInstallView.fittedPanelHeight(CGFloat(sample.0)) == CGFloat(sample.1))
    }
    #endif

    @Test func appHeadingIsRemovedButSkillNameAndVersionRemain() throws {
        let code = try source()
        #expect(code.contains("if let name = model.record?.name"))
        #expect(!code.contains("Text(model.record?.name ?? model.appName)"))
        #expect(code.contains("Text(\"Version \" + version)"))
        #expect(!code.contains("Text(model.appName + \" \" + version)"))
    }

    @Test func cancelIsGuardedAndCompletedRequestsHaveDone() throws {
        let code = try source()
        #expect(!code.contains("Button(\"Close\""))
        #expect(!code.contains("? \"Cancel\" : \"Close\""))
        #expect(code.contains("if model.ownsRequest {"))
        #expect(code.contains("Button(action: close) { Text(\"Cancel\").frame(maxWidth: .infinity) }"))
        #expect(code.contains(".disabled(!model.canClose)"))
        #expect(code.contains("Button(action: close) { Text(\"Done\").frame(maxWidth: .infinity) }"))
        #expect(code.contains("Button(action: model.install)"))
        #expect(code.contains(".onExitCommand(perform: hide)"))
    }

    @Test func installFlowIsSeparateAndButtonsFillThePanel() throws {
        let code = try source()
        #expect(code.contains("if model.phase != .idle { installContent }"))
        #expect(code.contains("else { accountContent }"))
        #expect(code.contains("VStack(spacing: 8)"))
        #expect(!code.contains("Catalog commit:"))
        #expect(code.contains("Label(model.message, systemImage: \"checkmark\")"))
        #expect(code.contains("model.message != \"Ready\""))
        #expect(code.contains(".buttonStyle(.borderedProminent).disabled(true)"))
        #expect(code.contains("model.phase == .confirm && model.message !="))
        #expect(code.contains("NSApp.activate()"))
        #expect(!code.contains("activate(ignoringOtherApps:"))
    }

    #if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
    @MainActor @Test func inventorySummaryKeepsInstallationCountAndWarnings() {
        let complete = SkillSyncResult(syncRunId: "run", syncedSkillCount: 105, reportVersion: 3,
            mode: "reconciled", deviceId: "device", completedAt: "2026-10-26T12:00:00Z",
            missingSkillCount: 0, complete: true)
        let reported = DeviceConnectionModel.ReportStatus.reported(complete, scanIssueCount: 0)
        #expect(ConnectedInventoryView.reportedCount(reported) == 105)
        #expect(ConnectedInventoryView.reportAttention(reported) == nil)
        #expect(ConnectedInventoryView.reportAttention(.reported(complete, scanIssueCount: 1))?.contains("Partial") == true)
        #expect(ConnectedInventoryView.reportedCount(.idle) == nil)
        #expect(ConnectedInventoryView.reportedCount(.reporting) == nil)
        #expect(ConnectedInventoryView.reportAttention(.failed("Offline"))?.contains("Offline") == true)
        #expect(ConnectedInventoryView.reportAttention(.uncertain("Offline"))?.contains("Resync") == true)
        let partial = SkillSyncResult(syncRunId: "partial", syncedSkillCount: 2, reportVersion: 3,
            mode: "reconciled", deviceId: "device", completedAt: "2026-10-26T12:00:00Z",
            missingSkillCount: 0, complete: false)
        #expect(ConnectedInventoryView.reportAttention(.reported(partial, scanIssueCount: 0))?.contains("Partial") == true)
        let missing = SkillSyncResult(syncRunId: "missing", syncedSkillCount: 104, reportVersion: 3,
            mode: "reconciled", deviceId: "device", completedAt: "2026-10-26T12:00:00Z",
            missingSkillCount: 1, complete: true)
        #expect(ConnectedInventoryView.reportAttention(.reported(missing, scanIssueCount: 0)) == "1 newly not found on last scan.")
    }
    #endif

    @Test func versionSitsBesideQuitInTheOptionsFooter() throws {
        let code = try source()
        let footer = try #require(code.range(of: "HStack(alignment: .bottom)"))
        let end = try #require(code.range(of: "final class CatalogInstallWindowController"))
        let body = code[footer.lowerBound..<end.lowerBound]
        #expect(body.contains("Text(\"Quit\")"))
        #expect(body.contains("Spacer(minLength: 4)"))
        #expect(body.contains("Text(\"Version \" + version)"))
    }

    @Test func headersShareHeightAndOptionsIconsShareAColumn() throws {
        let code = try source()
        #expect(code.components(separatedBy: "HStack(alignment: .center, spacing: 8)").count == 2)
        #expect(code.contains("ZStack(alignment: .leading)"))
        #expect(code.components(separatedBy: "}.frame(minHeight: Self.iconButtonSize)").count == 3)
        for symbol in ["safari", "arrow.down.circle", "power"] {
            #expect(code.contains("Image(systemName: \"\(symbol)\").frame(width: Self.iconColumnWidth)"))
        }
    }

    @Test func optionsTitleUsesRowLabelSpacingAndLastTimestampIsLighter() throws {
        let code = try source()
        let options = try #require(code.range(of: "private var optionsContent"))
        let header = try #require(code.range(of: "Button { showStatus?() }", range: options.upperBound..<code.endIndex))
        let title = code[options.upperBound..<header.lowerBound]
        #expect(title.contains("Label {"))
        #expect(title.contains("Text(\"Options\").font(.headline)"))
        #expect(title.contains(".frame(width: Self.iconColumnWidth)"))
        #expect(title.contains(".hidden().accessibilityHidden(true)"))
        let inventory = try source("ConnectedInventoryView.swift")
        #expect(inventory.contains(".font(.caption).foregroundStyle(.tertiary).padding(.top, 8)"))
    }

    @Test func panelsShareInsetsWithoutOversizingVisibleIconsOrCount() throws {
        let code = try source()
        #expect(code.contains("static let panelPadding: CGFloat = 12"))
        #expect(code.contains("static let iconColumnWidth: CGFloat = 16"))
        #expect(code.contains(".frame(width: Self.panelWidth - 2 * Self.panelPadding, alignment: .leading)"))
        #expect(code.components(separatedBy: ".padding(Self.panelPadding)").count == 2)
        #expect(!code.contains(".buttonStyle(.borderless)"))
        #expect(code.contains("height: Self.iconButtonSize, alignment: .leading)"))
        #expect(code.contains("height: Self.iconButtonSize, alignment: .trailing)"))
        let inventory = try source("ConnectedInventoryView.swift")
        #expect(inventory.contains("Text(\"\\(count) Skills\").font(.body)"))
        #expect(!inventory.contains(".font(.title2)"))
    }

    @Test func panelIsNativelyAnchoredAndCannotDetach() throws {
        let code = try source()
        #expect(code.contains("private let popover = NSPopover()"))
        #expect(code.contains("popover.behavior = .transient"))
        #expect(code.contains("popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)"))
        #expect(code.contains("func popoverShouldDetach(_ popover: NSPopover) -> Bool { false }"))
        #expect(!code.contains("NSWindow(contentRect:"))
        #expect(!code.contains("window.center()"))
        #expect(!code.contains("statusItem.menu = menu"))
    }

    @Test func dismissalDoesNotCancelInstallOrStopInventory() throws {
        let code = try source()
        let hide = try #require(code.range(of: "private func hidePanel()"))
        let next = try #require(code.range(of: "func receive", range: hide.upperBound..<code.endIndex))
        let body = code[hide.lowerBound..<next.lowerBound]
        #expect(body.contains("popover.performClose(nil)"))
        #expect(!body.contains("model.close"))
        #expect(!body.contains("cancel"))
        #expect(!body.contains("stop"))
        #expect(code.contains(".onExitCommand(perform: hide)"))
        #expect(!code.contains("keyboardShortcut(.cancelAction)"))
        #expect(code.contains("if await model.close(), model.phase == .idle { hidePanel() }"))
    }

    @Test func browserReturnAndInstallLinksReopenTheSamePanel() throws {
        let code = try source()
        #expect(code.components(separatedBy: "self?.browserPresentationAnchor()").count == 3)
        #expect(code.components(separatedBy: "self?.returnFromBrowser()").count == 3)
        #expect(code.contains("authenticationAnchor = contentController.view.window ?? statusItem.button?.window"))
        #expect(code.contains("private var authenticationAnchor: NSWindow?"))
        #expect(code.contains("model.receive(url)\n        showStatus()"))
        #expect(code.contains("if connectedRuntime?.receivePairingCallback(url) == true { showStatus(); return }"))
    }

    @Test func appMenuKeepsTheExistingUpdaterAndQuitGuards() throws {
        let code = try source()
        #expect(code.contains("Label(\"App menu\", systemImage: \"ellipsis\")"))
        #expect(code.contains("sendAction(on: [.leftMouseUp, .rightMouseUp])"))
        #expect(code.contains("contentController.rootView.appUpdater = updater"))
        #expect(code.contains("appUpdater.check()"))
        #expect(code.contains(".disabled(!appUpdater.canCheck)"))
        #expect(code.contains(".disabled(!model.canClose)"))
        #expect(code.contains("private func quit() {\n        guard model.canClose, setInstall?.canClose ?? true else { return }"))
    }

    @Test func navigationButtonsUseMacDefaultHitTargets() throws {
        let code = try source()
        #expect(code.contains("static let iconButtonSize: CGFloat = 28"))
        let hitArea = ".frame(width: Self.iconButtonSize, height: Self.iconButtonSize, alignment:"
        #expect(code.components(separatedBy: hitArea).count == 3)
        #expect(code.contains(".contentShape(Rectangle())"))
        #expect(code.contains(".help(\"App menu\")"))
        #expect(code.contains(".help(\"Back to status\")"))
    }

    @Test func optionsSwitchOnlyContentInTheExistingPopover() throws {
        let code = try source()
        let start = try #require(code.range(of: "private func showAppMenu()"))
        let end = try #require(code.range(of: "private func hidePanel()", range: start.upperBound..<code.endIndex))
        let body = code[start.lowerBound..<end.lowerBound]
        #expect(body.contains("contentController.rootView.showsOptions = true"))
        #expect(body.contains("presentPanel()"))
        #expect(!body.contains("hidePanel()"))
        #expect(!body.contains("NSPopover()"))
        #expect(!code.contains("menu.popUp("))
        #expect(!code.contains("NSMenu()"))
        #expect(code.contains("Label(\"Back to status\", systemImage: \"chevron.left\")"))
        #expect(code.contains("contentController.rootView.showsOptions = false"))
        #expect(code.contains("if !popover.isShown {"))
    }
}
