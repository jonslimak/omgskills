import Foundation

/// Why a skill wasn't saved, as the web shows it.
enum CloudSaveSkipReason: String, Equatable, Sendable {
    /// An unchanged library or Set install, which can be fetched again.
    case library
    case links
    case tooLarge = "too_large"
    case unreadable
    case failed
}

/// The outcome of one cloud save pass, for the companion's status line.
struct CloudSaveSummary: Equatable, Sendable {
    enum Status: Equatable, Sendable {
        case off
        case upToDate
        case incomplete
        case permissionRequired
        case reconnectRequired
        case storageFull
        case unavailable
    }

    var status: Status
    /// Skills whose cloud copy matches this Mac.
    var savedCount = 0
    /// New versions saved in this pass.
    var uploadedCount = 0
    /// Library and Set installs left unchanged, which are not uploaded.
    var library: Set<String> = []
    var libraryCount: Int { library.count }
    /// Skills whose copy here is older than the one already in the cloud, so it isn't saved over it.
    var olderHereCount = 0
    var needsReview: [String] = []
    /// Skills that can't be saved, by key, with the reason.
    var skipped: [String: CloudSaveSkipReason] = [:]
    /// The tree of every skill folder read in this pass, to tell next time whether it changed here.
    var localTrees: [String: String] = [:]
}

/// Saves this Mac's own and edited skills to the cloud. One pass compares every
/// skill folder with its cloud copy and uploads what changed; it is safe to repeat.
struct CloudSaveSync: Sendable {
    typealias Pace = @Sendable () async throws -> Void

    let api: any CloudSaveServing
    /// Spaces requests out to stay well under the server's rate limit.
    var pace: Pace = { try await Task.sleep(for: .milliseconds(250)) }
    /// Which links inside skill folders are followed; without one, a folder with a link isn't saved.
    var links: CloudSaveFolder.LinkPolicy?

