#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import Foundation
import Observation
import AppKit

// Lifecycle/routing only; the existing connection model owns reporting and credentials.
@MainActor
@Observable
final class ConnectedInventoryRuntime {
    let connection: DeviceConnectionModel
    private(set) var watchWarning: String?
    /// Saves this Mac's own skills after each inventory report, when the account has cloud save on.
    var cloudSave: CloudSaveController?
    /// Where the once-ever first-launch Connect is recorded; nil turns the first-launch Connect off.
    @ObservationIgnored var firstLaunchDefaults: UserDefaults?
    @ObservationIgnored private let authorizer: any BrowserPairingAuthorizing
    @ObservationIgnored private let automation: Automation?
    @ObservationIgnored private let callbackScheme: String
    @ObservationIgnored private let track: ConnectedAppEvent.Track
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
            if current == session {
                if let event = ConnectedAppEvent.inventoryResult(outcome) { track(event) }
                if outcome == .reconnectRequired { stopAutomation() }
                if case .reported = outcome { cloudSave?.requestRun() }
                if outcome == .checked { cloudSave?.requestRun() }
            }
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

    init(connection: DeviceConnectionModel, authorizer: any BrowserPairingAuthorizing,
         callbackScheme: String = BrowserPairing.connectedTestCallbackScheme, automation: Automation? = nil,
         track: @escaping ConnectedAppEvent.Track = { _ in }) {
        self.connection = connection
        self.authorizer = authorizer
        self.automation = automation
        self.callbackScheme = callbackScheme
        self.track = track
    }

    @discardableResult
    func start() -> Task<Void, Never> {
        if let startup { return startup }
        let task = beginInitial(action: .restore) { [connection] in connection.restore() }
        startup = task
        return task
    }

    func receivePairingCallback(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == callbackScheme,
              url.host?.lowercased() == "pair" else { return false }
        // Even a stale cold-launch callback must never be interpreted as an install.
        _ = authorizer.handleCallback(url)
        return true
    }

    /// Starts Connect once ever, on the app's very first launch, when this Mac has never been connected.
    /// Any connect or disconnect by the user also uses up the offer. A launch the app had before this
    /// version (`launchedBefore`) uses it up without connecting. While `deferIf` is true (an install
    /// link arrived and its review handles Connect) the offer is left for a later launch.
    @discardableResult
    func offerFirstLaunchConnect(launchedBefore: Bool, deferIf: @escaping @MainActor () -> Bool = { false },
                                 deviceName: @escaping @MainActor () -> String) -> Task<Void, Never> {
        guard let defaults = firstLaunchDefaults, !FirstLaunchConnect.wasOffered(defaults) else { return Task {} }
        if launchedBefore { FirstLaunchConnect.markOffered(defaults); return Task {} }
        let startup = start()
        return Task { @MainActor [weak self] in
            await startup.value
            guard let self, let defaults = firstLaunchDefaults, !FirstLaunchConnect.wasOffered(defaults),
                  !deferIf() else { return }
            let current = session
            let hasPrior = await connection.hasPriorConnectionRecord()
            guard !FirstLaunchConnect.wasOffered(defaults), !deferIf() else { return }
            FirstLaunchConnect.markOffered(defaults)
            guard current == session, FirstLaunchConnect.shouldConnect(alreadyOffered: false,
                state: connection.state, hasPriorConnection: hasPrior) else { return }
            await connect(deviceName: deviceName()).value
        }
    }

    @discardableResult
    func connect(deviceName: String) -> Task<Void, Never> {
        if let firstLaunchDefaults { FirstLaunchConnect.markOffered(firstLaunchDefaults) }
        return beginInitial(action: .connect) { [connection] in
            connection.connectWithBrowser(deviceName: deviceName, installations: [], replacingExisting: true)
        }
    }

    func observeInstalls(in model: CatalogInstallModel) {
        model.onInstalled = { [weak self] in self?.installed() }
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
        if let firstLaunchDefaults { FirstLaunchConnect.markOffered(firstLaunchDefaults) }
        return transition(initial: false, action: .disconnect) { [connection] in connection.disconnect() }
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

    private func beginInitial(action: ConnectedAppEvent.ConnectionAction,
                              _ begin: @escaping @MainActor () -> Task<Void, Never>) -> Task<Void, Never> {
        transition(initial: true, action: action, begin: begin)
    }

    private func transition(initial: Bool, action: ConnectedAppEvent.ConnectionAction,
                            begin: @escaping @MainActor () -> Task<Void, Never>) -> Task<Void, Never> {
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
            if let event = ConnectedAppEvent.connectionResult(connection.state, action: action,
                hasWarning: connection.disconnectWarning != nil) { track(event) }
            if initial, let outcome = connection.lastReportOutcome,
               let event = ConnectedAppEvent.inventoryResult(outcome) { track(event) }
            initializing = false
            guard automation != nil, case .connected = connection.state,
                  let outcome = connection.lastReportOutcome else { stopAutomation(); return }
            scheduler.adoptInitialOutcome(outcome)
            cloudSave?.requestRun()
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
        catch {
            watchWarning = "Folder monitoring unavailable. Resync and hourly checks remain available."
            track(.watcherUnavailable)
        }
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
        cloudSave?.cancel()
        stopWatching?(); stopWatching = nil
        stopWake?(); stopWake = nil
        hourly?.cancel(); hourly = nil
        scheduler.stop()
    }
}

/// The connected app opens Connect by itself at most once ever: on a launch where this Mac
/// has no credential, no reconnect key and no record of an earlier connect or disconnect.
enum FirstLaunchConnect {
    static let offeredKey = "OMGSkillsFirstLaunchConnectOffered"

    static func wasOffered(_ defaults: UserDefaults) -> Bool { defaults.bool(forKey: offeredKey) }

    /// Whether an earlier version already ran: production 0.0.38 and earlier record install telemetry on
    /// every launch, and AppKit saves status item positions. Read this before this launch writes either.
    static func launchedBefore(_ defaults: UserDefaults) -> Bool {
        if Analytics.launchMarkerKeys.contains(where: { defaults.object(forKey: $0) != nil }) { return true }
        return defaults.dictionaryRepresentation().keys.contains { $0.hasPrefix("NSStatusItem ") }
    }
    static func markOffered(_ defaults: UserDefaults) { defaults.set(true, forKey: offeredKey) }

    static func shouldConnect(alreadyOffered: Bool, state: DeviceConnectionModel.State,
                              hasPriorConnection: Bool) -> Bool {
        !alreadyOffered && !hasPriorConnection && state == .disconnected
    }
}
#endif
