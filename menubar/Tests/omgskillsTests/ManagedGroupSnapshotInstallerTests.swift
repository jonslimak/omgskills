import Foundation
import Testing
@testable import omgskills

private enum GroupTransactionTestFailure: Error {
    case injected
}

struct ManagedGroupSnapshotInstallerTests {
    @Test func installsRootLevelCatalogSkillID() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let manifest = try fixture.manifest(items: [
            fixture.installable(
                name: "root-skill",
                kind: "catalog",
                source: fixture.catalogSource(
                    catalogSkillID: "owner/repo",
                    normalizedRoot: "."
                )
            )
        ])

        let result = try await fixture.installer().installGroupSnapshot(
            fixture.request(manifest),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )

        #expect(result.installedCount == 1)
        #expect(fixture.targetExists("root-skill"))
    }

    @Test func installsMixedSourcesAndReportsMetadataOnlyItems() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let loader = RecordingGroupPackageLoader(package: fixture.package)
        let installer = fixture.installer()
        let manifest = try fixture.manifest(items: [
            fixture.installable(name: "catalog-skill", kind: "catalog", source: fixture.catalogSource()),
            fixture.installable(name: "public-skill", kind: "github", source: fixture.publicSource()),
            fixture.installable(name: "private-skill", kind: "github", source: fixture.privateSource()),
            fixture.metadataOnly(name: "local-note", reason: "synced_local_only")
        ])

        let result = try await installer.installGroupSnapshot(
            fixture.request(manifest),
            credential: fixture.credential,
            packageLoader: loader
        )

        #expect(result.installedCount == 3)
        #expect(result.updatedCount == 0)
        #expect(result.metadataOnlyItems == [ManagedGroupMetadataOnlyItem(
            id: "item-3",
            name: "local-note",
            position: 3,
            reason: .syncedLocalOnly
        )])
        #expect(await loader.loadedNames() == ["catalog-skill", "public-skill", "private-skill"])
        for name in ["catalog-skill", "public-skill", "private-skill"] {
            #expect(FileManager.default.fileExists(
                atPath: fixture.targetRoot.appendingPathComponent("\(name)/SKILL.md").path
            ))
            let provenance = try #require(SkillInstallProvenanceStore.read(
                targetRoot: fixture.targetRoot,
                targetName: name
            ))
            #expect(provenance.groupId == fixture.groupID)
            #expect(provenance.groupRoute == "/u/owner/sets/team-skills")
            #expect(provenance.groupRevision == 7)
            #expect(provenance.installMode == ManagedSkillInstallMode.snapshot.rawValue)
        }

        let updateResult = try await installer.installGroupSnapshot(
            fixture.request(manifest),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )
        #expect(updateResult.installedCount == 0)
        #expect(updateResult.updatedCount == 3)
        #expect(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        ) == nil)
    }

    @Test func subscribedInstallWritesReceiptAndDetectsCompleteLocalEdits() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let manifest = try fixture.manifest(items: [
            fixture.installable(name: "example", kind: "catalog", source: fixture.catalogSource()),
            fixture.metadataOnly(name: "local-note", reason: "synced_local_only")
        ])

        _ = try await installer.installGroupSnapshot(
            fixture.request(manifest, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )

        let savedReceipt = try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        )
        let receipt = try #require(savedReceipt)
        #expect(receipt.groupRevision == 7)
        #expect(receipt.items.map(\.name) == ["example", "local-note"])
        #expect(SkillInstallProvenanceStore.read(
            targetRoot: fixture.targetRoot,
            targetName: "example"
        )?.installMode == ManagedSkillInstallMode.subscribed.rawValue)

        let clean = try #require(await installer.detectGroupSubscription(
            manifest: manifest,
            route: fixture.route,
            destination: fixture.destination
        ))
        #expect(clean.hasUpstreamChanges == false)
        #expect(clean.hasLocalChanges == false)

        let nestedFile = fixture.targetRoot.appendingPathComponent("example/references/info.txt")
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o644],
            ofItemAtPath: nestedFile.path
        )
        try Data("locally changed\n".utf8).write(to: nestedFile)

        let modified = try #require(await installer.detectGroupSubscription(
            manifest: manifest,
            route: fixture.route,
            destination: fixture.destination
        ))
        #expect(modified.hasUpstreamChanges == false)
        #expect(modified.hasLocalChanges)
        #expect(modified.changes.first?.localState == .modified)
    }

    @Test func failedReceiptWriteRollsBackTargetsAndPreviousReceipt() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let firstManifest = try fixture.manifest(revision: 7, items: [
            fixture.installable(name: "example", kind: "catalog", source: fixture.catalogSource())
        ])
        let firstInstaller = fixture.installer()
        _ = try await firstInstaller.installGroupSnapshot(
            fixture.request(firstManifest, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )
        let previousTarget = try fixture.targetDestination("example")
        let savedReceipt = try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        )
        let previousReceipt = try #require(savedReceipt)
        let nextManifest = try fixture.manifest(revision: 8, items: [])
        let failingInstaller = fixture.installer(beforeSubscriptionWrite: {
            throw GroupTransactionTestFailure.injected
        })

        await #expect(throws: GroupTransactionTestFailure.self) {
            try await failingInstaller.applyGroupSubscriptionUpdate(
                fixture.request(nextManifest, mode: .subscribed),
                credential: fixture.credential,
                packageLoader: RecordingGroupPackageLoader(package: fixture.package)
            )
        }

        #expect(try fixture.targetDestination("example") == previousTarget)
        #expect(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        ) == previousReceipt)
        #expect(!FileManager.default.fileExists(atPath: fixture.journalURL.path))
    }

    @Test func subscribedUpdateAppliesOnlyChangedPackagesAndCleanRemovals() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let baseline = try fixture.manifest(revision: 7, items: [
            fixture.installable(
                id: "updated",
                name: "updated",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-old"
            ),
            fixture.installable(
                id: "removed",
                name: "removed",
                kind: "github",
                source: fixture.publicSource()
            ),
            fixture.installable(
                id: "unchanged",
                name: "unchanged",
                kind: "github",
                source: fixture.privateSource()
            )
        ])
        _ = try await installer.installGroupSnapshot(
            fixture.request(baseline, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )
        let unchangedBefore = try fixture.targetDestination("unchanged")
        let current = try fixture.manifest(revision: 8, items: [
            fixture.installable(
                id: "updated",
                name: "updated",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-new"
            ),
            fixture.installable(
                id: "unchanged",
                name: "unchanged",
                kind: "github",
                source: fixture.privateSource()
            ),
            fixture.installable(
                id: "added",
                name: "added",
                kind: "github",
                source: fixture.publicSource(id: "source-added")
            )
        ])
        let loader = RecordingGroupPackageLoader(package: fixture.package)

        let result = try await installer.applyGroupSubscriptionUpdate(
            fixture.request(current, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: loader
        )

        #expect(result.installedCount == 1)
        #expect(result.updatedCount == 1)
        #expect(result.removedCount == 1)
        #expect(await loader.loadedNames() == ["updated", "added"])
        #expect(!fixture.targetExists("removed"))
        #expect(try fixture.targetDestination("unchanged") == unchangedBefore)
        #expect(SkillInstallProvenanceStore.read(
            targetRoot: fixture.targetRoot,
            targetName: "updated"
        )?.releaseId == "release-new")
        #expect(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        )?.groupRevision == 8)
    }

    @Test func subscribedUpdateBlocksChangedLocallyModifiedPackageBeforeLoading() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let baseline = try fixture.manifest(revision: 7, items: [
            fixture.installable(
                id: "example",
                name: "example",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-old"
            )
        ])
        _ = try await installer.installGroupSnapshot(
            fixture.request(baseline, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )
        let previousTarget = try fixture.targetDestination("example")
        let previousReceipt = try #require(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        ))
        let localFile = fixture.targetRoot.appendingPathComponent("example/references/info.txt")
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: localFile.path)
        try Data("local edit\n".utf8).write(to: localFile)
        let current = try fixture.manifest(revision: 8, items: [
            fixture.installable(
                id: "example",
                name: "example",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-new"
            )
        ])
        let loader = RecordingGroupPackageLoader(package: fixture.package)

        await #expect(throws: ManagedSkillInstaller.InstallError.subscriptionHasLocalConflicts) {
            try await installer.applyGroupSubscriptionUpdate(
                fixture.request(current, mode: .subscribed),
                credential: fixture.credential,
                packageLoader: loader
            )
        }

        #expect(await loader.loadedNames().isEmpty)
        #expect(try fixture.targetDestination("example") == previousTarget)
        #expect(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        ) == previousReceipt)
    }

    @Test func subscribedUpdatePreservesLocalEditsOnUnchangedPackage() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let baseline = try fixture.manifest(revision: 7, items: [
            fixture.installable(
                id: "updated",
                name: "updated",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-old"
            ),
            fixture.installable(
                id: "local",
                name: "local",
                kind: "github",
                source: fixture.publicSource()
            )
        ])
        _ = try await installer.installGroupSnapshot(
            fixture.request(baseline, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )
        let localFile = fixture.targetRoot.appendingPathComponent("local/references/info.txt")
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: localFile.path)
        let localData = Data("keep this edit\n".utf8)
        try localData.write(to: localFile)
        let current = try fixture.manifest(revision: 8, items: [
            fixture.installable(
                id: "updated",
                name: "updated",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-new"
            ),
            fixture.installable(
                id: "local",
                name: "local",
                kind: "github",
                source: fixture.publicSource()
            )
        ])

        _ = try await installer.applyGroupSubscriptionUpdate(
            fixture.request(current, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )

        #expect(try Data(contentsOf: localFile) == localData)
        let diff = try #require(await installer.detectGroupSubscription(
            manifest: current,
            route: fixture.route,
            destination: fixture.destination
        ))
        #expect(diff.hasUpstreamChanges == false)
        #expect(diff.hasLocalChanges)
    }

    @Test func subscribedUpdateRenamesPackageAsOneRecoverableTransaction() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let baseline = try fixture.manifest(revision: 7, items: [
            fixture.installable(
                id: "renamed",
                name: "old-name",
                kind: "catalog",
                source: fixture.catalogSource()
            )
        ])
        _ = try await installer.installGroupSnapshot(
            fixture.request(baseline, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )
        let current = try fixture.manifest(revision: 8, items: [
            fixture.installable(
                id: "renamed",
                name: "new-name",
                kind: "catalog",
                source: fixture.catalogSource()
            )
        ])

        let result = try await installer.applyGroupSubscriptionUpdate(
            fixture.request(current, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )

        #expect(result.installedCount == 1)
        #expect(result.removedCount == 1)
        #expect(!fixture.targetExists("old-name"))
        #expect(fixture.targetExists("new-name"))
        #expect(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        )?.items.first?.name == "new-name")
    }

    @Test func subscribedUpdateFailureAfterRemovalRestoresEveryTargetAndReceipt() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let initialInstaller = fixture.installer()
        let baseline = try fixture.manifest(revision: 7, items: [
            fixture.installable(
                id: "updated",
                name: "updated",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-old"
            ),
            fixture.installable(
                id: "removed-a",
                name: "removed-a",
                kind: "github",
                source: fixture.publicSource()
            ),
            fixture.installable(
                id: "removed-b",
                name: "removed-b",
                kind: "github",
                source: fixture.privateSource()
            )
        ])
        _ = try await initialInstaller.installGroupSnapshot(
            fixture.request(baseline, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )
        let targetNames = ["updated", "removed-a", "removed-b"]
        let targetsBefore = try Dictionary(uniqueKeysWithValues: targetNames.map {
            ($0, try fixture.targetDestination($0))
        })
        let receiptBefore = try #require(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        ))
        let current = try fixture.manifest(revision: 8, items: [
            fixture.installable(
                id: "updated",
                name: "updated",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-new"
            )
        ])
        let failingInstaller = fixture.installer { index, _ in
            if index == 2 { throw GroupTransactionTestFailure.injected }
        }

        await #expect(throws: GroupTransactionTestFailure.self) {
            try await failingInstaller.applyGroupSubscriptionUpdate(
                fixture.request(current, mode: .subscribed),
                credential: fixture.credential,
                packageLoader: RecordingGroupPackageLoader(package: fixture.package)
            )
        }

        for name in targetNames {
            #expect(try fixture.targetDestination(name) == targetsBefore[name])
        }
        #expect(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        ) == receiptBefore)
        #expect(!FileManager.default.fileExists(atPath: fixture.journalURL.path))
    }

    @Test func subscribedUpdateValidatesEveryPackageBeforeChangingTargets() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let baseline = try fixture.manifest(revision: 7, items: [
            fixture.installable(
                id: "updated",
                name: "updated",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-old"
            )
        ])
        _ = try await installer.installGroupSnapshot(
            fixture.request(baseline, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )
        let targetBefore = try fixture.targetDestination("updated")
        let receiptBefore = try #require(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        ))
        let current = try fixture.manifest(revision: 8, items: [
            fixture.installable(
                id: "updated",
                name: "updated",
                kind: "catalog",
                source: fixture.catalogSource(),
                releaseID: "release-new"
            ),
            fixture.installable(
                id: "added",
                name: "added",
                kind: "github",
                source: fixture.publicSource()
            )
        ])

        await #expect(throws: SkillPackageValidationError.self) {
            try await installer.applyGroupSubscriptionUpdate(
                fixture.request(current, mode: .subscribed),
                credential: fixture.credential,
                packageLoader: RecordingGroupPackageLoader(
                    package: fixture.package,
                    invalidCall: 2
                )
            )
        }

        #expect(try fixture.targetDestination("updated") == targetBefore)
        #expect(!fixture.targetExists("added"))
        #expect(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        ) == receiptBefore)
        #expect(!FileManager.default.fileExists(atPath: fixture.journalURL.path))
    }

    @Test func reorderOnlySubscribedUpdateAdvancesReceiptWithoutLoadingPackages() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let baseline = try fixture.manifest(revision: 7, items: [
            fixture.installable(id: "alpha", name: "alpha", kind: "catalog", source: fixture.catalogSource()),
            fixture.installable(id: "beta", name: "beta", kind: "github", source: fixture.publicSource())
        ])
        _ = try await installer.installGroupSnapshot(
            fixture.request(baseline, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: RecordingGroupPackageLoader(package: fixture.package)
        )
        let alphaBefore = try fixture.targetDestination("alpha")
        let betaBefore = try fixture.targetDestination("beta")
        let current = try fixture.manifest(revision: 8, items: [
            fixture.installable(id: "beta", name: "beta", kind: "github", source: fixture.publicSource()),
            fixture.installable(id: "alpha", name: "alpha", kind: "catalog", source: fixture.catalogSource())
        ])
        let loader = RecordingGroupPackageLoader(package: fixture.package)

        let result = try await installer.applyGroupSubscriptionUpdate(
            fixture.request(current, mode: .subscribed),
            credential: fixture.credential,
            packageLoader: loader
        )

        #expect(result.installedCount == 0)
        #expect(result.updatedCount == 0)
        #expect(result.removedCount == 0)
        #expect(await loader.loadedNames().isEmpty)
        #expect(try fixture.targetDestination("alpha") == alphaBefore)
        #expect(try fixture.targetDestination("beta") == betaBefore)
        #expect(try GroupSubscriptionStore.read(
            groupId: fixture.groupID,
            targetRoot: fixture.targetRoot
        )?.groupRevision == 8)
    }

    @Test func preflightRejectsPortableNameCollisionsBeforeLoading() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let loader = RecordingGroupPackageLoader(package: fixture.package)
        for names in [("Review", "review"), ("caf\u{00E9}", "cafe\u{0301}")] {
            let manifest = try fixture.manifest(items: [
                fixture.installable(name: names.0, kind: "catalog", source: fixture.catalogSource()),
                fixture.installable(name: names.1, kind: "catalog", source: fixture.catalogSource(id: "source-2"))
            ])

            await #expect(throws: ManagedSkillInstaller.InstallError.invalidGroupManifest) {
                try await fixture.installer().installGroupSnapshot(
                    fixture.request(manifest),
                    credential: fixture.credential,
                    packageLoader: loader
                )
            }
        }
        #expect(await loader.loadedNames().isEmpty)
    }

    @Test func preflightRejectsUnmanagedTargetsBeforeLoading() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let loader = RecordingGroupPackageLoader(package: fixture.package)
        let target = fixture.targetRoot.appendingPathComponent("blocked", isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        try Data("unmanaged".utf8).write(to: target.appendingPathComponent("SKILL.md"))
        let manifest = try fixture.manifest(items: [
            fixture.installable(name: "blocked", kind: "catalog", source: fixture.catalogSource())
        ])

        await #expect(throws: ManagedSkillInstaller.InstallError.unmanagedTargetExists) {
            try await fixture.installer().installGroupSnapshot(
                fixture.request(manifest),
                credential: fixture.credential,
                packageLoader: loader
            )
        }
        #expect(await loader.loadedNames().isEmpty)
        #expect(try Data(contentsOf: target.appendingPathComponent("SKILL.md")) == Data("unmanaged".utf8))
    }

    @Test func loaderFailureLeavesEveryActiveTargetUnchanged() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let loader = RecordingGroupPackageLoader(package: fixture.package, failingCall: 2)
        let manifest = try fixture.manifest(items: [
            fixture.installable(name: "first", kind: "catalog", source: fixture.catalogSource()),
            fixture.installable(name: "second", kind: "github", source: fixture.publicSource())
        ])

        await #expect(throws: GroupTransactionTestFailure.self) {
            try await fixture.installer().installGroupSnapshot(
                fixture.request(manifest),
                credential: fixture.credential,
                packageLoader: loader
            )
        }
        #expect(!fixture.targetExists("first"))
        #expect(!fixture.targetExists("second"))
        #expect(!FileManager.default.fileExists(atPath: fixture.journalURL.path))
    }

    @Test func validationFailureLeavesEveryActiveTargetUnchanged() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let loader = RecordingGroupPackageLoader(
            package: fixture.package,
            invalidCall: 2
        )
        let manifest = try fixture.manifest(items: [
            fixture.installable(name: "first", kind: "catalog", source: fixture.catalogSource()),
            fixture.installable(name: "second", kind: "github", source: fixture.publicSource())
        ])

        await #expect(throws: SkillPackageValidationError.self) {
            try await fixture.installer().installGroupSnapshot(
                fixture.request(manifest),
                credential: fixture.credential,
                packageLoader: loader
            )
        }
        #expect(!fixture.targetExists("first"))
        #expect(!fixture.targetExists("second"))
        #expect(!FileManager.default.fileExists(atPath: fixture.journalURL.path))
    }

    @Test func activationFailureRestoresUpdatedTargetsAndRemovesNewTargets() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer { index, _ in
            if index == 2 { throw GroupTransactionTestFailure.injected }
        }
        _ = try await installer.install(fixture.singleRequest(name: "first", releaseID: "old-first")) {
            fixture.package
        }
        _ = try await installer.install(fixture.singleRequest(name: "third", releaseID: "old-third")) {
            fixture.package
        }
        let firstBefore = try fixture.targetDestination("first")
        let thirdBefore = try fixture.targetDestination("third")
        let manifest = try fixture.manifest(items: [
            fixture.installable(name: "first", kind: "catalog", source: fixture.catalogSource()),
            fixture.installable(name: "second", kind: "github", source: fixture.publicSource()),
            fixture.installable(name: "third", kind: "github", source: fixture.privateSource())
        ])

        await #expect(throws: GroupTransactionTestFailure.self) {
            try await installer.installGroupSnapshot(
                fixture.request(manifest),
                credential: fixture.credential,
                packageLoader: RecordingGroupPackageLoader(package: fixture.package)
            )
        }

        #expect(try fixture.targetDestination("first") == firstBefore)
        #expect(!fixture.targetExists("second"))
        #expect(try fixture.targetDestination("third") == thirdBefore)
        #expect(SkillInstallProvenanceStore.read(
            targetRoot: fixture.targetRoot,
            targetName: "first"
        )?.releaseId == "old-first")
        #expect(!FileManager.default.fileExists(atPath: fixture.journalURL.path))
    }

    @Test func nextMutationRecoversAnInterruptedTransactionBeforeCleanup() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        _ = try await installer.install(fixture.singleRequest(name: "example", releaseID: "old")) {
            fixture.package
        }
        let oldDestination = try fixture.targetDestination("example")
        _ = try await installer.install(fixture.singleRequest(name: "example", releaseID: "new")) {
            fixture.package
        }
        let newDestination = try fixture.targetDestination("example")
        try fixture.writeJournal(
            targetName: "example",
            previousActivationContent: oldDestination,
            preparedActivationContent: newDestination
        )

        _ = try await fixture.installer().cleanup(targetRoots: [fixture.targetRoot])

        #expect(try fixture.targetDestination("example") == oldDestination)
        #expect(SkillInstallProvenanceStore.read(
            targetRoot: fixture.targetRoot,
            targetName: "example"
        )?.releaseId == "old")
        #expect(!FileManager.default.fileExists(atPath: fixture.journalURL.path))
    }

    @Test func malformedJournalFailsClosedWithoutTouchingTargets() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        _ = try await installer.install(fixture.singleRequest(name: "example", releaseID: "old")) {
            fixture.package
        }
        let destination = try fixture.targetDestination("example")
        try FileManager.default.createDirectory(
            at: fixture.journalURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("{\"version\":99}".utf8).write(to: fixture.journalURL)

        await #expect(throws: ManagedSkillInstaller.InstallError.invalidTransactionJournal) {
            try await fixture.installer().cleanup(targetRoots: [fixture.targetRoot])
        }

        #expect(try fixture.targetDestination("example") == destination)
        #expect(FileManager.default.fileExists(atPath: fixture.journalURL.path))
    }

    @Test func suspendedGroupLoadBlocksOtherMutationsAndCancellationLeavesNoTargets() async throws {
        let fixture = try GroupTransactionFixture()
        defer { fixture.remove() }
        let loader = SuspendingGroupPackageLoader(package: fixture.package)
        let installer = fixture.installer()
        let manifest = try fixture.manifest(items: [
            fixture.installable(name: "example", kind: "catalog", source: fixture.catalogSource())
        ])

        do {
            try await withThrowingTaskGroup(of: ManagedGroupSnapshotInstallResult.self) { group in
                group.addTask {
                    try await installer.installGroupSnapshot(
                        fixture.request(manifest),
                        credential: fixture.credential,
                        packageLoader: loader
                    )
                }
                await loader.waitUntilStarted()
                await #expect(throws: ManagedSkillInstaller.InstallError.operationInProgress) {
                    try await installer.cleanup(targetRoots: [fixture.targetRoot])
                }
                group.cancelAll()
                await loader.release()
                _ = try await group.next()
            }
            Issue.record("Expected the group installation to preserve cancellation")
        } catch is CancellationError {
            // Expected.
        }

        #expect(!fixture.targetExists("example"))
        #expect(!FileManager.default.fileExists(atPath: fixture.journalURL.path))
    }
}

