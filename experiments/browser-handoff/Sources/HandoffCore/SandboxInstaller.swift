import CryptoKit
import Darwin
import Foundation

struct InstallCandidate: Sendable {
    let pin: PublicPin
    let package: SkillPackage

    func validate() throws {
        guard [HandoffRequest.pinnedTestSkillID, HandoffRequest.testSkillID].contains(pin.id) else {
            throw InstallFailure.invalidRecord
        }
        _ = try SkillPackageValidator.validate(package, expected: .init(
            commitSha: pin.commit, treeSha: pin.treeSHA ?? package.coordinates.treeSha, skillMdSha: pin.skillSHA
        ), limits: PublicPackageLoader.limits)
    }
}

private struct InstallRecord: Codable {
    let schema: Int
    let owner: String
    let sandboxID: String
    let versionID: String
    let previousID: String?
    let installedAt: Date
    let target: String
    let catalogID: String
    let repo: String
    let path: String
    let commit: String
    let tree: String
    let skillSHA: String
    let files: [File]
    struct File: Codable { let path: String; let mode: String; let size: Int; let sha: String }
}

private struct StoredInstall {
    let record: InstallRecord
    let candidate: InstallCandidate
    let digest: String
    var fingerprint: String { record.versionID + ":" + digest }
}

private struct ApprovedPlan: Sendable {
    let review: InstallReview
    let candidate: InstallCandidate
    let base: String?
    let restoreBase: String?
}

