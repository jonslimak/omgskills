#if DEBUG
import SwiftUI
import AppKit

@MainActor
struct ConnectedInventoryView: View {
    let model: DeviceConnectionModel
    let deviceName: String
    var runtime: ConnectedInventoryRuntime? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch model.state {
            case .connected(let info):
                Text(info.accountLabel).font(.headline).textSelection(.enabled)
                Text(Self.reportMessage(model.reportStatus)).font(.callout).textSelection(.enabled)
                if let checked = model.lastInventoryCheckedAt {
                    Text("Last checked " + checked.formatted(date: .abbreviated, time: .shortened)).font(.caption)
                }
                if let warning = runtime?.watchWarning { Text(warning).font(.caption).foregroundStyle(.secondary) }
                HStack {
                    Button("Resync", systemImage: "arrow.clockwise") {
                        if let runtime { runtime.resync() } else { model.requestInventoryReport() }
                    }
                        .disabled(model.reportStatus == .reporting)
                    Button("Disconnect", systemImage: "person.crop.circle.badge.minus") {
                        if let runtime { runtime.disconnect() } else { model.disconnect() }
                    }
                }
            case .authorizing, .exchanging, .storingCredential, .syncing:
                HStack {
                    ProgressView().controlSize(.small)
                    Text("Connecting...")
                    Spacer()
                    Button("Cancel") {
                        if let runtime { runtime.cancel() } else { model.cancelCurrentOperation() }
                    }
                }
            case .disconnected, .failed:
                if case .failed(let failure) = model.state {
                    Text(Self.connectionMessage(failure)).font(.callout).foregroundStyle(.red)
                }
                Button("Connect account", systemImage: "person.crop.circle.badge.plus") {
                    if let runtime { runtime.connect(deviceName: deviceName) }
                    else { model.connectWithBrowser(deviceName: deviceName, installations: [], replacingExisting: true) }
                }
            }
            if let warning = model.disconnectWarning {
                Text(warning).font(.caption).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    static func reportMessage(_ status: DeviceConnectionModel.ReportStatus) -> String {
        switch status {
        case .idle: return "Connected. Inventory has not been reported yet."
        case .pending: return "Inventory report pending."
        case .reporting: return "Reporting installed skills..."
        case .failed(let message): return "Inventory needs attention. " + message
        case .uncertain(let message): return "Report outcome uncertain. " + message + " Resync to check with a fresh scan."
        case .reported(let result, let issues):
            if result.reportVersion == 3 {
                guard result.complete == true else { return "Partial inventory reported. Some folders were not fully checked. Resync to retry." }
                let date = result.reportedAt?.formatted(date: .abbreviated, time: .shortened) ?? "unknown time"
                return "\(result.syncedSkillCount) installations seen; \(result.missingSkillCount ?? 0) newly not found at \(date)."
            }
            if issues > 0 { return "Partial inventory reported. \(issues) scan issues need attention. Resync to retry." }
            let date = result.reportedAt?.formatted(date: .abbreviated, time: .shortened) ?? "unknown time"
            return "\(result.syncedSkillCount) installations reported at \(date)."
        }
    }

    private static func connectionMessage(_ failure: DeviceConnectionFailure) -> String {
        switch failure {
        case .reconnectRequired: return "Reconnect this Mac to report inventory."
        case .replacementRequired: return "An account is already connected. Reconnect to replace it."
        case .credentialStorage: return "The account credential could not be stored or read."
        case .authorization(let message), .exchange(let message), .sync(let message): return message
        }
    }
}

// Lifecycle/routing only; the existing connection model owns reporting and credentials.
@MainActor
@Observable
final class ConnectedInventoryRuntime {
    let connection: DeviceConnectionModel
    private(set) var watchWarning: String?
    @ObservationIgnored private let authorizer: any BrowserPairingAuthorizing
    @ObservationIgnored private let automation: Automation?
    @ObservationIgnored private var startup: Task<Void, Never>?
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var hourly: Task<Void, Never>?
    @ObservationIgnored private var stopWatching: (@MainActor () -> Void)?
    @ObservationIgnored private var stopWake: (@MainActor () -> Void)?
    @ObservationIgnored private var session = UUID()
    @ObservationIgnored private var initializing = false
    @ObservationIgnored private var bufferedChange = false
    @ObservationIgnored private var bufferedRequest = false
    @ObservationIgnored private lazy var scheduler = InventoryReportScheduler(
        now: automation?.now ?? { ProcessInfo.processInfo.systemUptime },
        sleep: automation?.sleep ?? Self.defaultSleep,
        jitter: automation?.jitter ?? { .random(in: 0...1) }) { [weak self] in
            guard let self else { return .cancelled }
            let current = session
            let outcome = await connection.requestScheduledInventoryReport()
            if current == session, outcome == .reconnectRequired { stopAutomation() }
            return outcome
        }

    private static let defaultSleep: InventoryReportScheduler.Sleep = { try await Task.sleep(for: .seconds($0)) }

