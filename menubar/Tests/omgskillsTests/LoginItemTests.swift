import Foundation
import Testing
@testable import omgskills

@MainActor
private final class FakeLoginItemService: LoginItemService {
    struct Failure: Error {}
    var status: LoginItemStatus = .notRegistered
    var statusAfterRegister: LoginItemStatus = .enabled
    var failure: Failure?
    var registers = 0
    var unregisters = 0
    var settingsOpened = 0

    func register() throws {
        registers += 1
        if let failure { throw failure }
        status = statusAfterRegister
    }
    func unregister() throws {
        unregisters += 1
        if let failure { throw failure }
        status = .notRegistered
    }
    func openSystemSettings() { settingsOpened += 1 }
}

@MainActor
struct LoginItemTests {
    @Test func offByDefault() {
        let controller = LoginItemController(service: FakeLoginItemService())
        #expect(!controller.isOn)
        #expect(!controller.needsApproval)
        #expect(controller.message == nil)
    }

    @Test func turningOnRegisters() {
        let service = FakeLoginItemService()
        let controller = LoginItemController(service: service)
        controller.setEnabled(true)
        #expect(service.registers == 1)
        #expect(controller.isOn)
        #expect(controller.message == nil)
    }

    @Test func turningOffUnregisters() {
        let service = FakeLoginItemService()
        service.status = .enabled
        let controller = LoginItemController(service: service)
        controller.setEnabled(false)
        #expect(service.unregisters == 1)
        #expect(!controller.isOn)
    }

    @Test func statusFollowsTheServiceOnRefresh() {
        let service = FakeLoginItemService()
        let controller = LoginItemController(service: service)
        service.status = .enabled  // turned on in System Settings
        #expect(!controller.isOn)
        controller.refresh()
        #expect(controller.isOn)
        service.status = .notRegistered  // turned off in System Settings
        controller.refresh()
        #expect(!controller.isOn)
    }

    @Test func requiresApprovalShowsTheHintAndOpensLoginItems() {
        let service = FakeLoginItemService()
        service.statusAfterRegister = .requiresApproval
        let controller = LoginItemController(service: service)
        controller.setEnabled(true)
        #expect(controller.isOn)
        #expect(controller.needsApproval)
        #expect(LoginItemController.approvalHint.contains("System Settings > General > Login Items"))
        controller.openSystemSettings()
        #expect(service.settingsOpened == 1)
        controller.setEnabled(false)
        #expect(service.unregisters == 1)
        #expect(!controller.needsApproval)
    }

    @Test func registerErrorLeavesTheSwitchOff() {
        let service = FakeLoginItemService()
        service.failure = .init()
        let controller = LoginItemController(service: service)
        controller.setEnabled(true)
        #expect(service.registers == 1)
        #expect(!controller.isOn)
        #expect(controller.message == LoginItemController.turnOnFailed)
    }

    @Test func unregisterErrorLeavesTheSwitchOn() {
        let service = FakeLoginItemService()
        service.status = .enabled
        service.failure = .init()
        let controller = LoginItemController(service: service)
        controller.setEnabled(false)
        #expect(controller.isOn)
        #expect(controller.message == LoginItemController.turnOffFailed)
    }

    @Test func aSuccessfulChangeClearsAnEarlierError() {
        let service = FakeLoginItemService()
        service.failure = .init()
        let controller = LoginItemController(service: service)
        controller.setEnabled(true)
        service.failure = nil
        controller.setEnabled(true)
        #expect(controller.isOn)
        #expect(controller.message == nil)
    }

    @Test func optionsMenuShowsTheSwitchAndRefreshesOnShow() throws {
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/omgskills/CatalogInstallView.swift")
        let code = try String(contentsOf: source, encoding: .utf8)
        let options = try #require(code.range(of: "private var optionsContent"))
        let divider = try #require(code.range(of: "Divider()", range: options.upperBound..<code.endIndex))
        #expect(code[options.upperBound..<divider.lowerBound].contains("LoginItemRow(controller: loginItem)"))
        #expect(code.contains("Text(\"Open at login\")"))
        #expect(code.contains("loginItem?.refresh()"))
        #expect(code.contains("LoginItemController(service: MainAppLoginItemService())"))
    }
}
