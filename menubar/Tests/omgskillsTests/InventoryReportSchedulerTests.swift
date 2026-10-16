import Foundation
import Testing
@testable import omgskills

@MainActor
struct InventoryReportSchedulerTests {
    @Test func debounceUsesLatestEventAndCapsContinuousBursts() async {
        let clock = ReportTestClock()
        var calls = 0
        let scheduler = InventoryReportScheduler(now: { clock.now }, sleep: clock.sleep, jitter: { 0 }) {
            calls += 1
            return .reported(partial: false)
        }
        scheduler.changed()
        #expect(scheduler.phase == .stopped)
        scheduler.start()
        scheduler.changed()
        await clock.advance(2)
        scheduler.changed()
        await clock.advance(2)
        #expect(calls == 0)
        await clock.advance(1)
        #expect(calls == 1)
        for _ in 0..<30 {
            scheduler.changed()
            await clock.advance(1)
        }
        #expect(calls == 2)
        scheduler.stop()
    }

    @Test func transientFailuresHaveOnlyThreeRetriesAndEventsCannotResetBudget() async {
        let clock = ReportTestClock()
        var calls = 0
        let scheduler = InventoryReportScheduler(now: { clock.now }, sleep: clock.sleep, jitter: { 0 }) {
            calls += 1
            return .retryable(retryAfter: nil)
        }
        scheduler.start()
        scheduler.request()
        await clock.advance(0)
        #expect(calls == 1)
        for delay in [5.0, 30, 120] {
            let due = scheduler.deadline
            scheduler.changed()
            scheduler.request()
            #expect(scheduler.deadline == due)
            await clock.advance(delay)
        }
        #expect(calls == 4)
        #expect(scheduler.phase == .needsAttention)
        scheduler.changed()
        await clock.advance(1_000)
        #expect(calls == 4)
        scheduler.request()
        await clock.advance(0)
        #expect(calls == 5)
        scheduler.stop()
    }

    @Test func serverDelayIsMinimumAndJitterIsBounded() async {
        let clock = ReportTestClock()
        var calls = 0
        let scheduler = InventoryReportScheduler(now: { clock.now }, sleep: clock.sleep, jitter: { 100 }) {
            calls += 1
            return .retryable(retryAfter: calls == 1 ? 80 : nil)
        }
        scheduler.start()
        scheduler.request()
        await clock.advance(0)
        #expect(scheduler.deadline == 80)
        await clock.advance(79)
        #expect(calls == 1)
        await clock.advance(1)
        #expect(calls == 2)
        #expect(scheduler.deadline == 111)
        scheduler.stop()
    }

    @Test(arguments: [InventoryReportOutcome.needsAttention, .reconnectRequired, .cancelled,
                      .reported(partial: true), .reported(partial: false), .checked])
    func nonTransientOutcomesNeverRetry(_ outcome: InventoryReportOutcome) async {
        let clock = ReportTestClock()
        var calls = 0
        let scheduler = InventoryReportScheduler(now: { clock.now }, sleep: clock.sleep) {
            calls += 1
            return outcome
        }
        scheduler.start()
        scheduler.request()
        await clock.advance(0)
        await clock.advance(1_000)
        #expect(calls == 1)
        #expect(scheduler.lastOutcome == outcome)
        #expect(scheduler.deadline == nil)
        scheduler.stop()
    }

    @Test func onlyOneConflictRetryWithinTheSameBoundedCycle() async {
        let clock = ReportTestClock()
        var calls = 0
        let scheduler = InventoryReportScheduler(now: { clock.now }, sleep: clock.sleep, jitter: { 0 }) {
            calls += 1
            return .revisionConflict
        }
        scheduler.start()
        scheduler.request()
        await clock.advance(0)
        await clock.advance(5)
        #expect(calls == 2)
        #expect(scheduler.phase == .needsAttention)
        scheduler.stop()
    }

    @Test(arguments: [InventoryReportOutcome.reported(partial: false), .checked])
    func eventsDuringReportCoalesceAndStopFencesLateCompletion(_ success: InventoryReportOutcome) async {
        let clock = ReportTestClock()
        var continuation: CheckedContinuation<InventoryReportOutcome, Never>?
        var calls = 0
        let scheduler = InventoryReportScheduler(now: { clock.now }, sleep: clock.sleep) {
            calls += 1
            return await withCheckedContinuation { continuation = $0 }
        }
        scheduler.start()
        scheduler.request()
        await clock.advance(0)
        for _ in 0..<20 { scheduler.changed() }
        #expect(calls == 1)
        continuation?.resume(returning: success)
        await clock.advance(0)
        #expect(scheduler.deadline == 3)
        await clock.advance(3)
        #expect(calls == 2)
        scheduler.stop()
        scheduler.start()
        continuation?.resume(returning: .retryable(retryAfter: nil))
        await clock.advance(0)
        #expect(scheduler.phase == .idle)
        #expect(scheduler.deadline == nil)
        #expect(scheduler.lastOutcome == nil)
        scheduler.stop()
    }

