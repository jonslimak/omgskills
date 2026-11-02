#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import Foundation
import Observation

/// Runs cloud save in the background after inventory reports, one pass at a time.
@MainActor
@Observable
final class CloudSaveController {
    private(set) var summary: CloudSaveSummary?
    /// Becomes true once the server has answered; until then the companion shows nothing.
    private(set) var isAvailable = false
    private(set) var isRunning = false
    private(set) var message: String?

    typealias Scan = @Sendable () async throws -> InstalledSkillsScanner.ScanResult

    @ObservationIgnored private let api: any CloudSaveServing
    @ObservationIgnored private let sync: CloudSaveSync
    @ObservationIgnored private let credential: @MainActor () -> StoredDeviceCredential?
    @ObservationIgnored private let scan: Scan
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var rerun = false

    init(api: any CloudSaveServing, credential: @escaping @MainActor () -> StoredDeviceCredential?, scan: @escaping Scan,
         pace: CloudSaveSync.Pace? = nil) {
        self.api = api
        var sync = CloudSaveSync(api: api)
        if let pace { sync.pace = pace }
        self.sync = sync
        self.credential = credential
        self.scan = scan
    }

    @discardableResult
    func requestRun() -> Task<Void, Never>? {
        if let task { rerun = true; return task }
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            repeat {
                rerun = false
                await runOnce()
            } while rerun && !Task.isCancelled
            self.task = nil
        }
        self.task = task
        return task
    }

    @discardableResult
    func setEnabled(_ enabled: Bool) -> Task<Void, Never>? {
        guard let record = credential() else { return nil }
        message = nil
        return Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await api.setEnabled(enabled, credential: record)
                if enabled { await requestRun()?.value }
                else { summary = CloudSaveSummary(status: .off) }
            } catch CloudSaveAPIError.permissionRequired {
                summary = CloudSaveSummary(status: .permissionRequired)
            } catch CloudSaveAPIError.reconnectRequired {
                summary = CloudSaveSummary(status: .reconnectRequired)
            } catch {
                message = "Cloud save could not be changed. Try again."
            }
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
        rerun = false
    }

    private func runOnce() async {
        guard let record = credential() else { return }
        isRunning = true
        defer { isRunning = false }
        do {
            let result = try await scan()
            let complete = result.issues.isEmpty
                && result.roots.allSatisfy { $0.state == .complete || $0.reason == .missing }
            let next = try await sync.run(installations: result.installations, scanComplete: complete,
                deviceID: record.connection.deviceID, credential: record)
            guard !Task.isCancelled else { return }
            if next.status != .unavailable { isAvailable = true }
            summary = next
            message = nil
        } catch is CancellationError {
        } catch {
            message = "Cloud save could not finish. It will try again."
        }
    }

    static func statusText(_ summary: CloudSaveSummary) -> String {
        switch summary.status {
        case .off: return "Cloud save is off."
        case .permissionRequired: return "Reconnect this Mac to allow cloud save."
        case .reconnectRequired: return "Reconnect this Mac to keep saving skills."
        case .storageFull: return "Cloud storage is full."
        case .unavailable: return "Cloud save is unavailable right now. It will try again."
        case .upToDate, .incomplete:
            var parts = ["\(summary.savedCount) \(summary.savedCount == 1 ? "skill" : "skills") saved"]
            if !summary.needsReview.isEmpty { parts.append("\(summary.needsReview.count) need review on the web") }
            if !summary.skipped.isEmpty { parts.append("\(summary.skipped.count) can't be saved") }
            return parts.joined(separator: " · ")
        }
    }
}
#endif
