import Foundation

/// Why a skill wasn't saved, as the web shows it.
enum CloudSaveSkipReason: String, Equatable, Sendable {
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
    /// Skills whose copy here is older than the one already in the cloud, so it isn't saved over it.
    var olderHereCount = 0
    var needsReview: [String] = []
    /// Skills that can't be saved, by key, with the reason.
    var skipped: [String: CloudSaveSkipReason] = [:]
    /// Every skill: on this Mac or kept in the cloud. The cloud keeps a record of each one,
    /// so a skill whose files need attention still counts.
    var skillCount = 0
    /// Skills kept in the cloud that aren't on this Mac (deleted here, or from another Mac).
    var notOnThisMacCount = 0
    /// Skills on this Mac, one per folder name.
    var hereCount = 0
    /// Library skills added to My skills that are neither on this Mac nor saved in the account.
    var addedCount = 0
    /// Everything in My skills: what this Mac has, what the account keeps, and added library skills.
    var mySkillsCount: Int { skillCount + addedCount }
    /// Skills on this Mac you chose to leave out of cloud save.
    var leftOutCount = 0
    /// Unchanged library and Set installs not uploaded yet: a pass saves only a few, so the first
    /// sync after installing many doesn't flood the server. The rest follow on later passes.
    var notSavedYetCount = 0
    /// Skills whose files keep them from being saved until something is done, shown on the web.
    var attentionCount: Int { needsReview.count + skipped.count }
    /// The tree of every skill folder read in this pass, to tell next time whether it changed here.
    var localTrees: [String: String] = [:]
    /// The cloud key of every skill here, by `installCmd`, to keep each skill on its key next time.
    var keys: [String: String] = [:]
    /// The account's saved skills, for finding keys between passes.
    var records: [CloudSaveKeys.Record] = []
}