    /// `localFolderKeys` lists every skill folder name on this Mac, valid or not, or nil when a
    /// skills folder couldn't be read; deletions are only marked when it is known.
    /// `lastTrees` is what each skill looked like on this Mac at the end of the previous pass.
    func run(installations: [Skill], localFolderKeys: Set<String>?, lastTrees: [String: String] = [:], deviceID: String,
             credential: StoredDeviceCredential) async throws -> CloudSaveSummary {
        let state: CloudSaveState
        do { state = try await api.state(credential: credential) }
        catch let error as CloudSaveAPIError { return Self.stopped(error) }
        guard state.settings.enabled else { return CloudSaveSummary(status: .off) }
        guard credential.connection.grantedScopes.contains(.contentWrite) else {
            return CloudSaveSummary(status: .permissionRequired)
        }

        var summary = CloudSaveSummary(status: .upToDate)
        let excluded = Set(state.settings.excludedSkillKeys)
        let saved = Dictionary(state.skills.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
        let folders = candidates(installations, summary: &summary)
        // A copy that isn't settled (not saved, waiting for review) keeps its earlier record,
        // so it still counts as changed here next time.
        summary.localTrees = lastTrees.filter { key, _ in folders.contains { $0.key == key } }

        for folder in folders where !excluded.contains(folder.key) {
            try Task.checkCancellation()
            if let current = saved[folder.key], current.currentVersion.treeSha == folder.treeSha {
                summary.savedCount += 1
                summary.localTrees[folder.key] = folder.treeSha
                // Only the Mac that saved it clears its "deleted" mark; another Mac's copy would flip it back and forth.
                if current.deletedLocallyAt != nil && current.currentVersion.deviceId == deviceID {
                    do {
                        try await pace()
                        try await api.markDeletedLocally(key: folder.key, deleted: false, credential: credential)
                    } catch let error as CloudSaveAPIError {
                        if let stop = Self.stopStatus(error) { summary.status = stop; return summary }
                    }
                }
                continue
            }
            // A stale copy on this Mac must not replace a newer save from another Mac.
            if let current = saved[folder.key], !Self.isNewerHere(folder, than: current, lastTree: lastTrees[folder.key],
                                                                   deviceID: deviceID) {
                summary.olderHereCount += 1
                summary.localTrees[folder.key] = folder.treeSha
                continue
            }
            do {
                if try await save(folder, credential: credential) { summary.uploadedCount += 1 }
                summary.savedCount += 1
                summary.localTrees[folder.key] = folder.treeSha
            } catch let error as CloudSaveAPIError {
                if let stop = Self.stopStatus(error) { summary.status = stop; return summary }
                switch error {
                case .needsReview: summary.needsReview.append(folder.key)
                case .tooLarge: summary.skipped[folder.key] = .tooLarge
                case .excluded: break
                default: summary.skipped[folder.key] = .failed
                }
            }
        }

        // A skill this Mac saved and no longer has stays in the cloud, marked deleted on this Mac.
        if let localFolderKeys {
            for skill in state.skills where skill.deletedLocallyAt == nil
                && skill.currentVersion.deviceId == deviceID
                && !localFolderKeys.contains(skill.key) && !excluded.contains(skill.key) {
                do {
                    try await pace()
                    try await api.markDeletedLocally(key: skill.key, deleted: true, credential: credential)
                } catch let error as CloudSaveAPIError {
                    if let stop = Self.stopStatus(error) { summary.status = stop; return summary }
                }
            }
            // A skill this Mac had waiting for review and has since deleted no longer waits.
            for review in state.needsReview where review.deviceId == deviceID && !localFolderKeys.contains(review.key) {
                try? await pace()
                try? await api.withdrawReview(key: review.key, credential: credential)
            }
        }
        // Only a finished pass knows every reason; the web keeps the last full report until then.
        let report = summary.skipped.merging(summary.library.map { ($0, .library) }, uniquingKeysWith: { reason, _ in reason })
            .filter { !excluded.contains($0.key) }
        try? await pace()
        try? await api.reportSkipped(report, credential: credential)
        if !summary.needsReview.isEmpty || !summary.skipped.isEmpty { summary.status = .incomplete }
        summary.needsReview.sort()
        return summary
    }

    /// Saves one version, uploading only the files the server doesn't have. Returns whether it was new.
    private func save(_ folder: CloudSaveFolder, credential: StoredDeviceCredential) async throws -> Bool {
        try await pace()
        let missing: [String]
        switch try await api.saveVersion(folder, credential: credential) {
        case .saved(let created): return created
        case .missingFiles(let hashes): missing = hashes
        }
        let entries = Dictionary(folder.entries.map { ($0.blobSha, $0) }, uniquingKeysWith: { first, _ in first })
        let upload = try missing.map { hash in
            guard let entry = entries[hash] else { throw CloudSaveAPIError.invalidResponse }
            return entry
        }
        try Task.checkCancellation()
        try await pace()
        var held: [CloudSaveFinding] = []
        // Files too big for a batch, or every file on a server without batch upload, go one at a time.
        var oneByOne = upload.filter { $0.data.count > CloudSaveAPI.batchBytes }
        let batched = upload.filter { $0.data.count <= CloudSaveAPI.batchBytes }
        if !batched.isEmpty {
            do { held = try await api.uploadFiles(batched, credential: credential) }
            catch is CloudSaveBatchUnsupported { oneByOne = upload }
        }
        for entry in oneByOne {
            try Task.checkCancellation()
            try await pace()
            do { try await api.uploadFile(entry, confirmSecrets: false, credential: credential) }
            catch CloudSaveAPIError.needsReview(let findings) { held += findings }
        }
        if !held.isEmpty {
            // Asking to save again records the skill for review on the web now, not on the next pass.
            try await pace()
            _ = try? await api.saveVersion(folder, credential: credential)
            throw CloudSaveAPIError.needsReview(held)
        }
        try await pace()
        guard case .saved(let created) = try await api.saveVersion(folder, credential: credential) else {
            throw CloudSaveAPIError.invalidResponse
        }
        return created
    }

    /// Reads each skill folder once per key. The same skill on two agents is one cloud skill;
    /// when the copies differ, the most recently edited one is saved.
    private func candidates(_ installations: [Skill], summary: inout CloudSaveSummary) -> [CloudSaveFolder] {
        var chosen: [String: CloudSaveFolder] = [:]
        for skill in installations {
            let directory = URL(fileURLWithPath: skill.installCmd, isDirectory: true)
            let key = CloudSaveFolder.key(forFolderName: directory.lastPathComponent)
            let folder: CloudSaveFolder
            do { folder = try CloudSaveFolder.read(directory: directory, links: links) }
            catch CloudSaveFolder.ReadError.libraryInstall { summary.library.insert(key); continue }
            catch CloudSaveFolder.ReadError.containsLink { summary.skipped[key] = .links; continue }
            catch CloudSaveFolder.ReadError.privateLink { summary.skipped[key] = .links; continue }
            catch CloudSaveFolder.ReadError.invalid(let code) where [.fileTooLarge, .packageTooLarge, .tooManyFiles].contains(code) {
                summary.skipped[key] = .tooLarge; continue
            }
            catch { summary.skipped[key] = .unreadable; continue }
            if Self.isUnchangedInstall(folder) {
                summary.library.insert(key)
                continue
            }
            // Any file counts as an edit, not just SKILL.md.
            if let existing = chosen[key], existing.modifiedAt >= folder.modifiedAt { continue }
            chosen[key] = folder
            summary.skipped[key] = nil
            summary.library.remove(key)
        }
        // An edited copy on another agent is saved, even when this one is unchanged.
        summary.library.subtract(chosen.keys)
        return chosen.values.sorted { $0.key < $1.key }
    }

    /// Whether this Mac's copy should replace the cloud's current version, which differs from it.
    /// This Mac's own save is always replaced. Another Mac's is replaced only by an edit made here:
    /// the copy changed since the last pass, or, for a skill not seen here before, a file was
    /// modified after that save.
    static func isNewerHere(_ folder: CloudSaveFolder, than current: CloudSaveState.SavedSkill, lastTree: String?,
                            deviceID: String) -> Bool {
        if current.currentVersion.deviceId == deviceID { return true }
        if let lastTree { return lastTree != folder.treeSha }
        guard let savedAt = date(current.currentVersion.savedAt) else { return true }
        return folder.modifiedAt > savedAt
    }

    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    /// A skill installed by omgskills from the library or a Set, with its files unchanged.
    static func isUnchangedInstall(_ folder: CloudSaveFolder) -> Bool {
        let directory = folder.directory
        guard let provenance = SkillInstallProvenanceStore.read(targetRoot: directory.deletingLastPathComponent(),
                                                                 targetName: directory.lastPathComponent) else { return false }
        if let treeSha = provenance.treeSha { return treeSha.lowercased() == folder.treeSha }
        // Older installs recorded only SKILL.md.
        return folder.entries.count == 1 && provenance.skillMdSha?.lowercased() == folder.coordinates.skillMdSha
    }

    private static func stopStatus(_ error: CloudSaveAPIError) -> CloudSaveSummary.Status? {
        switch error {
        case .disabled: .off
        case .permissionRequired: .permissionRequired
        case .reconnectRequired: .reconnectRequired
        case .storageFull: .storageFull
        case .unavailable, .rateLimited: .unavailable
        // One skill's problem never stops the others.
        case .excluded, .needsReview, .tooLarge, .rejected, .invalidResponse: nil
        }
    }

    private static func stopped(_ error: CloudSaveAPIError) -> CloudSaveSummary {
        CloudSaveSummary(status: stopStatus(error) ?? .unavailable)
    }
}
