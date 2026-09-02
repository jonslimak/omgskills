import Foundation
import Testing
@testable import omgskills

enum GroupSkillPackageTestSupport {
    static let commitSha = String(repeating: "1", count: 40)
    static let treeSha = "315d6f38e5d0c3ab41809ba1c188e25eab45b5a1"
    static let skillMdSha = "6d2190081ae23aae9b09e89d10a3e1f57c3bb398"
    static let sourceID = "11111111-1111-1111-1111-111111111111"
    static let releaseID = "22222222-2222-2222-2222-222222222222"

    static var coordinates: SkillPackageCoordinates {
        SkillPackageCoordinates(
            commitSha: commitSha,
            treeSha: treeSha,
            skillMdSha: skillMdSha
        )
    }

    static var package: SkillPackage {
        SkillPackage(
            coordinates: coordinates,
            entries: [
                entry(
                    path: "SKILL.md",
                    data: Data(
                        """
                        ---
                        name: example
                        description: Example package.
                        ---

                        """.utf8
                    )
                ),
                entry(
                    path: "scripts/run.sh",
                    mode: "100755",
                    data: Data("#!/bin/sh\necho hello\n".utf8)
                ),
                entry(
                    path: "references/info.txt",
                    data: Data("reference\n".utf8)
                )
            ]
        )
    }

    static func entry(path: String, mode: String = "100644", data: Data) -> SkillPackageEntry {
        SkillPackageEntry(
            path: path,
            mode: mode,
            data: data,
            blobSha: SkillIdentityResolver.gitBlobSHA(for: data)
        )
    }

    static func release(
        id: String = releaseID,
        coordinates: SkillPackageCoordinates = coordinates
    ) throws -> GroupManifestRelease {
        try JSONDecoder().decode(
            GroupManifestRelease.self,
            from: Data(
                """
                {
                  "id": "\(id)",
                  "commitSha": "\(coordinates.commitSha)",
                  "treeSha": "\(coordinates.treeSha)",
                  "skillMdSha": "\(coordinates.skillMdSha)"
                }
                """.utf8
            )
        )
    }

    static func installableItem(sourceJSON: String) throws -> GroupManifestItem {
        try JSONDecoder().decode(
            GroupManifestItem.self,
            from: Data(
                """
                {
                  "id": "item-1",
                  "kind": "catalog",
                  "position": 0,
                  "name": "example",
                  "description": null,
                  "note": null,
                  "installability": {
                    "status": "installable",
                    "source": \(sourceJSON),
                    "release": {
                      "id": "\(releaseID)",
                      "commitSha": "\(commitSha)",
                      "treeSha": "\(treeSha)",
                      "skillMdSha": "\(skillMdSha)"
                    }
                  }
                }
                """.utf8
            )
        )
    }

    static func metadataOnlyItem() throws -> GroupManifestItem {
        try JSONDecoder().decode(
            GroupManifestItem.self,
            from: Data(
                """
                {
                  "id": "item-1",
                  "kind": "synced",
                  "position": 0,
                  "name": "example",
                  "description": null,
                  "note": null,
                  "installability": {
                    "status": "metadata_only",
                    "reason": "synced_local_only"
                  }
                }
                """.utf8
            )
        )
    }

    static func credential(
        expiresAt: Date = Date(timeIntervalSince1970: 1_900_000_000),
        scopes: Set<DeviceScope> = Set(DeviceScope.allCases)
    ) -> StoredDeviceCredential {
        StoredDeviceCredential(
            credential: "device-secret",
            connection: DeviceConnectionInfo(
                deviceID: "device-1",
                accountLabel: "test@example.com",
                expiresAt: expiresAt,
                grantedScopes: scopes
            )
        )
    }

    static func catalogSkill(
        id: String = "owner/repo:example",
        githubURL: String = "https://github.com/owner/repo/tree/main/skills/example"
    ) -> Skill {
        Skill(
            id: id,
            name: "example",
            description: "Example",
            githubUrl: githubURL,
            installCmd: "",
            authorHandle: "owner",
            tags: [],
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: "",
            firstSeen: "",
            skillMdSha: skillMdSha,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: nil,
            isSymlink: nil,
            isLocalOnly: nil
        )
    }

    static func ndjson(
        sourceID: String = sourceID,
        releaseID: String = releaseID,
        package: SkillPackage = package
    ) throws -> Data {
        let encoder = JSONEncoder()
        var lines: [Data] = []
        lines.append(try encoder.encode(PackageHeaderFixture(
            type: "omgskills.skill_package",
            version: 1,
            sourceId: sourceID,
            releaseId: releaseID,
            coordinates: CoordinatesFixture(package.coordinates),
            fileCount: package.entries.count
        )))
        for entry in package.entries {
            lines.append(try encoder.encode(PackageFileFixture(
                type: "file",
                path: entry.path,
                mode: entry.mode,
                blobSha: entry.blobSha,
                data: entry.data.base64EncodedString()
            )))
        }
        lines.append(try encoder.encode(PackageEndFixture(type: "end")))
        return lines.reduce(into: Data()) { output, line in
            output.append(line)
            output.append(10)
        }
    }
}

private struct CoordinatesFixture: Encodable {
    let commitSha: String
    let treeSha: String
    let skillMdSha: String

    init(_ coordinates: SkillPackageCoordinates) {
        commitSha = coordinates.commitSha
        treeSha = coordinates.treeSha
        skillMdSha = coordinates.skillMdSha
    }
}

private struct PackageHeaderFixture: Encodable {
    let type: String
    let version: Int
    let sourceId: String
    let releaseId: String
    let coordinates: CoordinatesFixture
    let fileCount: Int
}

private struct PackageFileFixture: Encodable {
    let type: String
    let path: String
    let mode: String
    let blobSha: String
    let data: String
}

private struct PackageEndFixture: Encodable {
    let type: String
}
