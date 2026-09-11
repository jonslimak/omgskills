import CryptoKit
import Foundation

enum GroupSubscriptionError: LocalizedError, Equatable, Sendable {
    case invalidRecord
    case recordTooLarge
    case filesystem(String)

    var errorDescription: String? {
        switch self {
        case .invalidRecord:
            "The saved Skill Group subscription is invalid."
        case .recordTooLarge:
            "The saved Skill Group subscription is too large."
        case .filesystem(let message):
            message.isEmpty ? "The Skill Group subscription could not be saved." : message
        }
    }
}

struct GroupSubscriptionRecord: Codable, Equatable, Sendable {
    static let supportedVersion = 1
    static let maximumBytes = 1 * 1024 * 1024

    let version: Int
    let groupId: String
    let groupRoute: String
    let groupName: String
    let groupRevision: Int
    let targetAgent: String
    let targetScope: String
    let targetRootIdentifier: String
    let items: [Item]

    struct Item: Codable, Equatable, Sendable {
        enum State: Codable, Equatable, Sendable {
            case installable(
                sourceId: String,
                releaseId: String,
                commitSha: String,
                treeSha: String,
                skillMdSha: String
            )
            case metadataOnly(reason: String)
        }

        let id: String
        let name: String
        let position: Int
        let presentationDigest: String
        let state: State
    }

    static func make(
        manifest: GroupManifest,
        route: DeviceGroupManifestRoute,
        destination: ManagedGroupSnapshotDestination
    ) throws -> GroupSubscriptionRecord {
        let record = GroupSubscriptionRecord(
            version: supportedVersion,
            groupId: manifest.group.id,
            groupRoute: "/u/\(route.handle)/sets/\(route.groupSlug)",
            groupName: manifest.group.name,
            groupRevision: manifest.group.revision,
            targetAgent: destination.agent.rawValue,
            targetScope: destination.scope.rawValue,
            targetRootIdentifier: destination.rootIdentifier,
            items: manifest.items.map { item in
                Item(
                    id: item.id,
                    name: item.name,
                    position: item.position,
                    presentationDigest: presentationDigest(for: item),
                    state: state(for: item.installability)
                )
            }
        )
        try record.validate()
        return record
    }

    func validate() throws {
        guard version == Self.supportedVersion,
              UUID(uuidString: groupId) != nil,
              groupRevision > 0,
              !groupName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              isValidGroupRoute(groupRoute),
              ManagedSkillTargetAgent(rawValue: targetAgent) != nil,
              targetScope == ManagedSkillTargetScope.userGlobal.rawValue,
              targetRootIdentifier.range(
                of: "^[a-z0-9][a-z0-9._-]{0,127}$",
                options: .regularExpression
              ) != nil,
              items.count <= GroupManifest.maximumItemCount
        else {
            throw GroupSubscriptionError.invalidRecord
        }

        var ids = Set<String>()
        for (expectedPosition, item) in items.enumerated() {
            guard !item.id.isEmpty,
                  ids.insert(item.id).inserted,
                  item.position == expectedPosition,
                  !item.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  isGitSha(item.presentationDigest)
            else {
                throw GroupSubscriptionError.invalidRecord
            }
            switch item.state {
            case .installable(
                let sourceId,
                let releaseId,
                let commitSha,
                let treeSha,
                let skillMdSha
            ):
                guard !sourceId.isEmpty,
                      !releaseId.isEmpty,
                      isGitSha(commitSha),
                      isGitSha(treeSha),
                      isGitSha(skillMdSha)
                else {
                    throw GroupSubscriptionError.invalidRecord
                }
            case .metadataOnly(let reason):
                guard GroupManifestMetadataOnlyReason(rawValue: reason) != nil else {
                    throw GroupSubscriptionError.invalidRecord
                }
            }
        }
    }

    private static func state(for installability: GroupManifestInstallability) -> Item.State {
        switch installability {
        case .installable(let source, let release):
            return .installable(
                sourceId: source.id,
                releaseId: release.id,
                commitSha: release.commitSha.lowercased(),
                treeSha: release.treeSha.lowercased(),
                skillMdSha: release.skillMdSha.lowercased()
            )
        case .metadataOnly(let reason):
            return .metadataOnly(reason: reason.rawValue)
        }
    }

    private static func presentationDigest(for item: GroupManifestItem) -> String {
        let values = [
            item.kind.rawValue,
            item.name,
            item.description ?? "",
            item.note ?? ""
        ]
        var data = Data()
        for value in values {
            var length = UInt64(value.utf8.count).bigEndian
            withUnsafeBytes(of: &length) { data.append(contentsOf: $0) }
            data.append(contentsOf: value.utf8)
        }
        return Insecure.SHA1.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func isGitSha(_ value: String) -> Bool {
        value.utf8.count == 40 && value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (97...102).contains(byte)
        }
    }

    private func isValidGroupRoute(_ value: String) -> Bool {
        let parts = value.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count == 4,
              parts[0] == "u",
              parts[2] == "sets",
              let route = try? DeviceGroupManifestRoute(
                  handle: String(parts[1]),
                  groupSlug: String(parts[3])
              )
        else {
            return false
        }
        return value == "/u/\(route.handle)/sets/\(route.groupSlug)"
    }
}

