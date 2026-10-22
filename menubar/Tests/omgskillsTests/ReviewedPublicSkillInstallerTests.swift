import Foundation
import Testing
@testable import omgskills

struct ReviewedPublicSkillInstallerTests {
    @Test func installsRepeatsAndUpdatesExactReviewedPackagesAcrossInstallerInstances() async throws {
        let fixture = try await ReviewedPublicFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let a = try await fixture.prepare(installer, package: fixture.a)
        #expect(a.action == .install)
        #expect(a.fromCoordinates == nil)
        #expect(a.toCoordinates == fixture.a.coordinates)
        #expect(a.changes.count == 3)
        #expect(!FileManager.default.fileExists(atPath: fixture.target.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
        #expect(try await installer.applyPublicInstall(reviewID: a.id) == .install)
        try fixture.checkActive(fixture.a)
        let original = try fixture.snapshot()

        let repeatA = try await fixture.prepare(installer, package: fixture.a)
        #expect(repeatA.action == .unchanged)
        #expect(repeatA.changes.isEmpty)
        #expect(try await installer.applyPublicInstall(reviewID: repeatA.id) == .unchanged)
        #expect(try fixture.snapshot() == original)
        #expect(try fixture.activationCount() == 1)

        let restarted = fixture.installer()
        let b = try await fixture.prepare(restarted, package: fixture.b)
        #expect(b.action == .update)
        #expect(b.fromCoordinates == fixture.a.coordinates)
        #expect(b.changes.map(\.path) == ["SKILL.md"])
        #expect(b.changes[0].diff.contains("-name: example"))
        #expect(b.changes[0].diff.contains("+name: changed"))
        #expect(try fixture.snapshot() == original)
        #expect(try await restarted.applyPublicInstall(reviewID: b.id) == .update)
        try fixture.checkActive(fixture.b)
        #expect(try fixture.activationCount() == 2)
        await #expect(throws: PublicSkillReviewError.staleReview) {
            try await restarted.applyPublicInstall(reviewID: b.id)
        }
    }

    @Test func cancelIsReadOnlyAndInvalidatesConsent() async throws {
        let fixture = try await ReviewedPublicFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let a = try await fixture.prepare(installer, package: fixture.a)
        await installer.cancelPublicInstall(reviewID: a.id)
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
        await #expect(throws: PublicSkillReviewError.staleReview) {
            try await installer.applyPublicInstall(reviewID: a.id)
        }
        try await fixture.installA(installer)
        let original = try fixture.snapshot()
        let b = try await fixture.prepare(installer, package: fixture.b)
        await installer.cancelPublicInstall(reviewID: UUID())
        await installer.cancelPublicInstall(reviewID: b.id)
        #expect(try fixture.snapshot() == original)
        #expect(try fixture.activationCount() == 1)
    }

    @Test(arguments: [false, true])
    func refusesLocalEditsBeforeReviewOrBeforeApply(afterReview: Bool) async throws {
        let fixture = try await ReviewedPublicFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        try await fixture.installA(installer)
        let original = try fixture.snapshot()
        let b = afterReview ? try await fixture.prepare(installer, package: fixture.b) : nil
        try fixture.editReference()
        if let b {
            await #expect(throws: PublicSkillReviewError.localChanges) {
                try await installer.applyPublicInstall(reviewID: b.id)
            }
        } else {
            await #expect(throws: PublicSkillReviewError.localChanges) {
                try await fixture.prepare(installer, package: fixture.b)
            }
        }
        #expect(try fixture.snapshot() == original)
        #expect(try String(contentsOf: fixture.target.appendingPathComponent("references/info.txt"), encoding: .utf8) == "local edit\n")
        #expect(try fixture.activationCount() == 1)
    }

    @Test func rechecksLocalBytesAtTheSwitchBoundary() async throws {
        let fixture = try await ReviewedPublicFixture()
        defer { fixture.remove() }
        try await fixture.installA(fixture.installer())
        let original = try fixture.snapshot()
        let installer = fixture.installer(beforeSwitch: { try fixture.editReference() })
        let b = try await fixture.prepare(installer, package: fixture.b)
        await #expect(throws: PublicSkillReviewError.localChanges) {
            try await installer.applyPublicInstall(reviewID: b.id)
        }
        #expect(try fixture.snapshot() == original)
        #expect(try fixture.activationCount() == 1)
    }

    @Test func anotherActivationInvalidatesReviewEvenForTheSameVersion() async throws {
        let fixture = try await ReviewedPublicFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        try await fixture.installA(installer)
        let stale = try await fixture.prepare(installer, package: fixture.b)
        let competing = fixture.installer()
        let b = try await fixture.prepare(competing, package: fixture.b)
        _ = try await competing.applyPublicInstall(reviewID: b.id)
        let current = try fixture.snapshot()
        await #expect(throws: PublicSkillReviewError.staleReview) {
            try await installer.applyPublicInstall(reviewID: stale.id)
        }
        #expect(try fixture.snapshot() == current)
        try fixture.checkActive(fixture.b)
    }

    @Test func changedProvenanceAndGroupOwnershipAreNotAdopted() async throws {
        let fixture = try await ReviewedPublicFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        try await fixture.installA(installer)
        let b = try await fixture.prepare(installer, package: fixture.b)
        try fixture.changeProvenance(key: "installedAt", value: "changed")
        await #expect(throws: PublicSkillReviewError.staleReview) {
            try await installer.applyPublicInstall(reviewID: b.id)
        }
        try fixture.changeProvenance(key: "groupId", value: "group-owner")
        await #expect(throws: PublicSkillReviewError.ownershipConflict) {
            try await fixture.prepare(installer, package: fixture.b)
        }
    }

    @Test func sourceMismatchAndExplicitCommitMismatchAreRefused() async throws {
        let fixture = try await ReviewedPublicFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let pinned = try PublicSkillInstallRequest(
            catalogID: "id", repositorySlug: "owner/repo", skillMDPath: "skills/example/SKILL.md",
            commitSha: fixture.a.coordinates.commitSha
        )
        await #expect(throws: SkillPackageValidationError(code: .commitShaMismatch, path: nil)) {
            try await installer.preparePublicInstall(pinned, package: fixture.b, filesystemPaths: fixture.paths)
        }
        try await fixture.installA(installer)
        let anotherSource = try PublicSkillInstallRequest(
            catalogID: "id", repositorySlug: "other/repo", skillMDPath: "skills/example/SKILL.md"
        )
        await #expect(throws: PublicSkillReviewError.ownershipConflict) {
            try await installer.preparePublicInstall(anotherSource, package: fixture.b, filesystemPaths: fixture.paths)
        }
        try fixture.checkActive(fixture.a)
    }

    @Test(arguments: ["unmanaged", "other-root", "legacy-record", "redirected-root"])
    func refusesDestinationConflicts(kind: String) async throws {
        let fixture = try await ReviewedPublicFixture()
        defer { fixture.remove() }
        let fm = FileManager.default
        switch kind {
        case "unmanaged": try fm.createDirectory(at: fixture.target, withIntermediateDirectories: true)
        case "other-root":
            let alternate = fixture.paths.agentsSkillsRoot.appendingPathComponent("example")
            try fm.createDirectory(at: alternate, withIntermediateDirectories: true)
        case "legacy-record":
            let record = SkillInstallProvenanceStore.metadataURL(targetRoot: fixture.paths.codexSkillsRoot, targetName: "example")
            try fm.createDirectory(at: record.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("{}".utf8).write(to: record)
        default:
            try fm.createDirectory(at: fixture.paths.homeDirectory, withIntermediateDirectories: true)
            try fm.createSymbolicLink(at: fixture.paths.homeDirectory.appendingPathComponent(".codex"), withDestinationURL: fixture.repository.repositoryRoot)
        }
        await #expect(throws: (any Error).self) {
            try await fixture.prepare(fixture.installer(), package: fixture.a)
        }
        #expect(!fm.fileExists(atPath: fixture.managed.path))
    }

    @Test func secondReviewAndCancelledTaskCannotWrite() async throws {
        let fixture = try await ReviewedPublicFixture()
        defer { fixture.remove() }
        let installer = fixture.installer()
        let a = try await fixture.prepare(installer, package: fixture.a)
        await #expect(throws: ManagedSkillInstaller.InstallError.operationInProgress) {
            try await fixture.prepare(installer, package: fixture.b)
        }
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await installer.applyPublicInstall(reviewID: a.id)
        }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
        _ = try await fixture.prepare(installer, package: fixture.a)
    }
}