actor SandboxInstaller {
    static let targetName = "frontend-design"
    static let target = "codex/skills/frontend-design"
    let sandbox: InstallSandbox
    private var plan: ApprovedPlan?
    // Used only by the local subprocess harness; no browser or downloaded value can select a hook.
    private let beforeSwitch: @Sendable () throws -> Void
    private let afterSwitch: @Sendable () -> Void

    init(sandbox: InstallSandbox, beforeSwitch: @escaping @Sendable () throws -> Void = {},
         afterSwitch: @escaping @Sendable () -> Void = {}) {
        self.sandbox = sandbox
        self.beforeSwitch = beforeSwitch
        self.afterSwitch = afterSwitch
    }

    func prepare(_ candidate: InstallCandidate) throws -> InstallReview {
        plan = nil
        try Task.checkCancellation()
        try candidate.validate()
        let root = try sandbox.open()
        let lock = try root.lock()
        defer { lock.release() }
        do {
            let (versions, target) = try directories(root)
            let current = try current(versions, target)
            return try makePlan(candidate, current: current, restoring: nil)
        }
    }

    func prepareRestore() throws -> InstallReview {
        plan = nil
        try Task.checkCancellation()
        let root = try sandbox.open()
        let lock = try root.lock()
        defer { lock.release() }
        do {
            let (versions, target) = try directories(root)
            guard let current = try current(versions, target), let previous = current.record.previousID else {
                throw InstallFailure.noBackup
            }
            let backup = try readVersion(previous, versions)
            return try makePlan(backup.candidate, current: current, restoring: backup.fingerprint)
        }
    }

    func discard(_ id: UUID) { if plan?.review.id == id { plan = nil } }

    func apply(_ id: UUID) throws -> String {
        guard let approved = plan, approved.review.id == id else { throw InstallFailure.staleReview }
        plan = nil
        try Task.checkCancellation()
        let root = try sandbox.open()
        let lock = try root.lock()
        defer { lock.release() }
        do {
            let (versions, target) = try directories(root)
            let old = try current(versions, target)
            guard old?.fingerprint == approved.base else { throw InstallFailure.staleReview }
            if let backup = approved.restoreBase {
                guard let previous = old?.record.previousID,
                      try readVersion(previous, versions).fingerprint == backup else { throw InstallFailure.staleReview }
            }
            if approved.review.action == .unchanged { return "Already installed. No changes made." }
            try approved.candidate.validate()
            let versionID = UUID().uuidString
            guard mkdirat(versions.fd, versionID, 0o700) == 0 else { throw InstallFailure.io }
            let version = try versions.child(versionID)
            let content = try version.child("content", create: true)
            for entry in approved.candidate.package.entries {
                try Task.checkCancellation()
                try content.write(entry.path, data: entry.data, mode: entry.mode == "100755" ? 0o755 : 0o644)
            }
            let pin = approved.candidate.pin, package = approved.candidate.package
            let record = InstallRecord(
                schema: 1, owner: "omgskills-handoff-test", sandboxID: sandbox.id, versionID: versionID,
                previousID: old?.record.versionID, installedAt: Date(), target: Self.target,
                catalogID: pin.id, repo: pin.repo, path: pin.path, commit: pin.commit,
                tree: package.coordinates.treeSha, skillSHA: pin.skillSHA,
                files: package.entries.sorted { $0.path < $1.path }.map {
                    .init(path: $0.path, mode: $0.mode, size: $0.data.count, sha: $0.blobSha)
                }
            )
            try version.write("record.json", data: JSONEncoder().encode(record))
            _ = try readVersion(versionID, versions)
            try beforeSwitch()
            // Consent is bound to the entire installed state, not just its commit name.
            guard try current(versions, target)?.fingerprint == approved.base else { throw InstallFailure.staleReview }
            if let backup = approved.restoreBase {
                guard let previous = old?.record.previousID,
                      try readVersion(previous, versions).fingerprint == backup else { throw InstallFailure.staleReview }
            }
            try Task.checkCancellation()
            let temporary = ".h12-link-" + UUID().uuidString
            let link = "../../.managed/versions/\(versionID)/content"
            guard symlinkat(link, target.fd, temporary) == 0 else { throw InstallFailure.io }
            defer { unlinkat(target.fd, temporary, 0) }
            // Never check cancellation after publication or remove the newly active version on error.
            let result = old == nil
                ? renameatx_np(target.fd, temporary, target.fd, Self.targetName, UInt32(RENAME_EXCL))
                : renameat(target.fd, temporary, target.fd, Self.targetName)
            guard result == 0 else { throw InstallFailure.io }
            afterSwitch()
            guard try current(versions, target)?.record.versionID == versionID else { throw InstallFailure.io }
            return approved.review.action == .restore ? "Previous version restored." : "Verified version installed."
        }
    }

    func installedCommit() throws -> String? {
        let root = try sandbox.open()
        let lock = try root.lock()
        defer { lock.release() }
        do {
            let (versions, target) = try directories(root)
            return try current(versions, target)?.record.commit
        }
    }

    private func makePlan(_ candidate: InstallCandidate, current: StoredInstall?, restoring: String?) throws -> InstallReview {
        if let current {
            guard current.record.catalogID == candidate.pin.id, current.record.repo == candidate.pin.repo,
                  current.record.path == candidate.pin.path else { throw InstallFailure.unmanaged }
        }
        let unchanged = current?.candidate.package.coordinates == candidate.package.coordinates
        let review = InstallReview(
            id: UUID(), action: unchanged ? .unchanged : restoring != nil ? .restore : current == nil ? .install : .update,
            skillID: candidate.pin.id, destination: sandbox.url.appendingPathComponent(Self.target).path,
            fromCommit: current?.record.commit, toCommit: candidate.pin.commit,
            fileCount: candidate.package.entries.count, canRestore: current?.record.previousID != nil,
            changes: try PackageReview.changes(from: current?.candidate.package, to: candidate.package)
        )
        try Task.checkCancellation()
        plan = ApprovedPlan(review: review, candidate: candidate, base: current?.fingerprint, restoreBase: restoring)
        return review
    }

    private func directories(_ root: SandboxDirectory) throws -> (SandboxDirectory, SandboxDirectory) {
        let versions = try root.child(".managed", create: true).child("versions", create: true)
        let target = try root.child("codex", create: true).child("skills", create: true)
        return (versions, target)
    }

    private func current(_ versions: SandboxDirectory, _ target: SandboxDirectory) throws -> StoredInstall? {
        guard try target.info(Self.targetName) != nil else { return nil }
        let link = try target.link(Self.targetName)
        let parts = link.components(separatedBy: "/")
        guard parts.count == 6, parts.prefix(4).elementsEqual(["..", "..", ".managed", "versions"]),
              parts.last == "content", UUID(uuidString: parts[4])?.uuidString == parts[4] else {
            throw InstallFailure.unmanaged
        }
        return try readVersion(parts[4], versions)
    }

    private func readVersion(_ id: String, _ versions: SandboxDirectory) throws -> StoredInstall {
        guard UUID(uuidString: id)?.uuidString == id else { throw InstallFailure.invalidRecord }
        let version = try versions.child(id)
        guard try version.names() == ["content", "record.json"] else { throw InstallFailure.invalidRecord }
        let (bytes, mode) = try version.read("record.json", limit: 64 * 1024)
        guard mode == 0o600, let record = try? JSONDecoder().decode(InstallRecord.self, from: bytes),
              record.schema == 1, record.owner == "omgskills-handoff-test", record.sandboxID == sandbox.id,
              record.versionID == id, record.target == Self.target,
              record.previousID.map({ UUID(uuidString: $0)?.uuidString == $0 && $0 != id }) ?? true,
              record.files.count <= PublicPackageLoader.limits.maximumFileCount else { throw InstallFailure.invalidRecord }
        let pin = try PublicPin(id: record.catalogID, repo: record.repo, path: record.path, commit: record.commit,
                                skillSHA: record.skillSHA, treeSHA: record.tree)
        let content = try version.child("content")
        var observed = Set<String>()
        func walk(_ directory: SandboxDirectory, prefix: String = "", depth: Int = 0) throws {
            guard depth <= 32 else { throw InstallFailure.unsafePath }
            for name in try directory.names() {
                let path = prefix + name
                guard PublicPin.safePackagePath(path), let info = try directory.info(name) else { throw InstallFailure.unsafePath }
                if info.st_mode & S_IFMT == S_IFDIR {
                    guard record.files.contains(where: { $0.path.hasPrefix(path + "/") }) else { throw InstallFailure.changed }
                    try walk(directory.child(name), prefix: path + "/", depth: depth + 1)
                } else {
                    guard info.st_mode & S_IFMT == S_IFREG else { throw InstallFailure.unsafePath }
                    observed.insert(path)
                    guard observed.count <= PublicPackageLoader.limits.maximumFileCount else { throw InstallFailure.changed }
                }
            }
        }
        try walk(content)
        guard observed == Set(record.files.map(\.path)) else { throw InstallFailure.changed }
        var entries: [SkillPackageEntry] = [], total = 0
        for file in record.files {
            let (data, mode) = try content.read(file.path, limit: PublicPackageLoader.limits.maximumFileBytes)
            guard ["100644", "100755"].contains(file.mode), mode == (file.mode == "100755" ? 0o755 : 0o644),
                  data.count == file.size, SkillIdentityResolver.gitBlobSHA(for: data) == file.sha else {
                throw InstallFailure.changed
            }
            total += data.count
            guard total <= PublicPackageLoader.limits.maximumTotalBytes else { throw InstallFailure.changed }
            entries.append(.init(path: file.path, mode: file.mode, data: data, blobSha: file.sha))
        }
        let candidate = InstallCandidate(pin: pin, package: .init(coordinates: .init(
            commitSha: pin.commit, treeSha: record.tree, skillMdSha: pin.skillSHA), entries: entries))
        try candidate.validate()
        return StoredInstall(record: record, candidate: candidate,
                             digest: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
    }
}
