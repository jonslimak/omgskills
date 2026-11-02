import Foundation

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
    var libraryCount = 0
    var needsReview: [String] = []
    /// Skills that can't be saved, by key, with the reason.
    var skipped: [String: String] = [:]
}

/// Saves this Mac's own and edited skills to the cloud. One pass compares every
/// skill folder with its cloud copy and uploads what changed; it is safe to repeat.
struct CloudSaveSync: Sendable {
    typealias Pace = @Sendable () async throws -> Void

    let api: any CloudSaveServing
    /// Spaces requests out to stay well under the server's rate limit.
    var pace: Pace = { try await Task.sleep(for: .milliseconds(250)) }

    func run(installations: [Skill], scanComplete: Bool, deviceID: String,
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
        let (folders, localKeys) = candidates(installations, summary: &summary)

        for folder in folders where !excluded.contains(folder.key) {
            try Task.checkCancellation()
            if let current = saved[folder.key], current.currentVersion.treeSha == folder.treeSha {
                summary.savedCount += 1
                if current.deletedLocallyAt != nil {
                    do {
                        try await pace()
                        try await api.markDeletedLocally(key: folder.key, deleted: false, credential: credential)
                    } catch let error as CloudSaveAPIError {
                        if let stop = Self.stopStatus(error) { summary.status = stop; return summary }
                    }
                }
                continue
            }
            do {
                if try await save(folder, credential: credential) { summary.uploadedCount += 1 }
                summary.savedCount += 1
            } catch let error as CloudSaveAPIError {
                if let stop = Self.stopStatus(error) { summary.status = stop; return summary }
                switch error {
                case .needsReview: summary.needsReview.append(folder.key)
                case .tooLarge: summary.skipped[folder.key] = "Too large to save"
                case .excluded: break
                default: summary.skipped[folder.key] = "Could not be saved"
                }
            }
        }

        // A skill this Mac saved and no longer has stays in the cloud, marked deleted on this Mac.
        if scanComplete {
            for skill in state.skills where skill.deletedLocallyAt == nil
                && skill.currentVersion.deviceId == deviceID
                && !localKeys.contains(skill.key) && !excluded.contains(skill.key) {
                do {
                    try await pace()
                    try await api.markDeletedLocally(key: skill.key, deleted: true, credential: credential)
                } catch let error as CloudSaveAPIError {
                    if let stop = Self.stopStatus(error) { summary.status = stop; return summary }
                }
            }
        }
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
        var held: [CloudSaveFinding] = []
        for hash in missing {
            guard let entry = entries[hash] else { throw CloudSaveAPIError.invalidResponse }
            try Task.checkCancellation()
            try await pace()
            do { try await api.uploadFile(entry, confirmSecrets: false, credential: credential) }
            catch CloudSaveAPIError.needsReview(let findings) { held += findings }
        }
        if !held.isEmpty { throw CloudSaveAPIError.needsReview(held) }
        try await pace()
        guard case .saved(let created) = try await api.saveVersion(folder, credential: credential) else {
            throw CloudSaveAPIError.invalidResponse
        }
        return created
    }

    /// Reads each skill folder once per key. The same skill on two agents is one cloud skill;
    /// when the copies differ, the most recently edited one is saved.
    private func candidates(_ installations: [Skill], summary: inout CloudSaveSummary) -> ([CloudSaveFolder], Set<String>) {
        var chosen: [String: (folder: CloudSaveFolder, modified: String)] = [:]
        var localKeys = Set<String>()
        for skill in installations {
            let directory = URL(fileURLWithPath: skill.installCmd, isDirectory: true)
            let key = CloudSaveFolder.key(forFolderName: directory.lastPathComponent)
            localKeys.insert(key)
            let folder: CloudSaveFolder
            do { folder = try CloudSaveFolder.read(directory: directory) }
            catch CloudSaveFolder.ReadError.containsLink { summary.skipped[key] = "Contains links to other files"; continue }
            catch CloudSaveFolder.ReadError.invalid(let code) where [.fileTooLarge, .packageTooLarge, .tooManyFiles].contains(code) {
                summary.skipped[key] = "Too large to save"; continue
            }
            catch { summary.skipped[key] = "Could not be read"; continue }
            if Self.isUnchangedInstall(folder) {
                summary.libraryCount += 1
                continue
            }
            if let existing = chosen[key], existing.modified >= skill.lastUpdated { continue }
            chosen[key] = (folder, skill.lastUpdated)
            summary.skipped[key] = nil
        }
        return (chosen.values.map(\.folder).sorted { $0.key < $1.key }, localKeys)
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
        case .unavailable, .rateLimited, .invalidResponse: .unavailable
        case .excluded, .needsReview, .tooLarge, .rejected: nil
        }
    }

    private static func stopped(_ error: CloudSaveAPIError) -> CloudSaveSummary {
        CloudSaveSummary(status: stopStatus(error) ?? .unavailable)
    }
}