    @Test func stopCancelsDebounceAndBackoff() async {
        let clock = ReportTestClock()
        var calls = 0
        let scheduler = InventoryReportScheduler(now: { clock.now }, sleep: clock.sleep, jitter: { 0 }) {
            calls += 1
            return .retryable(retryAfter: nil)
        }
        scheduler.start()
        scheduler.changed()
        scheduler.stop()
        await clock.advance(100)
        #expect(calls == 0)
        scheduler.start()
        scheduler.request()
        await clock.advance(0)
        scheduler.stop()
        await clock.advance(1_000)
        #expect(calls == 1)
        #expect(scheduler.phase == .stopped)
    }

    @Test func restartedSessionWaitsForUncooperativeOldReportBeforeStartingAnother() async {
        let clock = ReportTestClock()
        var continuation: CheckedContinuation<InventoryReportOutcome, Never>?
        var calls = 0
        let scheduler = InventoryReportScheduler(now: { clock.now }, sleep: clock.sleep) {
            calls += 1
            if calls == 1 {
                return await withCheckedContinuation { continuation = $0 }
            }
            return .reported(partial: false)
        }
        scheduler.start()
        scheduler.request()
        await clock.advance(0)
        #expect(calls == 1)
        scheduler.stop()
        scheduler.start()
        scheduler.request()
        await clock.advance(0)
        #expect(calls == 1)
        continuation?.resume(returning: .retryable(retryAfter: 100))
        await clock.advance(0)
        #expect(calls == 2)
        #expect(scheduler.lastOutcome == .reported(partial: false))
        #expect(scheduler.deadline == nil)
        await scheduler.stopAndWait()
    }

    @Test func errorClassificationDoesNotRetryUnsafeOrInvalidFailures() {
        #expect(InventoryReportOutcome.failure(URLError(.timedOut)) == .retryable(retryAfter: nil))
        #expect(InventoryReportOutcome.failure(URLError(.notConnectedToInternet)) == .retryable(retryAfter: nil))
        #expect(InventoryReportOutcome.failure(URLError(.cancelled)) == .cancelled)
        #expect(InventoryReportOutcome.failure(URLError(.serverCertificateUntrusted)) == .needsAttention)
        #expect(InventoryReportOutcome.failure(CancellationError()) == .cancelled)
        #expect(InventoryReportOutcome.failure(DeviceSyncAPIError.invalidResponse) == .needsAttention)
        #expect(InventoryReportOutcome.failure(DeviceSyncAPIError.server(statusCode: 400)) == .needsAttention)
        #expect(InventoryReportOutcome.failure(NSError(domain: NSCocoaErrorDomain, code: 257)) == .needsAttention)
    }

    @Test func extraordinaryServerDelayStopsInsteadOfOverflowingOrRetryingEarly() async {
        let clock = ReportTestClock()
        var calls = 0
        let scheduler = InventoryReportScheduler(now: { clock.now }, sleep: clock.sleep) {
            calls += 1
            return .retryable(retryAfter: Double.greatestFiniteMagnitude)
        }
        scheduler.start()
        scheduler.request()
        await clock.advance(0)
        #expect(calls == 1)
        #expect(scheduler.phase == .needsAttention)
        #expect(scheduler.deadline == nil)
        scheduler.stop()
    }
}

@MainActor
private final class ReportTestClock {
    var now: TimeInterval = 0
    private var sleepers: [UUID: (TimeInterval, CheckedContinuation<Void, any Error>)] = [:]

    func sleep(_ delay: TimeInterval) async throws {
        try Task.checkCancellation()
        if delay <= 0 { return }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                sleepers[id] = (now + delay, continuation)
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                self?.sleepers.removeValue(forKey: id)?.1.resume(throwing: CancellationError())
            }
        }
    }

    func advance(_ seconds: TimeInterval) async {
        for _ in 0..<30 { await Task.yield() }
        now += seconds
        for (id, entry) in sleepers where entry.0 <= now {
            sleepers.removeValue(forKey: id)?.1.resume()
        }
        for _ in 0..<30 { await Task.yield() }
    }
}