    @MainActor struct Automation {
        typealias Event = @MainActor @Sendable () -> Void
        let watch: @MainActor (@escaping Event) throws -> (@MainActor () -> Void)
        let wake: @MainActor (@escaping Event) -> (@MainActor () -> Void)
        var now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
        var sleep: InventoryReportScheduler.Sleep = { try await Task.sleep(for: .seconds($0)) }
        var jitter: () -> TimeInterval = { .random(in: 0...1) }

        static func live(paths: SkillFilesystemPaths) -> Self {
            Self(watch: { changed in
                let watcher = InventoryFolderWatcher(roots: paths.allSkillsRoots, anchor: paths.homeDirectory, onChange: changed)
                try watcher.start()
                return { watcher.stop() }
            }, wake: { woke in
                let center = NSWorkspace.shared.notificationCenter
                let token = center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
                    Task { @MainActor in woke() }
                }
                return { center.removeObserver(token) }
            })
        }
    }

    init(connection: DeviceConnectionModel, authorizer: any BrowserPairingAuthorizing, automation: Automation? = nil) {
        self.connection = connection
        self.authorizer = authorizer
        self.automation = automation
    }

    @discardableResult
    func start() -> Task<Void, Never> {
        if let startup { return startup }
        let task = beginInitial { [connection] in connection.restore() }
        startup = task
        return task
    }

    func receivePairingCallback(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == BrowserPairing.connectedTestCallbackScheme,
              url.host?.lowercased() == "pair" else { return false }
        // Even a stale cold-launch callback must never be interpreted as an install.
        _ = authorizer.handleCallback(url)
        return true
    }

    @discardableResult
    func connect(deviceName: String) -> Task<Void, Never> {
        beginInitial { [connection] in
            connection.connectWithBrowser(deviceName: deviceName, installations: [], replacingExisting: true)
        }
    }

    func installed() {
        if automation != nil { trigger(changed: false, session: session) }
        else { connection.requestInventoryReport() }
    }

    func resync() {
        guard automation != nil else { connection.requestInventoryReport(); return }
        connection.requireFullInventoryReport()
        trigger(changed: false, session: session)
    }

    @discardableResult
    func disconnect() -> Task<Void, Never> {
        transition(initial: false) { [connection] in connection.disconnect() }
    }

    @discardableResult
    func cancel() -> Task<Void, Never> {
        let current = invalidateSession()
        let pending = operation
        connection.cancelCurrentOperation()
        let task = Task { @MainActor [weak self] in
            await pending?.value
            guard let self, current == session else { return }
            await scheduler.stopAndWait()
            guard current == session else { return }
            await connection.cancelAndAwaitCurrentOperation()
            if current == session { startup = nil; operation = nil }
        }
        operation = task
        return task
    }

    func stop() async { await cancel().value }

    private func beginInitial(_ begin: @escaping @MainActor () -> Task<Void, Never>) -> Task<Void, Never> {
        transition(initial: true, begin: begin)
    }

    private func transition(initial: Bool, begin: @escaping @MainActor () -> Task<Void, Never>) -> Task<Void, Never> {
        let current = invalidateSession()
        let previous = operation
        connection.cancelCurrentOperation()
        initializing = initial
        if automation != nil {
            connection.onInventoryConnectionReady = { [weak self] in self?.connectionReady(session: current) }
        }
        let task = Task { @MainActor [weak self] in
            await previous?.value
            guard let self, current == session else { return }
            await scheduler.stopAndWait()
            guard current == session else { return }
            await begin().value
            guard current == session else { return }
            initializing = false
            guard automation != nil, case .connected = connection.state,
                  let outcome = connection.lastReportOutcome else { stopAutomation(); return }
            scheduler.adoptInitialOutcome(outcome)
            if bufferedRequest { scheduler.request() }
            else if bufferedChange { scheduler.changed() }
            bufferedChange = false
            bufferedRequest = false
        }
        operation = task
        return task
    }

    private func connectionReady(session current: UUID) {
        guard current == session, let automation else { return }
        scheduler.start()
        do { stopWatching = try automation.watch { [weak self] in self?.trigger(changed: true, session: current) } }
        catch { watchWarning = "Folder monitoring unavailable. Resync and hourly checks remain available." }
        stopWake = automation.wake { [weak self] in self?.trigger(changed: false, session: current) }
        hourly = Task { @MainActor [weak self, sleep = automation.sleep] in
            while !Task.isCancelled {
                do { try await sleep(3_600) } catch { return }
                guard !Task.isCancelled, self?.session == current else { return }
                self?.trigger(changed: false, session: current)
            }
        }
    }

    private func trigger(changed: Bool, session current: UUID) {
        guard current == session, automation != nil, case .connected = connection.state else { return }
        if initializing {
            bufferedChange = true
            bufferedRequest = bufferedRequest || !changed
        } else if changed { scheduler.changed() }
        else { scheduler.request() }
    }

    @discardableResult
    private func invalidateSession() -> UUID {
        session = UUID()
        connection.onInventoryConnectionReady = nil
        initializing = false
        bufferedChange = false
        bufferedRequest = false
        watchWarning = nil
        stopAutomation()
        return session
    }

    private func stopAutomation() {
        stopWatching?(); stopWatching = nil
        stopWake?(); stopWake = nil
        hourly?.cancel(); hourly = nil
        scheduler.stop()
    }
}
#endif
