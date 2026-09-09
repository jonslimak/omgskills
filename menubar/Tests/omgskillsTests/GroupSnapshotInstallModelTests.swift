import Foundation
import Testing
@testable import omgskills

@MainActor
struct GroupSnapshotInstallModelTests {
    @Test func presentsOrderedItemsAndMetadataOnlyReasonsWithoutInstalling() async throws {
        let installer = RecordingGroupSnapshotInstaller(outcomes: [])
        let metadataItems = GroupManifestMetadataOnlyReason.allCases.enumerated().map { index, reason in
            metadataOnlyItem(
                id: "metadata-\(index)",
                position: index + 1,
                name: reason.rawValue,
                reason: reason.rawValue
            )
        }
        let model = try makeModel(
            manifest: manifest(items: [
                installableItem(
                    id: "first",
                    position: 0,
                    name: "Alpha",
                    description: "First description",
                    note: "Required"
                ),
            ] + metadataItems),
            installer: installer
        )

        #expect(model.groupName == "Team Skills")
        #expect(model.groupRevision == 7)
        #expect(model.items.map(\.id) == ["first"] + metadataItems.compactMap { $0["id"] as? String })
        #expect(model.items[0].description == "First description")
        #expect(model.items[0].note == "Required")
        #expect(model.items.dropFirst().map(\.availability) == [
            .metadataOnly(reason: "No published version is available."),
            .metadataOnly(reason: "The skill source is unavailable."),
            .metadataOnly(reason: "The skill source no longer matches this group."),
            .metadataOnly(reason: "The published version is incomplete."),
            .metadataOnly(reason: "The published version could not be verified."),
            .metadataOnly(reason: "The published version does not match its source."),
            .metadataOnly(reason: "The shared skill is no longer available."),
            .metadataOnly(reason: "This skill only exists on the owner's Mac."),
            .metadataOnly(reason: "This shared skill matches more than one source."),
            .metadataOnly(reason: "This shared skill could not be matched to an installable source.")
        ])
        #expect(model.installableCount == 1)
        #expect(model.metadataOnlyCount == GroupManifestMetadataOnlyReason.allCases.count)
        #expect(await installer.recordedRequests().isEmpty)
    }

    @Test func installRequiresTargetInstallableContentAndMetadataAcknowledgement() throws {
        let mixedModel = try makeModel(manifest: manifest(items: [
            installableItem(id: "first", position: 0, name: "Alpha"),
            metadataOnlyItem(id: "second", position: 1, name: "Beta")
        ]))

        #expect(mixedModel.canInstall == false)
        mixedModel.selectedTarget = .claude
        #expect(mixedModel.canInstall == false)
        mixedModel.acknowledgesMetadataOnly = true
        #expect(mixedModel.canInstall == true)

        let metadataOnlyModel = try makeModel(manifest: manifest(items: [
            metadataOnlyItem(id: "only", position: 0, name: "Local note")
        ]))
        metadataOnlyModel.selectedTarget = .codex
        metadataOnlyModel.acknowledgesMetadataOnly = true
        #expect(metadataOnlyModel.canInstall == false)
    }

    @Test func targetDestinationsAreExactAndUserGlobal() {
        let home = URL(fileURLWithPath: "/tmp/omgskills-home", isDirectory: true)
        let claude = GroupSnapshotInstallTarget.claude.destination(homeDirectory: home)
        let codex = GroupSnapshotInstallTarget.codex.destination(homeDirectory: home)

        #expect(claude.agent == .claude)
        #expect(claude.scope == .userGlobal)
        #expect(claude.rootIdentifier == "claude-user-global")
        #expect(claude.rootURL.path == "/tmp/omgskills-home/.claude/skills")
        #expect(codex.agent == .codex)
        #expect(codex.scope == .userGlobal)
        #expect(codex.rootIdentifier == "codex-user-global")
        #expect(codex.rootURL.path == "/tmp/omgskills-home/.codex/skills")
    }

    @Test func successfulInstallReportsCountsAndReleasesCoordinator() async throws {
        let installer = RecordingGroupSnapshotInstaller(outcomes: [
            .success(ManagedGroupSnapshotInstallResult(
                installedCount: 2,
                updatedCount: 1,
                metadataOnlyItems: [metadataOnlyResult]
            ))
        ])
        let coordinator = UpdateInstallCoordinator()
        let model = try makeModel(
            manifest: manifest(items: [
                installableItem(id: "first", position: 0, name: "Alpha"),
                metadataOnlyItem(id: "second", position: 1, name: "Beta")
            ]),
            installer: installer,
            coordinator: coordinator
        )
        model.selectedTarget = .codex
        model.acknowledgesMetadataOnly = true

        let task = try #require(model.startInstall())
        #expect(model.phase == .installing)
        #expect(coordinator.isBusy == true)
        await task.value

        #expect(model.phase == .success(GroupSnapshotInstallSummary(
            installedCount: 2,
            updatedCount: 1,
            skippedCount: 1
        )))
        #expect(model.canDismiss == true)
        #expect(coordinator.isBusy == false)
        let request = try #require(await installer.recordedRequests().first)
        #expect(request.destination.agent == .codex)
    }

    @Test func transientFailureCanRetryButReconnectFailureCannot() async throws {
        let transientInstaller = RecordingGroupSnapshotInstaller(outcomes: [
            .failure(.temporarilyUnavailable(retryAfter: "5")),
            .success(ManagedGroupSnapshotInstallResult(
                installedCount: 1,
                updatedCount: 0,
                metadataOnlyItems: []
            ))
        ])
        let transientModel = try makeReadyModel(installer: transientInstaller)

        try await #require(transientModel.startInstall()).value
        let transientFailure = try #require(failure(from: transientModel.phase))
        #expect(transientFailure.kind == .temporarilyUnavailable)
        #expect(transientFailure.canRetry == true)

        try await #require(transientModel.retryInstall()).value
        #expect(transientModel.phase == .success(GroupSnapshotInstallSummary(
            installedCount: 1,
            updatedCount: 0,
            skippedCount: 0
        )))

        let reconnectModel = try makeReadyModel(
            installer: RecordingGroupSnapshotInstaller(outcomes: [
                .failure(.reconnectRequired)
            ])
        )
        try await #require(reconnectModel.startInstall()).value
        let reconnectFailure = try #require(failure(from: reconnectModel.phase))
        #expect(reconnectFailure.kind == .reconnectRequired)
        #expect(reconnectFailure.canRetry == false)
        #expect(reconnectModel.retryInstall() == nil)
    }

    @Test func cancellationWaitsForInstallerRollbackAndBlocksDuplicateSubmission() async throws {
        let installer = SuspendingGroupSnapshotInstaller(result: ManagedGroupSnapshotInstallResult(
            installedCount: 1,
            updatedCount: 0,
            metadataOnlyItems: []
        ))
        let coordinator = UpdateInstallCoordinator()
        let model = try makeReadyModel(installer: installer, coordinator: coordinator)

        let task = try #require(model.startInstall())
        await installer.waitUntilStarted()
        #expect(model.startInstall() == nil)

        model.cancelInstall()
        #expect(model.phase == .cancelling)
        #expect(model.canDismiss == false)
        #expect(coordinator.isBusy == true)

        await installer.release()
        await task.value

        #expect(model.phase == .cancelled)
        #expect(model.canDismiss == true)
        #expect(coordinator.isBusy == false)
        #expect(await installer.recordedRequestCount() == 1)
    }

    private func makeReadyModel(
        installer: any GroupSnapshotInstalling,
        coordinator: UpdateInstallCoordinator = UpdateInstallCoordinator()
    ) throws -> GroupSnapshotInstallModel {
        let model = try makeModel(
            manifest: manifest(items: [
                installableItem(id: "first", position: 0, name: "Alpha")
            ]),
            installer: installer,
            coordinator: coordinator
        )
        model.selectedTarget = .claude
        return model
    }

    private func makeModel(
        manifest: GroupManifest,
        installer: any GroupSnapshotInstalling = RecordingGroupSnapshotInstaller(outcomes: []),
        coordinator: UpdateInstallCoordinator = UpdateInstallCoordinator()
    ) throws -> GroupSnapshotInstallModel {
        GroupSnapshotInstallModel(
            manifest: manifest,
            route: try DeviceGroupManifestRoute(handle: "owner", groupSlug: "team-skills"),
            credential: GroupSkillPackageTestSupport.credential(),
            installer: installer,
            packageLoader: UnusedGroupPackageLoader(),
            updateCoordinator: coordinator,
            homeDirectory: URL(fileURLWithPath: "/tmp/omgskills-home", isDirectory: true)
        )
    }

    private func failure(
        from phase: GroupSnapshotInstallModel.Phase
    ) -> GroupSnapshotInstallFailure? {
        guard case .failure(let failure) = phase else { return nil }
        return failure
    }

    private func manifest(items: [[String: Any]]) throws -> GroupManifest {
        let object: [String: Any] = [
            "type": GroupManifest.expectedType,
            "version": GroupManifest.supportedVersion,
            "group": [
                "id": "10000000-0000-4000-8000-000000000001",
                "name": "Team Skills",
                "description": "A mixed test group",
                "slug": "team-skills",
                "revision": 7
            ],
            "items": items
        ]
        return try JSONDecoder().decode(
            GroupManifest.self,
            from: JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        )
    }

    private func installableItem(
        id: String,
        position: Int,
        name: String,
        description: String? = nil,
        note: String? = nil
    ) -> [String: Any] {
        [
            "id": id,
            "kind": "github",
            "position": position,
            "name": name,
            "description": description ?? NSNull(),
            "note": note ?? NSNull(),
            "installability": [
                "status": "installable",
                "source": [
                    "id": "source-\(id)",
                    "kind": "private_github"
                ],
                "release": [
                    "id": "release-\(id)",
                    "commitSha": GroupSkillPackageTestSupport.commitSha,
                    "treeSha": GroupSkillPackageTestSupport.treeSha,
                    "skillMdSha": GroupSkillPackageTestSupport.skillMdSha
                ]
            ]
        ]
    }

    private func metadataOnlyItem(
        id: String,
        position: Int,
        name: String,
        reason: String = "synced_local_only"
    ) -> [String: Any] {
        [
            "id": id,
            "kind": "synced",
            "position": position,
            "name": name,
            "description": NSNull(),
            "note": NSNull(),
            "installability": [
                "status": "metadata_only",
                "reason": reason
            ]
        ]
    }

    private var metadataOnlyResult: ManagedGroupMetadataOnlyItem {
        ManagedGroupMetadataOnlyItem(
            id: "second",
            name: "Beta",
            position: 1,
            reason: .syncedLocalOnly
        )
    }
}