private actor RecordingGroupPackageLoader: GroupSkillPackageLoading {
    private let package: SkillPackage
    private let failingCall: Int?
    private let invalidCall: Int?
    private var names: [String] = []

    init(
        package: SkillPackage,
        failingCall: Int? = nil,
        invalidCall: Int? = nil
    ) {
        self.package = package
        self.failingCall = failingCall
        self.invalidCall = invalidCall
    }

    func loadPackage(
        for item: GroupManifestItem,
        credential: StoredDeviceCredential
    ) async throws -> SkillPackage {
        names.append(item.name)
        if names.count == failingCall { throw GroupTransactionTestFailure.injected }
        if names.count == invalidCall {
            var entries = package.entries
            let entry = entries[0]
            entries[0] = SkillPackageEntry(
                path: entry.path,
                mode: entry.mode,
                data: Data("tampered".utf8),
                blobSha: entry.blobSha
            )
            return SkillPackage(coordinates: package.coordinates, entries: entries)
        }
        return package
    }

    func loadedNames() -> [String] {
        names
    }
}

private actor SuspendingGroupPackageLoader: GroupSkillPackageLoading {
    private let package: SkillPackage
    private var started = false
    private var startedContinuation: CheckedContinuation<Void, Never>?
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    init(package: SkillPackage) {
        self.package = package
    }

    func loadPackage(
        for item: GroupManifestItem,
        credential: StoredDeviceCredential
    ) async throws -> SkillPackage {
        started = true
        startedContinuation?.resume()
        startedContinuation = nil
        await withCheckedContinuation { continuation in
            releaseContinuation = continuation
        }
        try Task.checkCancellation()
        return package
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
}

private struct GroupTransactionFixture: Sendable {
    let root: URL
    let managedRoot: URL
    let targetRoot: URL
    let package: SkillPackage
    let credential = GroupSkillPackageTestSupport.credential()
    let groupID = "10000000-0000-4000-8000-000000000001"

    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString,
            isDirectory: true
        )
        managedRoot = root.appendingPathComponent("managed", isDirectory: true)
        targetRoot = root.appendingPathComponent("skills", isDirectory: true)
        package = GroupSkillPackageTestSupport.package
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    var journalURL: URL {
        managedRoot.appendingPathComponent("transactions/active.json")
    }

    func installer(
        beforeGroupSwitch: @escaping ManagedSkillInstaller.BeforeGroupActivationSwitch = { _, _ in },
        beforeSubscriptionWrite: @escaping ManagedSkillInstaller.BeforeSubscriptionWrite = {}
    ) -> ManagedSkillInstaller {
        ManagedSkillInstaller(
            managedRoot: managedRoot,
            pathAnchor: root,
            beforeGroupActivationSwitch: beforeGroupSwitch,
            beforeSubscriptionWrite: beforeSubscriptionWrite
        )
    }

    var route: DeviceGroupManifestRoute {
        get throws {
            try DeviceGroupManifestRoute(handle: "owner", groupSlug: "team-skills")
        }
    }

    var destination: ManagedGroupSnapshotDestination {
        ManagedGroupSnapshotDestination(
            agent: .claude,
            scope: .userGlobal,
            rootIdentifier: "claude-user-global",
            rootURL: targetRoot
        )
    }

    func request(
        _ manifest: GroupManifest,
        mode: ManagedSkillInstallMode = .snapshot
    ) throws -> ManagedGroupSnapshotInstallRequest {
        ManagedGroupSnapshotInstallRequest(
            manifest: manifest,
            route: try route,
            destination: destination,
            mode: mode
        )
    }

    func singleRequest(name: String, releaseID: String) -> ManagedSkillInstallRequest {
        ManagedSkillInstallRequest(
            sourceKind: .privateGitHub,
            sourceId: "legacy-\(name)",
            releaseId: releaseID,
            groupRevision: nil,
            catalogSkillId: nil,
            githubUrl: nil,
            expectedCoordinates: package.coordinates,
            mode: .snapshot,
            destination: ManagedSkillDestination(
                agent: .claude,
                scope: .userGlobal,
                rootIdentifier: "claude-user-global",
                rootURL: targetRoot,
                targetName: name
            )
        )
    }

    func manifest(revision: Int = 7, items: [[String: Any]]) throws -> GroupManifest {
        let object: [String: Any] = [
            "type": GroupManifest.expectedType,
            "version": GroupManifest.supportedVersion,
            "group": [
                "id": groupID,
                "name": "Team Skills",
                "description": "Test group",
                "slug": "team-skills",
                "revision": revision
            ],
            "items": items.enumerated().map { position, item in
                var positioned = item
                if positioned["id"] == nil {
                    positioned["id"] = "item-\(position)"
                }
                positioned["position"] = position
                return positioned
            }
        ]
        return try JSONDecoder().decode(
            GroupManifest.self,
            from: JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        )
    }

    func installable(
        id: String? = nil,
        name: String,
        kind: String,
        source: [String: Any],
        releaseID: String? = nil
    ) -> [String: Any] {
        var item: [String: Any] = [
            "kind": kind,
            "name": name,
            "description": NSNull(),
            "note": NSNull(),
            "installability": [
                "status": "installable",
                "source": source,
                "release": [
                    "id": releaseID ?? "release-\(name.lowercased())",
                    "commitSha": package.coordinates.commitSha,
                    "treeSha": package.coordinates.treeSha,
                    "skillMdSha": package.coordinates.skillMdSha
                ]
            ]
        ]
        if let id { item["id"] = id }
        return item
    }

    func metadataOnly(id: String? = nil, name: String, reason: String) -> [String: Any] {
        var item: [String: Any] = [
            "kind": "synced",
            "name": name,
            "description": NSNull(),
            "note": NSNull(),
            "installability": ["status": "metadata_only", "reason": reason]
        ]
        if let id { item["id"] = id }
        return item
    }

    func catalogSource(
        id: String = "source-catalog",
        catalogSkillID: String = "owner/repo:example",
        normalizedRoot: String = "skills/example"
    ) -> [String: Any] {
        [
            "id": id,
            "kind": "catalog",
            "catalogSkillId": catalogSkillID,
            "normalizedRoot": normalizedRoot
        ]
    }

    func publicSource(id: String = "source-public") -> [String: Any] {
        [
            "id": id,
            "kind": "public_github",
            "repositoryId": "123",
            "repositorySlug": "owner/repo",
            "normalizedRoot": "skills/example"
        ]
    }

    func privateSource(id: String = "source-private") -> [String: Any] {
        ["id": id, "kind": "private_github"]
    }

    func targetExists(_ name: String) -> Bool {
        let target = targetRoot.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: target.path) ||
            (try? FileManager.default.destinationOfSymbolicLink(atPath: target.path)) != nil
    }

    func targetDestination(_ name: String) throws -> URL {
        let target = targetRoot.appendingPathComponent(name)
        let path = try FileManager.default.destinationOfSymbolicLink(atPath: target.path)
        return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
    }

    func writeJournal(
        targetName: String,
        previousActivationContent: URL,
        preparedActivationContent: URL
    ) throws {
        let previousActivation = previousActivationContent.deletingLastPathComponent()
        let preparedActivation = preparedActivationContent.deletingLastPathComponent()
        let object: [String: Any] = [
            "version": 1,
            "transactionId": "50000000-0000-4000-8000-000000000001",
            "groupId": groupID,
            "groupRoute": "/u/owner/sets/team-skills",
            "groupRevision": 7,
            "targetAgent": "claude",
            "targetScope": "user_global",
            "targetRootIdentifier": "claude-user-global",
            "targetRootRelativePath": "skills",
            "entries": [[
                "targetName": targetName,
                "previousActivationRelativePath": relativePath(previousActivation, under: managedRoot),
                "preparedActivationRelativePath": relativePath(preparedActivation, under: managedRoot)
            ]]
        ]
        try FileManager.default.createDirectory(
            at: journalURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            .write(to: journalURL, options: .atomic)
    }

    func remove() {
        if let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey]
        ) {
            while let item = enumerator.nextObject() as? URL {
                if (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                    try? FileManager.default.setAttributes(
                        [.posixPermissions: 0o755],
                        ofItemAtPath: item.path
                    )
                }
            }
        }
        try? FileManager.default.removeItem(at: root)
    }

    private func relativePath(_ url: URL, under root: URL) -> String {
        String(url.standardizedFileURL.path.dropFirst(root.standardizedFileURL.path.count + 1))
    }
}
