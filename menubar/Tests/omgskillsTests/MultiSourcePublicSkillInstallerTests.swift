import Foundation
import Testing
@testable import omgskills

struct MultiSourcePublicSkillInstallerTests {
    @Test func rootNestedAndCompanionSourcesStayIndependentThroughUpdateAndCollision() async throws {
        let rootRepo = try LocalGitPackageRepository(packagePath: ".", skillName: "root-skill")
        defer { rootRepo.remove() }
        let nestedRepo = try LocalGitPackageRepository(packagePath: "skills/nested-skill", skillName: "nested-skill")
        defer { nestedRepo.remove() }
        let companionRepo = try LocalGitPackageRepository(packagePath: "deeper/skills/companion-skill", skillName: "companion-skill")
        defer { companionRepo.remove() }
        let repositories = [rootRepo, nestedRepo, companionRepo]
        let sources = try [
            PublicSkillInstallRequest(catalogID: "alias/root", repositorySlug: "one/root-skill", skillMDPath: "SKILL.md"),
            PublicSkillInstallRequest(catalogID: "two/repository:nested", repositorySlug: "two/repository", skillMDPath: "skills/nested-skill/SKILL.md"),
            PublicSkillInstallRequest(catalogID: "three/repository:companion", repositorySlug: "three/repository", skillMDPath: "deeper/skills/companion-skill/SKILL.md"),
        ]
        let paths = SkillFilesystemPaths.isolated(testRoot: rootRepo.root)
        let managed = rootRepo.root.appendingPathComponent("managed")
        let installer = ManagedSkillInstaller(managedRoot: managed, pathAnchor: paths.homeDirectory)
        var packages: [SkillPackage] = []
        var snapshots: [Snapshot] = []

        for index in sources.indices {
            let source = sources[index], repository = repositories[index]
            let fetcher = GitPublicSkillPackageFetcher(temporaryRoot: repository.temporaryRoot,
                remoteURL: { _ in repository.repositoryRoot })
            let package = try await fetcher.resolvePackage(source)
            #expect(package.coordinates == repository.coordinates)
            #expect(package.entries.contains { $0.path == "README.md" } == (index == 0))
            #expect(package.entries.contains { $0.path == "references/info.txt" })
            let review = try await installer.preparePublicInstall(source, package: package, filesystemPaths: paths)
            #expect(review.action == .install)
            #expect(try await installer.applyPublicInstall(reviewID: review.id) == .install)
            try verify(package, source: source, paths: paths)
            packages.append(package)
            snapshots.append(try snapshot(source, package: package, paths: paths))
            for previous in 0..<index {
                #expect(try snapshot(sources[previous], package: packages[previous], paths: paths) == snapshots[previous])
            }
        }

        let restarted = ManagedSkillInstaller(managedRoot: managed, pathAnchor: paths.homeDirectory)
        let repeated = try await restarted.preparePublicInstall(sources[0], package: packages[0], filesystemPaths: paths)
        #expect(repeated.action == .unchanged)
        #expect(try await restarted.applyPublicInstall(reviewID: repeated.id) == .unchanged)
        #expect(try snapshot(sources[0], package: packages[0], paths: paths) == snapshots[0])

        try companionRepo.advanceReference()
        let fetcher = GitPublicSkillPackageFetcher(temporaryRoot: companionRepo.temporaryRoot,
            remoteURL: { _ in companionRepo.repositoryRoot })
        let updated = try await fetcher.resolvePackage(sources[2])
        #expect(updated.coordinates.skillMdSha == packages[2].coordinates.skillMdSha)
        let review = try await restarted.preparePublicInstall(sources[2], package: updated, filesystemPaths: paths)
        #expect(review.action == .update)
        #expect(review.changes.map(\.path) == ["references/info.txt"])
        #expect(try await restarted.applyPublicInstall(reviewID: review.id) == .update)
        try verify(updated, source: sources[2], paths: paths)
        for index in 0..<2 {
            #expect(try snapshot(sources[index], package: packages[index], paths: paths) == snapshots[index])
        }
        let afterUpdate = try snapshot(sources[2], package: updated, paths: paths)
        #expect(afterUpdate.activationCount == snapshots[2].activationCount + 1)
        #expect(afterUpdate.provenance != snapshots[2].provenance)

        // Same leaf, different source: do not adopt or replace the existing skill.
        let collision = try PublicSkillInstallRequest(catalogID: "four/repository:collision",
            repositorySlug: "four/repository", skillMDPath: "other/companion-skill/SKILL.md")
        await #expect(throws: PublicSkillReviewError.ownershipConflict) {
            try await restarted.preparePublicInstall(collision, package: updated, filesystemPaths: paths)
        }
        for index in 0..<2 {
            #expect(try snapshot(sources[index], package: packages[index], paths: paths) == snapshots[index])
        }
        #expect(try snapshot(sources[2], package: updated, paths: paths) == afterUpdate)
        let reopened = ManagedSkillInstaller(managedRoot: managed, pathAnchor: paths.homeDirectory)
        let unchanged = try await reopened.preparePublicInstall(sources[2], package: updated, filesystemPaths: paths)
        #expect(unchanged.action == .unchanged)
        await reopened.cancelPublicInstall(reviewID: unchanged.id)
    }

    private struct Snapshot: Equatable {
        let link: String
        let provenance: Data
        let files: [Data]
        let installedAt: Date
        let activationCount: Int
    }

    private func snapshot(_ source: PublicSkillInstallRequest, package: SkillPackage, paths: SkillFilesystemPaths) throws -> Snapshot {
        let fm = FileManager.default
        let target = paths.codexSkillsRoot.appendingPathComponent(source.targetName)
        let link = try fm.destinationOfSymbolicLink(atPath: target.path)
        let activation = URL(fileURLWithPath: link).deletingLastPathComponent()
        let record = activation.appendingPathComponent("provenance.json")
        return try Snapshot(link: link, provenance: Data(contentsOf: record),
            files: package.entries.map { try Data(contentsOf: target.appendingPathComponent($0.path)) },
            installedAt: #require(fm.attributesOfItem(atPath: record.path)[.modificationDate] as? Date),
            activationCount: fm.contentsOfDirectory(atPath: activation.deletingLastPathComponent().path).count)
    }

    private func verify(_ package: SkillPackage, source: PublicSkillInstallRequest, paths: SkillFilesystemPaths) throws {
        let target = paths.codexSkillsRoot.appendingPathComponent(source.targetName)
        for file in package.entries {
            let url = target.appendingPathComponent(file.path)
            #expect(try Data(contentsOf: url) == file.data)
            #expect(FileManager.default.isExecutableFile(atPath: url.path) == (file.mode == "100755"))
        }
        let record = try #require(SkillInstallProvenanceStore.read(targetRoot: paths.codexSkillsRoot, targetName: source.targetName))
        #expect(record.sourceId == source.sourceID)
        #expect(record.catalogSkillId == source.catalogID)
        #expect(record.commitSha == package.coordinates.commitSha)
        #expect(record.treeSha == package.coordinates.treeSha)
        #expect(record.skillMdSha == package.coordinates.skillMdSha)
        #expect(record.targetAgent == "codex")
    }
}
