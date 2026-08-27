import Foundation
import Testing
@testable import omgskills

struct ManagedSkillInstallerTests {
    private enum TestFailure: Error {
        case injected
    }

    @Test func legacyProvenanceDecodesWithManagedFieldsAbsent() throws {
        let data = Data(
            """
            {
              "catalogSkillId": "owner/repo:skill",
              "githubUrl": "https://github.com/owner/repo",
              "installedAt": "2026-08-27T12:00:00Z",
              "skillMdSha": "6d2190081ae23aae9b09e89d10a3e1f57c3bb398"
            }
            """.utf8
        )

        let provenance = try JSONDecoder().decode(SkillInstallProvenance.self, from: data)

        #expect(provenance.catalogSkillId == "owner/repo:skill")
        #expect(provenance.sourceKind == nil)
        #expect(provenance.releaseId == nil)
        #expect(provenance.targetScope == nil)
    }

    @Test func managedInstallWritesCompleteProvenanceAndPreservesExecutableMode() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let installer = ManagedSkillInstaller(managedRoot: fixture.managedRoot)
        let request = fixture.request(releaseId: "release-1")

        let result = try await installer.install(request) { fixture.package }

        #expect(result == .installed)
        #expect(try Data(contentsOf: fixture.targetURL.appendingPathComponent("SKILL.md")) == fixture.skillData)
        let script = fixture.targetURL.appendingPathComponent("scripts/run.sh")
        #expect(FileManager.default.isExecutableFile(atPath: script.path))
        let skillPermissions = try #require(
            FileManager.default.attributesOfItem(
                atPath: fixture.targetURL.appendingPathComponent("SKILL.md").path
            )[.posixPermissions] as? NSNumber
        ).intValue
        #expect((skillPermissions & 0o222) == 0)
        let provenance = try #require(SkillInstallProvenanceStore.read(
            targetRoot: fixture.targetRoot,
            targetName: fixture.targetName
        ))
        #expect(provenance.catalogSkillId == "owner/repo:example")
        #expect(provenance.sourceKind == ManagedSkillSourceKind.privateGitHub.rawValue)
        #expect(provenance.sourceId == "source-1")
        #expect(provenance.releaseId == "release-1")
        #expect(provenance.groupRevision == 7)
        #expect(provenance.targetAgent == ManagedSkillTargetAgent.claude.rawValue)
        #expect(provenance.targetScope == ManagedSkillTargetScope.userGlobal.rawValue)
        #expect(provenance.installMode == ManagedSkillInstallMode.snapshot.rawValue)
    }

    @Test func updateKeepsVersionFoldersSeparateAndSwitchesAtomically() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let installer = ManagedSkillInstaller(managedRoot: fixture.managedRoot)

        _ = try await installer.install(fixture.request(releaseId: "release-1")) {
            fixture.package
        }
        let firstDestination = try FileManager.default.destinationOfSymbolicLink(
            atPath: fixture.targetURL.path
        )
        _ = try await installer.install(fixture.request(releaseId: "release-2")) {
            fixture.package
        }
        let secondDestination = try FileManager.default.destinationOfSymbolicLink(
            atPath: fixture.targetURL.path
        )

        #expect(firstDestination != secondDestination)
        #expect(try countLeafDirectories(at: fixture.managedRoot.appendingPathComponent("packages")) == 2)
        #expect(try countLeafDirectories(at: fixture.managedRoot.appendingPathComponent("activations")) == 2)
        #expect(SkillInstallProvenanceStore.read(
            targetRoot: fixture.targetRoot,
            targetName: fixture.targetName
        )?.releaseId == "release-2")
    }

    @Test func twoSkillsFromOneSourceCanRemainActiveAcrossClaudeAndCodex() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let codexRoot = fixture.root.appendingPathComponent("codex-skills", isDirectory: true)
        let installer = ManagedSkillInstaller(managedRoot: fixture.managedRoot)

        _ = try await installer.install(
            fixture.request(releaseId: "release-1")
        ) { fixture.package }
        _ = try await installer.install(
            fixture.request(
                releaseId: "release-2",
                agent: .codex,
                targetRoot: codexRoot,
                rootIdentifier: "codex-user-global"
            )
        ) { fixture.package }

        #expect(FileManager.default.fileExists(
            atPath: fixture.targetRoot.appendingPathComponent("example/SKILL.md").path
        ))
        #expect(FileManager.default.fileExists(
            atPath: codexRoot.appendingPathComponent("example/SKILL.md").path
        ))
        #expect(SkillInstallProvenanceStore.read(
            targetRoot: codexRoot,
            targetName: "example"
        )?.targetAgent == ManagedSkillTargetAgent.codex.rawValue)
        #expect(try FileManager.default.contentsOfDirectory(
            at: fixture.managedRoot.appendingPathComponent("activations"),
            includingPropertiesForKeys: nil
        ).count == 2)
    }

    @Test func loaderValidationAndSwitchFailuresLeavePreviousInstallUsable() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let installer = ManagedSkillInstaller(managedRoot: fixture.managedRoot)
        _ = try await installer.install(fixture.request(releaseId: "release-1")) {
            fixture.package
        }
        let activeDestination = try FileManager.default.destinationOfSymbolicLink(
            atPath: fixture.targetURL.path
        )

        await #expect(throws: TestFailure.self) {
            _ = try await installer.install(fixture.request(releaseId: "loader-failure")) {
                throw TestFailure.injected
            }
        }

        var invalidEntries = fixture.package.entries
        let original = invalidEntries[0]
        invalidEntries[0] = SkillPackageEntry(
            path: original.path,
            mode: original.mode,
            data: Data("changed".utf8),
            blobSha: original.blobSha
        )
        let invalidPackage = SkillPackage(
            coordinates: fixture.package.coordinates,
            entries: invalidEntries
        )
        await #expect(throws: SkillPackageValidationError.self) {
            _ = try await installer.install(fixture.request(releaseId: "invalid")) {
                invalidPackage
            }
        }

        let failingInstaller = ManagedSkillInstaller(
            managedRoot: fixture.managedRoot,
            beforeActivationSwitch: { throw TestFailure.injected }
        )
        await #expect(throws: TestFailure.self) {
            _ = try await failingInstaller.install(
                fixture.request(releaseId: "switch-failure")
            ) {
                fixture.package
            }
        }

        let stagingRoot = fixture.managedRoot.appendingPathComponent("staging")
        try? FileManager.default.removeItem(at: stagingRoot)
        try Data("not a directory".utf8).write(to: stagingRoot)
        await #expect {
            _ = try await installer.install(fixture.request(releaseId: "write-failure")) {
                fixture.package
            }
        } throws: { _ in true }

        #expect(try FileManager.default.destinationOfSymbolicLink(
            atPath: fixture.targetURL.path
        ) == activeDestination)
        #expect(try Data(contentsOf: fixture.targetURL.appendingPathComponent("SKILL.md")) == fixture.skillData)
        #expect(SkillInstallProvenanceStore.read(
            targetRoot: fixture.targetRoot,
            targetName: fixture.targetName
        )?.releaseId == "release-1")
    }

    @Test func unmanagedTargetIsNeverOverwritten() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try FileManager.default.createDirectory(
            at: fixture.targetURL,
            withIntermediateDirectories: true
        )
        let original = Data("unmanaged".utf8)
        try original.write(to: fixture.targetURL.appendingPathComponent("SKILL.md"))
        let installer = ManagedSkillInstaller(managedRoot: fixture.managedRoot)

        await #expect(throws: ManagedSkillInstaller.InstallError.self) {
            _ = try await installer.install(fixture.request(releaseId: "release-1")) {
                fixture.package
            }
        }

        #expect(try Data(contentsOf: fixture.targetURL.appendingPathComponent("SKILL.md")) == original)
    }

    @Test func destinationIdentityMustBeNormalizedAndRevisionMustBePositive() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let installer = ManagedSkillInstaller(managedRoot: fixture.managedRoot)
        let invalidRoot = ManagedSkillInstallRequest(
            sourceKind: .privateGitHub,
            sourceId: "source-1",
            releaseId: "release-1",
            groupRevision: 7,
            catalogSkillId: nil,
            githubUrl: nil,
            expectedCoordinates: fixture.package.coordinates,
            mode: .snapshot,
            destination: ManagedSkillDestination(
                agent: .claude,
                scope: .project,
                rootIdentifier: "Not Normalized",
                rootURL: fixture.targetRoot,
                targetName: fixture.targetName
            )
        )

        await #expect(throws: ManagedSkillInstaller.InstallError.self) {
            _ = try await installer.install(invalidRoot) { fixture.package }
        }

        let invalidRevision = ManagedSkillInstallRequest(
            sourceKind: invalidRoot.sourceKind,
            sourceId: invalidRoot.sourceId,
            releaseId: invalidRoot.releaseId,
            groupRevision: 0,
            catalogSkillId: invalidRoot.catalogSkillId,
            githubUrl: invalidRoot.githubUrl,
            expectedCoordinates: invalidRoot.expectedCoordinates,
            mode: invalidRoot.mode,
            destination: ManagedSkillDestination(
                agent: .claude,
                scope: .userGlobal,
                rootIdentifier: "claude-user-global",
                rootURL: fixture.targetRoot,
                targetName: fixture.targetName
            )
        )
        await #expect(throws: ManagedSkillInstaller.InstallError.self) {
            _ = try await installer.install(invalidRevision) { fixture.package }
        }
    }

    @Test func cleanupRemovesOnlyInactiveManagedVersions() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let installer = ManagedSkillInstaller(managedRoot: fixture.managedRoot)
        _ = try await installer.install(fixture.request(releaseId: "release-1")) {
            fixture.package
        }
        _ = try await installer.install(fixture.request(releaseId: "release-2")) {
            fixture.package
        }

        let report = try await installer.cleanup(targetRoots: [fixture.targetRoot])

        #expect(report == ManagedSkillCleanupReport(removedActivations: 1, removedPackages: 1))
        #expect(try countLeafDirectories(at: fixture.managedRoot.appendingPathComponent("packages")) == 1)
        #expect(try countLeafDirectories(at: fixture.managedRoot.appendingPathComponent("activations")) == 1)
        #expect(try Data(contentsOf: fixture.targetURL.appendingPathComponent("SKILL.md")) == fixture.skillData)
        #expect(SkillInstallProvenanceStore.read(
            targetRoot: fixture.targetRoot,
            targetName: fixture.targetName
        )?.releaseId == "release-2")
    }

    @Test func cleanupFailsClosedForMalformedManagedTarget() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try FileManager.default.createDirectory(
            at: fixture.targetRoot,
            withIntermediateDirectories: true
        )
        let malformed = fixture.managedRoot.appendingPathComponent("unknown/content")
        try FileManager.default.createDirectory(
            at: malformed,
            withIntermediateDirectories: true
        )
        try FileManager.default.createSymbolicLink(
            at: fixture.targetURL,
            withDestinationURL: malformed
        )
        let installer = ManagedSkillInstaller(managedRoot: fixture.managedRoot)

        await #expect(throws: ManagedSkillInstaller.InstallError.self) {
            _ = try await installer.cleanup(targetRoots: [fixture.targetRoot])
        }

        #expect(FileManager.default.fileExists(atPath: malformed.path))
    }

    @Test func managedInstallWorksWithScannerAndExistingUninstaller() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let installer = ManagedSkillInstaller(managedRoot: fixture.managedRoot)
        _ = try await installer.install(fixture.request(releaseId: "release-1")) {
            fixture.package
        }

        let scan = InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: fixture.targetRoot, origin: "Claude")
        ])
        let installed = try #require(scan.installations.first)
        #expect(installed.catalogSkillId == "owner/repo:example")
        #expect(installed.githubUrl == "https://github.com/owner/repo")
        #expect(installed.authorHandle == "owner")
        #expect(installed.isSymlink == true)

        _ = try InstalledSkillUninstaller.uninstall(
            installed,
            allowedRoots: [fixture.targetRoot]
        ) { url in
            try FileManager.default.removeItem(at: url)
        }

        #expect(!FileManager.default.fileExists(atPath: fixture.targetURL.path))
        #expect(InstalledSkillsScanner.scan(roots: [
            InstalledSkillsScanner.Root(url: fixture.targetRoot, origin: "Claude")
        ]).installations.isEmpty)
        let report = try await installer.cleanup(targetRoots: [fixture.targetRoot])
        #expect(report.removedActivations == 1)
        #expect(report.removedPackages == 1)
    }

    private func countLeafDirectories(at root: URL) throws -> Int {
        guard FileManager.default.fileExists(atPath: root.path) else { return 0 }
        return try FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil
        ).reduce(into: 0) { count, parent in
            count += try FileManager.default.contentsOfDirectory(
                at: parent,
                includingPropertiesForKeys: nil
            ).count
        }
    }
}

