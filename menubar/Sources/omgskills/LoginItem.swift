import Foundation
import Observation
import ServiceManagement

/// Whether macOS opens the app at login, as the system reports it.
enum LoginItemStatus: Equatable, Sendable {
    case enabled
    case notRegistered
    /// Turned on, but the user still has to allow it in System Settings.
    case requiresApproval
    case notFound
}

/// The system login item for this app; faked in tests.
@MainActor
protocol LoginItemService {
    var status: LoginItemStatus { get }
    func register() throws
    func unregister() throws
    func openSystemSettings()
}

/// The real login item: `SMAppService.mainApp`.
@MainActor
struct MainAppLoginItemService: LoginItemService {
    var status: LoginItemStatus {
        switch SMAppService.mainApp.status {
        case .enabled: return .enabled
        case .requiresApproval: return .requiresApproval
        case .notFound: return .notFound
        case .notRegistered: return .notRegistered
        @unknown default: return .notRegistered
        }
    }
    func register() throws { try SMAppService.mainApp.register() }
    func unregister() throws { try SMAppService.mainApp.unregister() }
    func openSystemSettings() { SMAppService.openSystemSettingsLoginItems() }
}

/// The "Open at login" switch. Off unless the user turns it on; the system's status is the truth,
/// since the user can also change it in System Settings > General > Login Items.
@MainActor
@Observable
final class LoginItemController {
    static let approvalHint = "Allow it in System Settings > General > Login Items."
    static let turnOnFailed = "Couldn't turn on Open at login."
    static let turnOffFailed = "Couldn't turn off Open at login."
    static let moveToApplications = "Move omgskills to Applications, then try again."

    private(set) var status: LoginItemStatus
    private(set) var message: String?
    @ObservationIgnored private let service: any LoginItemService

    init(service: any LoginItemService) {
        self.service = service
        status = service.status
    }

    var isOn: Bool { status == .enabled || status == .requiresApproval }
    var needsApproval: Bool { status == .requiresApproval }

    /// Reads the system's status again; call each time the panel shows.
    func refresh() {
        status = service.status
    }

    func setEnabled(_ on: Bool) {
        refresh()
        guard on != isOn else { message = nil; return }
        do {
            if on { try service.register() } else { try service.unregister() }
            message = nil
        } catch {
            message = on ? Self.turnOnFailed : Self.turnOffFailed
        }
        refresh()
        // macOS can't find the app where it is (e.g. run from Downloads or a disk image).
        if on, status == .notFound { message = Self.moveToApplications }
    }

    func openSystemSettings() {
        service.openSystemSettings()
    }
}