private extension GroupManifestSource {
    var id: String {
        switch self {
        case .catalog(let id, _, _),
             .publicGitHub(let id, _, _, _),
             .privateGitHub(let id):
            id
        }
    }
}

enum GroupSubscriptionStore {
    static func recordURL(groupId: String, targetRoot: URL) -> URL {
        targetRoot
            .appendingPathComponent(".omgskills/groups", isDirectory: true)
            .appendingPathComponent("\(stableKey(groupId)).json")
    }

    static func read(groupId: String, targetRoot: URL) throws -> GroupSubscriptionRecord? {
        let url = recordURL(groupId: groupId, targetRoot: targetRoot)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true,
              values.isSymbolicLink != true,
              (values.fileSize ?? Int.max) <= GroupSubscriptionRecord.maximumBytes
        else {
            throw GroupSubscriptionError.invalidRecord
        }
        let data = try Data(contentsOf: url)
        guard data.count <= GroupSubscriptionRecord.maximumBytes else {
            throw GroupSubscriptionError.recordTooLarge
        }
        do {
            let record = try JSONDecoder().decode(GroupSubscriptionRecord.self, from: data)
            try record.validate()
            return record
        } catch let error as GroupSubscriptionError {
            throw error
        } catch {
            throw GroupSubscriptionError.invalidRecord
        }
    }

    static func encode(_ record: GroupSubscriptionRecord) throws -> Data {
        try record.validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(record)
        guard data.count <= GroupSubscriptionRecord.maximumBytes else {
            throw GroupSubscriptionError.recordTooLarge
        }
        return data
    }

    static func write(_ data: Data, to url: URL) throws {
        guard data.count <= GroupSubscriptionRecord.maximumBytes else {
            throw GroupSubscriptionError.recordTooLarge
        }
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: url, options: .atomic)
        } catch {
            throw GroupSubscriptionError.filesystem(error.localizedDescription)
        }
    }

    private static func stableKey(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

enum GroupSubscriptionLocalState: Equatable, Sendable {
    case clean
    case modified
    case missing
    case replaced
    case unreadable
}

enum GroupSubscriptionChangeKind: String, Equatable, Sendable {
    case added
    case updated
    case removed
    case reordered
    case unchanged
}

struct GroupSubscriptionChange: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let kind: GroupSubscriptionChangeKind
    let wasReordered: Bool
    let isMetadataOnly: Bool
    let localState: GroupSubscriptionLocalState?
}

struct GroupSubscriptionDiff: Equatable, Sendable {
    let groupId: String
    let installedRevision: Int
    let currentRevision: Int
    let changes: [GroupSubscriptionChange]

    var hasUpstreamChanges: Bool {
        changes.contains { $0.kind != .unchanged }
    }

    var hasLocalChanges: Bool {
        changes.contains { change in
            guard let state = change.localState else { return false }
            return state != .clean
        }
    }
}

enum GroupSubscriptionDiffer {
    static func compare(
        baseline: GroupSubscriptionRecord,
        current: GroupSubscriptionRecord,
        localStates: [String: GroupSubscriptionLocalState]
    ) throws -> GroupSubscriptionDiff {
        try baseline.validate()
        try current.validate()
        guard baseline.groupId == current.groupId,
              baseline.targetAgent == current.targetAgent,
              baseline.targetScope == current.targetScope,
              baseline.targetRootIdentifier == current.targetRootIdentifier
        else {
            throw GroupSubscriptionError.invalidRecord
        }

        let baselineByID = Dictionary(uniqueKeysWithValues: baseline.items.map { ($0.id, $0) })
        let currentByID = Dictionary(uniqueKeysWithValues: current.items.map { ($0.id, $0) })
        var changes = current.items.map { item -> GroupSubscriptionChange in
            guard let previous = baselineByID[item.id] else {
                return GroupSubscriptionChange(
                    id: item.id,
                    name: item.name,
                    kind: .added,
                    wasReordered: false,
                    isMetadataOnly: item.isMetadataOnly,
                    localState: nil
                )
            }
            let reordered = previous.position != item.position
            let updated = previous.presentationDigest != item.presentationDigest
                || previous.state != item.state
            return GroupSubscriptionChange(
                id: item.id,
                name: item.name,
                kind: updated ? .updated : (reordered ? .reordered : .unchanged),
                wasReordered: reordered,
                isMetadataOnly: item.isMetadataOnly,
                localState: localStates[item.id]
            )
        }
        changes.append(contentsOf: baseline.items.compactMap { item in
            guard currentByID[item.id] == nil else { return nil }
            return GroupSubscriptionChange(
                id: item.id,
                name: item.name,
                kind: .removed,
                wasReordered: false,
                isMetadataOnly: item.isMetadataOnly,
                localState: localStates[item.id]
            )
        })
        return GroupSubscriptionDiff(
            groupId: baseline.groupId,
            installedRevision: baseline.groupRevision,
            currentRevision: current.groupRevision,
            changes: changes
        )
    }
}

private extension GroupSubscriptionRecord.Item {
    var isMetadataOnly: Bool {
        if case .metadataOnly = state { return true }
        return false
    }
}
