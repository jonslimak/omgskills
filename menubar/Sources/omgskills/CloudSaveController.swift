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

    init(api: any CloudSaveServing, credential: @escaping @MainActor () -> StoredDeviceCredential?, scan: @escaping Scan,
         folderKeys: @escaping FolderKeys, treeRecord: URL? = CloudSaveController.defaultTreeRecord,
         pace: CloudSaveSync.Pace? = nil) {
        self.api = api
        var sync = CloudSaveSync(api: api)
        if let pace { sync.pace = pace }
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
            let next = try await sync.run(installations: result.installations, localFolderKeys: folderKeys(),
                lastTrees: lastTrees(for: deviceID), deviceID: deviceID, credential: record)
            guard !Task.isCancelled else { return }
            // Only a pass that reached every skill can say what this Mac's copies look like now.
            if [.upToDate, .incomplete].contains(next.status) { remember(next.localTrees, for: deviceID) }
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
            if summary.olderHereCount > 0 { parts.append("\(summary.olderHereCount) newer in the cloud") }
            return parts.joined(separator: " · ")
        }
    }
}
#endif