private struct ReviewedPublicFixture: Sendable {
    let repository: LocalGitPackageRepository
    let paths: SkillFilesystemPaths
    let managed: URL
    let source: PublicSkillInstallRequest
    let a: SkillPackage
    let b: SkillPackage
    var target: URL { paths.codexSkillsRoot.appendingPathComponent("example") }

    init() async throws {
        let repository = try LocalGitPackageRepository()
        do {
            let source = try PublicSkillInstallRequest(
                catalogID: "owner/repo:example", repositorySlug: "owner/repo", skillMDPath: "skills/example/SKILL.md"
            )
            let fetcher = GitPublicSkillPackageFetcher(
                temporaryRoot: repository.temporaryRoot, remoteURL: { _ in repository.repositoryRoot }
            )
            a = try await fetcher.resolvePackage(source)
            try repository.advanceHead()
            b = try await fetcher.resolvePackage(source)
            self.source = source
            self.repository = repository
            self.paths = .isolated(testRoot: repository.root)
            self.managed = repository.root.appendingPathComponent("managed", isDirectory: true)
        } catch {
            repository.remove()
            throw error
        }
    }

    func installer(beforeSwitch: @escaping ManagedSkillInstaller.BeforeActivationSwitch = {}) -> ManagedSkillInstaller {
        ManagedSkillInstaller(managedRoot: managed, pathAnchor: paths.homeDirectory, beforeActivationSwitch: beforeSwitch)
    }