/// Saves every skill on this Mac to the cloud, library and Set installs included. One pass compares every
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
    /// `lastKeys` is each skill's cloud key from the previous pass, by `installCmd`.
    func run(installations: [Skill], localFolderKeys: Set<String>?, lastTrees: [String: String] = [:],
             lastKeys: [String: String] = [:], deviceID: String,
             credential: StoredDeviceCredential) async throws -> CloudSaveSummary {
        let state: CloudSaveState
        do { state = try await api.state(credential: credential) }
        catch let error as CloudSaveAPIError { return Self.stopped(error) }
        guard state.settings.enabled else { return CloudSaveSummary(status: .off) }
        guard credential.connection.grantedScopes.contains(.contentWrite) else {
            return CloudSaveSummary(status: .permissionRequired)
        }

        var summary = CloudSaveSummary(status: .upToDate)
        var excluded = Set(state.settings.excludedSkillKeys)
        let saved = Dictionary(state.skills.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
        let records = CloudSaveKeys.records(from: state)
        let keys = CloudSaveKeys.keys(for: installations, records: records, remembered: lastKeys, deviceID: deviceID)
        summary.keys = keys
        summary.records = records
        // A skill left out under its folder name stays left out when it moves to its own key (a different
        // skill with the same folder name took the folder key).
        let remembered = Set(lastKeys.values), recorded = Set(state.skills.map(\.key))
        let split = Set(installations.compactMap { skill -> String? in
            guard let key = keys[skill.installCmd] else { return nil }
            let folder = CloudSaveKeys.folderKey(of: skill)
            return key != folder && excluded.contains(folder) && !excluded.contains(key)
                && !recorded.contains(key) && !remembered.contains(key) ? key : nil
        })
        if !split.isEmpty {
            do {
                try await pace()
                try await api.setExcluded(split.sorted(), credential: credential)
            } catch let error as CloudSaveAPIError {
                if let stop = Self.stopStatus(error) { summary.status = stop; return summary }
                // Not saved this pass, and not remembered, so the next pass tries again.
                summary.keys = summary.keys.filter { !split.contains($0.value) }
            }
            excluded.formUnion(split)
        }
        let folders = candidates(installations, keys: keys, summary: &summary)
        // What is here: every skill by its key, and folders that aren't readable skills by their name. A folder
        // name alone doesn't keep another skill's key here (the skill once saved under it may be gone).
        let skillFolders = Set(installations.map(CloudSaveKeys.folderKey(of:)))
        let localFolderKeys = localFolderKeys.map { $0.subtracting(skillFolders).union(keys.values) }
        // A copy that isn't settled (not saved, waiting for review) keeps its earlier record,
        // so it still counts as changed here next time.
        summary.localTrees = lastTrees.filter { key, _ in folders.contains { $0.key == key } }

        // Your own and edited skills go first, so unchanged installs never crowd them out of storage.
        let unchanged = Set(folders.filter(Self.isUnchangedInstall).map(\.key))
        let ordered = folders.filter { !unchanged.contains($0.key) } + folders.filter { unchanged.contains($0.key) }
        var installUploads = 0

        for folder in ordered where !excluded.contains(folder.key) {
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
                                                                   deviceID: deviceID, unchangedInstall: unchanged.contains(folder.key)) {
                summary.olderHereCount += 1
                summary.localTrees[folder.key] = folder.treeSha
                continue
            }
            if unchanged.contains(folder.key) {
                guard installUploads < Self.installUploadsPerPass else { summary.notSavedYetCount += 1; continue }
                installUploads += 1
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
                case .nameTaken:
                    // Another Mac just saved a different skill under this key; the next pass picks another.
                    summary.keys = summary.keys.filter { $0.value != folder.key }
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
        let here = Set(keys.values)
        // A review this Mac just withdrew (its skill is gone from here) no longer counts.
        let withdrawn = Set(state.needsReview.filter { $0.deviceId == deviceID && localFolderKeys?.contains($0.key) == false }.map(\.key))
        let inCloud = Set(state.skills.map(\.key)).union(state.needsReview.map(\.key).filter { !withdrawn.contains($0) })
        summary.skipped = summary.skipped.filter { !excluded.contains($0.key) }
        summary.skillCount = here.union(inCloud).count
        summary.hereCount = here.count
        summary.notOnThisMacCount = inCloud.subtracting(here).count
        try? await pace()
        if let additions = try? await api.mySkillAdditions(credential: credential) {
            summary.addedCount = Self.addedNotListed(additions, installations: installations, keys: here.union(inCloud))
        }
        summary.leftOutCount = here.intersection(excluded).count
        // Only a finished pass knows every reason; the web keeps the last full report until then.
        let report = summary.skipped.filter { !excluded.contains($0.key) }
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
    /// when the copies differ, the most recently edited one is saved. Different skills in same-name
    /// folders have different keys, so each is saved.
    private func candidates(_ installations: [Skill], keys: [String: String],
                            summary: inout CloudSaveSummary) -> [CloudSaveFolder] {
        var chosen: [String: CloudSaveFolder] = [:]
        for skill in installations {
            let directory = URL(fileURLWithPath: skill.installCmd, isDirectory: true)
            let key = keys[skill.installCmd] ?? CloudSaveFolder.key(forFolderName: directory.lastPathComponent)
            var folder: CloudSaveFolder
            do { folder = try CloudSaveFolder.read(directory: directory, key: key, links: links) }
            catch CloudSaveFolder.ReadError.containsLink { summary.skipped[key] = .links; continue }
            catch CloudSaveFolder.ReadError.privateLink { summary.skipped[key] = .links; continue }
            catch CloudSaveFolder.ReadError.invalid(let code) where [.fileTooLarge, .packageTooLarge, .tooManyFiles].contains(code) {
                summary.skipped[key] = .tooLarge; continue
            }
            catch { summary.skipped[key] = .unreadable; continue }
            // Any file counts as an edit, not just SKILL.md.
            if let existing = chosen[key], existing.modifiedAt >= folder.modifiedAt { continue }
            folder.name = skill.name
            chosen[key] = folder
            summary.skipped[key] = nil
        }
        // A copy on another agent that reads fine is saved, even when this one can't be read.
        summary.skipped = summary.skipped.filter { chosen[$0.key] == nil }
        return chosen.values.sorted { $0.key < $1.key }
    }

    /// Whether this Mac's copy should replace the cloud's current version, which differs from it.
    /// This Mac's own save is always replaced. Another Mac's is replaced only by an edit made here:
    /// the copy changed since the last pass, or, for a skill not seen here before, a file was
    /// modified after that save.
    /// An unchanged library or Set install never replaces another Mac's save: that one may hold your edits.
    static func isNewerHere(_ folder: CloudSaveFolder, than current: CloudSaveState.SavedSkill, lastTree: String?,
                            deviceID: String, unchangedInstall: Bool = false) -> Bool {
        if current.currentVersion.deviceId == deviceID { return true }
        if unchangedInstall { return false }
        if let lastTree { return lastTree != folder.treeSha }
        guard let savedAt = date(current.currentVersion.savedAt) else { return true }
        return folder.modifiedAt > savedAt
    }

    /// Added library skills that nothing else in My skills stands for: not installed here (by catalog ID), and
    /// no skill here or in the account under the folder name a library install would use.
    /// Unlike the web, skills only on another Mac and not synced aren't known here, so this count can be lower.
    static func addedNotListed(_ catalogIDs: [String], installations: [Skill], keys: Set<String>) -> Int {
        let installed = Set(installations.compactMap(\.catalogSkillId))
        return Set(catalogIDs).filter { id in
            let name = id.split(separator: ":").last.map(String.init) ?? id
            return !installed.contains(id) && !keys.contains(CloudSaveFolder.key(forFolderName: name))
        }.count
    }

    /// How many unchanged installs one pass uploads.
    static let installUploadsPerPass = 20

    /// A skill installed by omgskills from the library or a Set, with its files unchanged.
    static func isUnchangedInstall(_ folder: CloudSaveFolder) -> Bool {
        let directory = folder.directory
        guard let provenance = SkillInstallProvenanceStore.read(targetRoot: directory.deletingLastPathComponent(),
                                                                 targetName: directory.lastPathComponent) else { return false }
        if let treeSha = provenance.treeSha { return treeSha.lowercased() == folder.treeSha }
        // Older installs recorded only SKILL.md.
        return folder.entries.count == 1 && provenance.skillMdSha?.lowercased() == folder.coordinates.skillMdSha
    }

    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private static func stopStatus(_ error: CloudSaveAPIError) -> CloudSaveSummary.Status? {
        switch error {
        case .disabled: .off
        case .permissionRequired: .permissionRequired
        case .reconnectRequired: .reconnectRequired
        case .storageFull: .storageFull
        case .unavailable, .rateLimited: .unavailable
        // One skill's problem never stops the others.
        case .excluded, .nameTaken, .needsReview, .tooLarge, .rejected, .invalidResponse: nil
        }
    }

    private static func stopped(_ error: CloudSaveAPIError) -> CloudSaveSummary {
        CloudSaveSummary(status: stopStatus(error) ?? .unavailable)
    }
}
