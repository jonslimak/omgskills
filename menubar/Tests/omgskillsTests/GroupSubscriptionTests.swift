import Foundation
import Testing
@testable import omgskills

struct GroupSubscriptionTests {
    @Test func storeRoundTripsAValidatedRecordAtAnOpaquePath() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString,
            isDirectory: true
        )
        defer { try? FileManager.default.removeItem(at: root) }
        let record = try subscriptionRecord(items: [
            installableRecordItem(id: "first", name: "Alpha", position: 0),
            metadataRecordItem(id: "second", name: "Local note", position: 1)
        ])
        let url = GroupSubscriptionStore.recordURL(groupId: record.groupId, targetRoot: root)

        try GroupSubscriptionStore.write(GroupSubscriptionStore.encode(record), to: url)

        #expect(try GroupSubscriptionStore.read(groupId: record.groupId, targetRoot: root) == record)
        #expect(url.lastPathComponent != "\(record.groupId).json")
    }

    @Test func diffSeparatesUpstreamMovementMetadataAndLocalEdits() throws {
        let baseline = try subscriptionRecord(items: [
            installableRecordItem(id: "removed", name: "Removed", position: 0),
            installableRecordItem(id: "updated", name: "Updated", position: 1),
            metadataRecordItem(id: "metadata", name: "Metadata", position: 2),
            installableRecordItem(id: "unchanged", name: "Unchanged", position: 3)
        ])
        let current = try subscriptionRecord(revision: 8, items: [
            installableRecordItem(
                id: "updated",
                name: "Updated",
                position: 0,
                releaseID: "release-new"
            ),
            installableRecordItem(id: "metadata", name: "Metadata", position: 1),
            installableRecordItem(id: "unchanged", name: "Unchanged", position: 2),
            metadataRecordItem(id: "added", name: "Added", position: 3)
        ])

        let diff = try GroupSubscriptionDiffer.compare(
            baseline: baseline,
            current: current,
            localStates: [
                "removed": .missing,
                "updated": .modified,
                "unchanged": .clean
            ]
        )

        #expect(diff.installedRevision == 7)
        #expect(diff.currentRevision == 8)
        #expect(diff.hasUpstreamChanges)
        #expect(diff.hasLocalChanges)
        #expect(diff.changes.map(\.id) == ["updated", "metadata", "unchanged", "added", "removed"])
        #expect(diff.changes[0].kind == .updated)
        #expect(diff.changes[0].wasReordered)
        #expect(diff.changes[0].localState == .modified)
        #expect(diff.changes[1].kind == .updated)
        #expect(diff.changes[1].isMetadataOnly == false)
        #expect(diff.changes[2].kind == .reordered)
        #expect(diff.changes[3].kind == .added)
        #expect(diff.changes[3].isMetadataOnly)
        #expect(diff.changes[4].kind == .removed)
        #expect(diff.changes[4].localState == .missing)
    }

    @Test func diffRejectsAReceiptForAnotherDestination() throws {
        let baseline = try subscriptionRecord(items: [
            installableRecordItem(id: "first", name: "Alpha", position: 0)
        ])
        let current = GroupSubscriptionRecord(
            version: baseline.version,
            groupId: baseline.groupId,
            groupRoute: baseline.groupRoute,
            groupName: baseline.groupName,
            groupRevision: baseline.groupRevision,
            targetAgent: ManagedSkillTargetAgent.codex.rawValue,
            targetScope: baseline.targetScope,
            targetRootIdentifier: "codex-user-global",
            items: baseline.items
        )

        #expect(throws: GroupSubscriptionError.invalidRecord) {
            try GroupSubscriptionDiffer.compare(
                baseline: baseline,
                current: current,
                localStates: [:]
            )
        }
    }
}

private func subscriptionRecord(
    revision: Int = 7,
    items: [GroupSubscriptionRecord.Item]
) throws -> GroupSubscriptionRecord {
    let record = GroupSubscriptionRecord(
        version: GroupSubscriptionRecord.supportedVersion,
        groupId: "10000000-0000-4000-8000-000000000001",
        groupRoute: "/u/owner/sets/team-skills",
        groupName: "Team Skills",
        groupRevision: revision,
        targetAgent: ManagedSkillTargetAgent.claude.rawValue,
        targetScope: ManagedSkillTargetScope.userGlobal.rawValue,
        targetRootIdentifier: "claude-user-global",
        items: items
    )
    try record.validate()
    return record
}

private func installableRecordItem(
    id: String,
    name: String,
    position: Int,
    releaseID: String = "release-current"
) -> GroupSubscriptionRecord.Item {
    GroupSubscriptionRecord.Item(
        id: id,
        name: name,
        position: position,
        presentationDigest: String(repeating: "a", count: 40),
        state: .installable(
            sourceId: "source-current",
            releaseId: releaseID,
            commitSha: String(repeating: "1", count: 40),
            treeSha: String(repeating: "2", count: 40),
            skillMdSha: String(repeating: "3", count: 40)
        )
    )
}

private func metadataRecordItem(
    id: String,
    name: String,
    position: Int
) -> GroupSubscriptionRecord.Item {
    GroupSubscriptionRecord.Item(
        id: id,
        name: name,
        position: position,
        presentationDigest: String(repeating: "b", count: 40),
        state: .metadataOnly(reason: GroupManifestMetadataOnlyReason.syncedLocalOnly.rawValue)
    )
}