    func prepare(_ installer: ManagedSkillInstaller, package: SkillPackage) async throws -> PublicSkillInstallReview {
        try await installer.preparePublicInstall(source, package: package, filesystemPaths: paths)
    }

    func installA(_ installer: ManagedSkillInstaller) async throws {
        let review = try await prepare(installer, package: a)
        _ = try await installer.applyPublicInstall(reviewID: review.id)
    }

    func snapshot() throws -> [Data] {
        let link = try FileManager.default.destinationOfSymbolicLink(atPath: target.path)
        let record = URL(fileURLWithPath: link).deletingLastPathComponent().appendingPathComponent("provenance.json")
        return [Data(link.utf8), try Data(contentsOf: record)]
    }

    func checkActive(_ package: SkillPackage) throws {
        for entry in package.entries {
            let file = target.appendingPathComponent(entry.path)
            #expect(try Data(contentsOf: file) == entry.data)
            #expect(FileManager.default.isExecutableFile(atPath: file.path) == (entry.mode == "100755"))
        }
        let record = try #require(SkillInstallProvenanceStore.read(targetRoot: paths.codexSkillsRoot, targetName: "example"))
        #expect(record.sourceId == source.sourceID)
        #expect(record.commitSha == package.coordinates.commitSha)
        #expect(record.treeSha == package.coordinates.treeSha)
        #expect(record.skillMdSha == package.coordinates.skillMdSha)
        #expect(record.targetAgent == "codex")
    }

    func activationCount() throws -> Int {
        let root = managed.appendingPathComponent("activations")
        return try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .reduce(0) { try $0 + FileManager.default.contentsOfDirectory(atPath: $1.path).count }
    }

    func editReference() throws {
        let file = target.appendingPathComponent("references/info.txt")
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
        try Data("local edit\n".utf8).write(to: file)
    }

    func changeProvenance(key: String, value: String) throws {
        let link = try FileManager.default.destinationOfSymbolicLink(atPath: target.path)
        let url = URL(fileURLWithPath: link).deletingLastPathComponent().appendingPathComponent("provenance.json")
        var object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        object[key] = value
        try JSONSerialization.data(withJSONObject: object).write(to: url)
    }

    func remove() { repository.remove() }
}