private enum GroupSnapshotInstallerOutcome: Sendable {
    case success(ManagedGroupSnapshotInstallResult)
    case failure(GroupSkillPackageLoaderError)
}

private actor RecordingGroupSnapshotInstaller: GroupSnapshotInstalling {
    private var outcomes: [GroupSnapshotInstallerOutcome]
    private var requests: [ManagedGroupSnapshotInstallRequest] = []

    init(outcomes: [GroupSnapshotInstallerOutcome]) {
        self.outcomes = outcomes
    }

    func installGroupSnapshot(
        _ request: ManagedGroupSnapshotInstallRequest,
        credential: StoredDeviceCredential,
        packageLoader: any GroupSkillPackageLoading
    ) async throws -> ManagedGroupSnapshotInstallResult {
        requests.append(request)
        guard !outcomes.isEmpty else {
            throw GroupSkillPackageLoaderError.packageUnavailable
        }
        switch outcomes.removeFirst() {
        case .success(let result):
            return result
        case .failure(let error):
            throw error
        }
    }

    func recordedRequests() -> [ManagedGroupSnapshotInstallRequest] {
        requests
    }
}

private actor SuspendingGroupSnapshotInstaller: GroupSnapshotInstalling {
    private let result: ManagedGroupSnapshotInstallResult
    private var requestCount = 0
    private var started = false
    private var startedContinuation: CheckedContinuation<Void, Never>?
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    init(result: ManagedGroupSnapshotInstallResult) {
        self.result = result
    }

    func installGroupSnapshot(
        _ request: ManagedGroupSnapshotInstallRequest,
        credential: StoredDeviceCredential,
        packageLoader: any GroupSkillPackageLoading
    ) async throws -> ManagedGroupSnapshotInstallResult {
        requestCount += 1
        started = true
        startedContinuation?.resume()
        startedContinuation = nil
        await withCheckedContinuation { continuation in
            releaseContinuation = continuation
        }
        try Task.checkCancellation()
        return result
    }

    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { continuation in
            startedContinuation = continuation
        }
    }

    func release() {
        releaseContinuation?.resume()
        releaseContinuation = nil
    }

    func recordedRequestCount() -> Int {
        requestCount
    }
}

private struct UnusedGroupPackageLoader: GroupSkillPackageLoading {
    func loadPackage(
        for item: GroupManifestItem,
        credential: StoredDeviceCredential
    ) async throws -> SkillPackage {
        throw GroupSkillPackageLoaderError.packageUnavailable
    }
}