private struct Fixture: @unchecked Sendable {
    let root: URL
    let managedRoot: URL
    let targetRoot: URL
    let targetName = "example"
    let package: SkillPackage

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        managedRoot = root.appendingPathComponent("managed", isDirectory: true)
        targetRoot = root.appendingPathComponent("claude-skills", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        let skillData = Data(
            """
            ---
            name: example
            description: Example package.
            ---

            """.utf8
        )
        let scriptData = Data("#!/bin/sh\necho hello\n".utf8)
        let referenceData = Data("reference\n".utf8)
        package = SkillPackage(
            coordinates: SkillPackageCoordinates(
                commitSha: String(repeating: "1", count: 40),
                treeSha: "315d6f38e5d0c3ab41809ba1c188e25eab45b5a1",
                skillMdSha: "6d2190081ae23aae9b09e89d10a3e1f57c3bb398"
            ),
            entries: [
                Self.entry(path: "SKILL.md", data: skillData),
                Self.entry(path: "scripts/run.sh", mode: "100755", data: scriptData),
                Self.entry(path: "references/info.txt", data: referenceData)
            ]
        )
    }

    var targetURL: URL {
        targetRoot.appendingPathComponent(targetName, isDirectory: true)
    }

    var skillData: Data {
        package.entries.first { $0.path == "SKILL.md" }!.data
    }

    func request(
        releaseId: String,
        targetName: String = "example",
        agent: ManagedSkillTargetAgent = .claude,
        targetRoot: URL? = nil,
        rootIdentifier: String = "claude-user-global"
    ) -> ManagedSkillInstallRequest {
        let resolvedTargetRoot = targetRoot ?? self.targetRoot
        return ManagedSkillInstallRequest(
            sourceKind: .privateGitHub,
            sourceId: "source-1",
            releaseId: releaseId,
            groupRevision: 7,
            catalogSkillId: "owner/repo:example",
            githubUrl: "https://github.com/owner/repo",
            expectedCoordinates: package.coordinates,
            mode: .snapshot,
            destination: ManagedSkillDestination(
                agent: agent,
                scope: .userGlobal,
                rootIdentifier: rootIdentifier,
                rootURL: resolvedTargetRoot,
                targetName: targetName
            )
        )
    }

    func remove() {
        if let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: []
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

    private static func entry(
        path: String,
        mode: String = "100644",
        data: Data
    ) -> SkillPackageEntry {
        SkillPackageEntry(
            path: path,
            mode: mode,
            data: data,
            blobSha: SkillIdentityResolver.gitBlobSHA(for: data)
        )
    }
}
