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
    /// The switch position just chosen, until the server has answered and a pass has run.
    private(set) var pendingEnabled: Bool?
    /// The setting as the server last confirmed it: by a change, or by a pass that read it.
    private(set) var confirmedEnabled: Bool?
    /// Whether the switch reads on: the choice in progress, else the confirmed setting, else the last pass.
    var isEnabled: Bool { pendingEnabled ?? confirmedEnabled ?? summary.map { $0.status != .off } ?? false }
    /// The last pass, only when it agrees with the switch: nothing while turning on, "off" while turning off.
    var shownSummary: CloudSaveSummary? {
        guard let summary else { return nil }
        if !isEnabled { return CloudSaveSummary(status: .off) }
        return summary.status == .off ? nil : summary
    }

    typealias Scan = @Sendable () async throws -> InstalledSkillsScanner.ScanResult
    /// Every folder name in the skills folders, or nil when one of them couldn't be read.
    typealias FolderKeys = @Sendable () -> Set<String>?

    @ObservationIgnored private let api: any CloudSaveServing
    @ObservationIgnored private let sync: CloudSaveSync
    @ObservationIgnored private let credential: @MainActor () -> StoredDeviceCredential?
    @ObservationIgnored private let scan: Scan
    @ObservationIgnored private let folderKeys: FolderKeys
    @ObservationIgnored private let treeRecord: URL?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var taskID: UUID?
    @ObservationIgnored private var rerun = false
    @ObservationIgnored private var change = UUID()

    init(api: any CloudSaveServing, credential: @escaping @MainActor () -> StoredDeviceCredential?, scan: @escaping Scan,
         folderKeys: @escaping FolderKeys, treeRecord: URL? = CloudSaveController.defaultTreeRecord,
         pace: CloudSaveSync.Pace? = nil, links: CloudSaveFolder.LinkPolicy? = nil) {
        self.api = api
        var sync = CloudSaveSync(api: api)
        if let pace { sync.pace = pace }
        sync.links = links
        self.sync = sync
        self.credential = credential
        self.scan = scan
        self.folderKeys = folderKeys
        self.treeRecord = treeRecord
    }

    nonisolated static var defaultTreeRecord: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("omgskills/cloud-save-trees.json")
    }

    /// What each skill looked like here after the last pass, for this connection only.
    private struct TreeRecord: Codable {
        let deviceID: String
        let trees: [String: String]
    }

    private func lastTrees(for deviceID: String) -> [String: String] {
        guard let treeRecord, let data = try? Data(contentsOf: treeRecord),
              let record = try? JSONDecoder().decode(TreeRecord.self, from: data), record.deviceID == deviceID else { return [:] }
        return record.trees
    }

    private func remember(_ trees: [String: String], for deviceID: String) {
        guard let treeRecord else { return }
        try? FileManager.default.createDirectory(at: treeRecord.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(TreeRecord(deviceID: deviceID, trees: trees)).write(to: treeRecord, options: .atomic)
    }

    /// Folder names in the given skills folders as cloud keys. A missing folder has none; one that
    /// exists but can't be read makes the answer unknown.
    nonisolated static func folderKeys(in roots: [URL], fileManager: FileManager = .default) -> Set<String>? {
        var keys = Set<String>()
        for root in roots {
            guard fileManager.fileExists(atPath: root.path) else { continue }
            guard let names = try? fileManager.contentsOfDirectory(atPath: root.path) else { return nil }
            for name in names where !name.hasPrefix(".") { keys.insert(CloudSaveFolder.key(forFolderName: name)) }
        }
        return keys
    }

    @discardableResult
    func requestRun() -> Task<Void, Never>? {
        if let task { rerun = true; return task }
        let id = UUID()
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            repeat {
                rerun = false
                await runOnce()
            } while rerun && !Task.isCancelled
            // A pass cancelled and replaced must not forget its replacement.
            if taskID == id { self.task = nil; taskID = nil }
        }
        self.task = task
        taskID = id
        return task
    }

    @discardableResult
    func setEnabled(_ enabled: Bool) -> Task<Void, Never>? {
        guard let record = credential() else { return nil }
        message = nil
        // Turning it off stops a pass in progress; the server refuses anything after the change.
        if !enabled { cancel() }
        let id = UUID()
        change = id
        pendingEnabled = enabled
        return Task { @MainActor [weak self] in
            guard let self else { return }
            // Only the latest choice settles the switch.
            defer { if change == id { pendingEnabled = nil } }
            do {
                try await api.setEnabled(enabled, credential: record)
                if change == id { confirmedEnabled = enabled }
                if enabled { await requestRun()?.value }
                else { summary = CloudSaveSummary(status: .off) }
            } catch CloudSaveAPIError.permissionRequired {
                summary = CloudSaveSummary(status: .permissionRequired)
            } catch CloudSaveAPIError.reconnectRequired {
                summary = CloudSaveSummary(status: .reconnectRequired)
            } catch {
                message = "Sync could not be changed. Try again."
            }
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
        taskID = nil
        rerun = false
    }

    private func runOnce() async {
        guard let record = credential() else { return }
        isRunning = true
        defer { isRunning = false }
        do {
            let result = try await scan()
            let deviceID = record.connection.deviceID
            let keyRecord = treeRecord?.deletingLastPathComponent().appendingPathComponent("cloud-save-keys.json")
            let next = try await sync.run(installations: result.installations, localFolderKeys: folderKeys(),
                lastTrees: lastTrees(for: deviceID), lastKeys: CloudSaveKeys.remembered(at: keyRecord).keys,
                deviceID: deviceID, credential: record)
            guard !Task.isCancelled else { return }
            // Only a pass that reached every skill can say what this Mac's copies look like now.
            if [.upToDate, .incomplete].contains(next.status) {
                remember(next.localTrees, for: deviceID)
                CloudSaveKeys.remember(.init(keys: next.keys, records: next.records), at: keyRecord)
            }
            // A newer report asked for another pass while this one ran: its scan is out of date, so the count
            // here would replace a newer one. The queued pass publishes instead.
            // The server answered either way, so the sync section can show.
            if next.status != .unavailable { isAvailable = true }
            guard !rerun else { return }
            summary = next
            if [.off, .upToDate, .incomplete].contains(next.status) { confirmedEnabled = next.status != .off }
            message = nil
        } catch is CancellationError {
        } catch {
            message = "Sync could not finish. It will try again."
        }
    }

    /// The line under the My skills count: what this Mac has, then only what needs a look.
    nonisolated static func statusText(_ summary: CloudSaveSummary) -> String {
        switch summary.status {
        case .off: return "Not synced"
        case .permissionRequired: return "Reconnect this Mac to allow sync."
        case .reconnectRequired: return "Reconnect this Mac to keep syncing."
        case .storageFull: return "Sync storage is full."
        case .unavailable: return "Sync is unavailable right now. It will try again."
        case .upToDate, .incomplete:
            let attention = summary.attentionCount
            var parts = ["\(summary.hereCount) on this Mac"]
            if attention == 0 && summary.leftOutCount == 0 && summary.notSavedYetCount == 0 { parts.append("all synced") }
            if attention > 0 { parts.append("\(attention) can't sync") }
            if summary.notSavedYetCount > 0 { parts.append("\(summary.notSavedYetCount) not synced yet") }
            if summary.leftOutCount > 0 { parts.append("\(summary.leftOutCount) left out") }
            return parts.joined(separator: " · ")
        }
    }
}
#endif
