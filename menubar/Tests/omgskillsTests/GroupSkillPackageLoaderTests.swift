import Foundation
import Testing
@testable import omgskills

struct GroupSkillPackageLoaderTests {
    @Test func routesCatalogAndPublicItemsDirectlyToGitHubFetcher() async throws {
        let publicFetcher = RecordingPublicPackageFetcher(
            package: GroupSkillPackageTestSupport.package
        )
        let privateFetcher = RecordingPrivatePackageFetcher(
            package: GroupSkillPackageTestSupport.package
        )
        let loader = GroupSkillPackageLoader(
            catalog: CatalogSkillPackageIndex(skills: [GroupSkillPackageTestSupport.catalogSkill()]),
            publicFetcher: publicFetcher,
            privateFetcher: privateFetcher
        )
        let credential = GroupSkillPackageTestSupport.credential()

        let catalog = try GroupSkillPackageTestSupport.installableItem(sourceJSON: """
            {
              "id": "source-catalog",
              "kind": "catalog",
              "catalogSkillId": "owner/repo:example",
              "normalizedRoot": "skills/example"
            }
            """)
        _ = try await loader.loadPackage(for: catalog, credential: credential)

        let publicItem = try GroupSkillPackageTestSupport.installableItem(sourceJSON: """
            {
              "id": "source-public",
              "kind": "public_github",
              "repositoryId": "123",
              "repositorySlug": "Other/Repo",
              "normalizedRoot": "."
            }
            """)
        _ = try await loader.loadPackage(for: publicItem, credential: credential)

        #expect(await publicFetcher.requests() == [
            PublicPackageRequest(
                repositorySlug: "owner/repo",
                normalizedRoot: "skills/example",
                expected: GroupSkillPackageTestSupport.coordinates
            ),
            PublicPackageRequest(
                repositorySlug: "Other/Repo",
                normalizedRoot: ".",
                expected: GroupSkillPackageTestSupport.coordinates
            )
        ])
        #expect(await privateFetcher.requests().isEmpty)
    }

    @Test func routesPrivateItemsOnlyThroughScopedBrokerFetcher() async throws {
        let publicFetcher = RecordingPublicPackageFetcher(
            package: GroupSkillPackageTestSupport.package
        )
        let privateFetcher = RecordingPrivatePackageFetcher(
            package: GroupSkillPackageTestSupport.package
        )
        let loader = GroupSkillPackageLoader(
            catalog: CatalogSkillPackageIndex(skills: []),
            publicFetcher: publicFetcher,
            privateFetcher: privateFetcher
        )
        let item = try GroupSkillPackageTestSupport.installableItem(sourceJSON: """
            {
              "id": "source-private",
              "kind": "private_github"
            }
            """)

        _ = try await loader.loadPackage(
            for: item,
            credential: GroupSkillPackageTestSupport.credential()
        )

        let request = try #require(await privateFetcher.requests().first)
        #expect(request.sourceID == "source-private")
        #expect(request.release.id == GroupSkillPackageTestSupport.releaseID)
        #expect(await publicFetcher.requests().isEmpty)
    }

    @Test func rejectsMetadataOnlyAndStaleCatalogItemsWithoutFetching() async throws {
        let publicFetcher = RecordingPublicPackageFetcher(
            package: GroupSkillPackageTestSupport.package
        )
        let privateFetcher = RecordingPrivatePackageFetcher(
            package: GroupSkillPackageTestSupport.package
        )
        let loader = GroupSkillPackageLoader(
            catalog: CatalogSkillPackageIndex(skills: []),
            publicFetcher: publicFetcher,
            privateFetcher: privateFetcher
        )

        await #expect(throws: GroupSkillPackageLoaderError.metadataOnly(.syncedLocalOnly)) {
            try await loader.loadPackage(
                for: GroupSkillPackageTestSupport.metadataOnlyItem(),
                credential: GroupSkillPackageTestSupport.credential()
            )
        }

        let stale = try GroupSkillPackageTestSupport.installableItem(sourceJSON: """
            {
              "id": "source-catalog",
              "kind": "catalog",
              "catalogSkillId": "owner/repo:missing",
              "normalizedRoot": "."
            }
            """)
        await #expect(
            throws: GroupSkillPackageLoaderError.catalogSkillUnavailable("owner/repo:missing")
        ) {
            try await loader.loadPackage(
                for: stale,
                credential: GroupSkillPackageTestSupport.credential()
            )
        }
        #expect(await publicFetcher.requests().isEmpty)
        #expect(await privateFetcher.requests().isEmpty)
    }

    @Test func catalogIndexRejectsNonGitHubAndMismatchedRepositories() throws {
        let invalidURL = CatalogSkillPackageIndex(skills: [
            GroupSkillPackageTestSupport.catalogSkill(githubURL: "https://example.com/owner/repo")
        ])
        #expect(throws: GroupSkillPackageLoaderError.invalidCatalogRepository("owner/repo:example")) {
            try invalidURL.repositorySlug(for: "owner/repo:example")
        }

        let mismatch = CatalogSkillPackageIndex(skills: [
            GroupSkillPackageTestSupport.catalogSkill(githubURL: "https://github.com/other/repo")
        ])
        #expect(throws: GroupSkillPackageLoaderError.invalidCatalogRepository("owner/repo:example")) {
            try mismatch.repositorySlug(for: "owner/repo:example")
        }
    }

    @Test func validatesAdapterOutputAgainstManifestCoordinates() async throws {
        let invalid = SkillPackage(
            coordinates: GroupSkillPackageTestSupport.package.coordinates,
            entries: [
                SkillPackageEntry(
                    path: "SKILL.md",
                    mode: "100644",
                    data: Data("changed".utf8),
                    blobSha: GroupSkillPackageTestSupport.skillMdSha
                )
            ]
        )
        let loader = GroupSkillPackageLoader(
            catalog: CatalogSkillPackageIndex(skills: [GroupSkillPackageTestSupport.catalogSkill()]),
            publicFetcher: RecordingPublicPackageFetcher(package: invalid),
            privateFetcher: RecordingPrivatePackageFetcher(package: invalid)
        )
        let item = try GroupSkillPackageTestSupport.installableItem(sourceJSON: """
            {
              "id": "source-catalog",
              "kind": "catalog",
              "catalogSkillId": "owner/repo:example",
              "normalizedRoot": "."
            }
            """)

        await #expect(throws: SkillPackageValidationError.self) {
            try await loader.loadPackage(
                for: item,
                credential: GroupSkillPackageTestSupport.credential()
            )
        }
    }
}

