import Foundation

// Scheduling owns intent only. The connection model owns credentials, fresh scans and uploads.
@MainActor
final class InventoryReportScheduler {
    enum Phase: Equatable { case stopped, idle, waiting, reporting, needsAttention }
    typealias Sleep = @MainActor (TimeInterval) async throws -> Void

    private(set) var phase: Phase = .stopped
    private(set) var lastOutcome: InventoryReportOutcome?
    private(set) var deadline: TimeInterval?
    private let now: () -> TimeInterval
    private let sleep: Sleep
    private let jitter: () -> TimeInterval
    private let report: @MainActor () async -> InventoryReportOutcome
    private var generation = UUID()
    private var timerID = UUID()
    private var timer: Task<Void, Never>?
    private var reporting: Task<Void, Never>?
    private var burstStart: TimeInterval?
    private var changeDeadline: TimeInterval?
    private var retryDeadline: TimeInterval?
    private var retries = 0
    private var conflicts = 0

    init(now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         sleep: @escaping Sleep = { try await Task.sleep(for: .seconds($0)) },
         jitter: @escaping () -> TimeInterval = { .random(in: 0...1) },
         report: @escaping @MainActor () async -> InventoryReportOutcome) {
        self.now = now
        self.sleep = sleep
        self.jitter = jitter
        self.report = report
    }

    deinit {
        timer?.cancel()
        reporting?.cancel()
    }

    func start() {
        guard phase == .stopped else { return }
        generation = UUID()
        phase = .idle
    }

    func stop() {
        generation = UUID()
        timerID = UUID()
        timer?.cancel()
        reporting?.cancel()
        timer = nil
        deadline = nil
        retryDeadline = nil
        burstStart = nil
        changeDeadline = nil
        retries = 0
        conflicts = 0
        lastOutcome = nil
        phase = .stopped
    }

    func stopAndWait() async {
        let pending = reporting
        stop()
        await pending?.value
    }

    func changed() {
        guard phase != .stopped, phase != .needsAttention else { return }
        let time = now()
        if burstStart == nil { burstStart = time }
        changeDeadline = min(time + 3, (burstStart ?? time) + 30)
        guard phase != .reporting, retryDeadline == nil else { return }
        schedule(at: changeDeadline!)
    }

    // Manual/hourly intent may restart an exhausted cycle, but never bypasses server backoff.
    func request() {
        guard phase != .stopped else { return }
        changeDeadline = now()
        if phase == .reporting || retryDeadline != nil { return }
        retries = 0
        conflicts = 0
        schedule(at: now())
    }

    private func schedule(at time: TimeInterval) {
        timer?.cancel()
        let id = UUID()
        timerID = id
        let session = generation
        deadline = time
        phase = .waiting
        timer = Task { @MainActor [weak self, sleep, now] in
            do { try await sleep(max(0, time - now())) } catch { return }
            guard !Task.isCancelled, let self, generation == session, timerID == id else { return }
            beginReport(session: session)
        }
    }

    private func beginReport(session: UUID) {
        timer = nil
        deadline = nil
        retryDeadline = nil
        burstStart = nil
        changeDeadline = nil
        phase = .reporting
        let previous = reporting
        reporting = Task { @MainActor [weak self, report] in
            // Cancellation is cooperative; a restarted session must drain the old callback first.
            await previous?.value
            guard !Task.isCancelled, self?.generation == session else { return }
            let outcome = await report()
            guard !Task.isCancelled, let self, generation == session else { return }
            reporting = nil
            lastOutcome = outcome
            finish(outcome)
        }
    }

    private func finish(_ outcome: InventoryReportOutcome) {
        switch outcome {
        case .reported, .checked:
            retries = 0
            conflicts = 0
            if let changeDeadline { schedule(at: max(now(), changeDeadline)) }
            else { phase = .idle }
        case .retryable(let requested):
            retry(after: requested)
        case .revisionConflict:
            guard conflicts == 0 else { exhaust(); return }
            conflicts += 1
            retry(after: nil)
        case .needsAttention, .reconnectRequired:
            exhaust()
        case .cancelled:
            retries = 0
            conflicts = 0
            changeDeadline = nil
            burstStart = nil
            phase = .idle
        }
    }

    private func retry(after requested: TimeInterval?) {
        let delays: [TimeInterval] = [5, 30, 120]
        guard retries < delays.count else { exhaust(); return }
        let extra = jitter()
        let delay = delays[retries] + (extra.isFinite ? min(1, max(0, extra)) : 0)
        let serverDelay = requested.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil } ?? 0
        // An extraordinary server delay needs manual attention, not an overflowing sleep.
        guard serverDelay <= 86_400 * 365 else { exhaust(); return }
        retries += 1
        retryDeadline = now() + max(delay, serverDelay)
        schedule(at: retryDeadline!)
    }

    private func exhaust() {
        retryDeadline = nil
        changeDeadline = nil
        burstStart = nil
        deadline = nil
        phase = .needsAttention
    }
}