private struct PublicPackageRequest: Equatable, Sendable {
    let repositorySlug: String
    let normalizedRoot: String
    let expected: SkillPackageCoordinates
}

private actor RecordingPublicPackageFetcher: PublicSkillPackageFetching {
    private let package: SkillPackage
    private var recorded: [PublicPackageRequest] = []

    init(package: SkillPackage) {
        self.package = package
    }

    func fetchPackage(
        repositorySlug: String,
        normalizedRoot: String,
        expected: SkillPackageCoordinates
    ) async throws -> SkillPackage {
        recorded.append(PublicPackageRequest(
            repositorySlug: repositorySlug,
            normalizedRoot: normalizedRoot,
            expected: expected
        ))
        return package
    }

    func requests() -> [PublicPackageRequest] {
        recorded
    }
}

private struct PrivatePackageRequest: Equatable, Sendable {
    let sourceID: String
    let release: GroupManifestRelease
}

private actor RecordingPrivatePackageFetcher: PrivateSkillPackageFetching {
    private let package: SkillPackage
    private var recorded: [PrivatePackageRequest] = []

    init(package: SkillPackage) {
        self.package = package
    }

    func fetchPackage(
        sourceID: String,
        release: GroupManifestRelease,
        credential: StoredDeviceCredential
    ) async throws -> SkillPackage {
        recorded.append(PrivatePackageRequest(sourceID: sourceID, release: release))
        return package
    }

    func requests() -> [PrivatePackageRequest] {
        recorded
    }
}
