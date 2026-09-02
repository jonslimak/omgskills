import Foundation

enum GroupManifestValidationError: Error, Equatable, Sendable {
    case unexpectedType(String)
    case unsupportedVersion(Int)
    case invalidField(String)
    case tooManyItems(Int)
    case duplicateItemID(String)
    case duplicatePosition(Int)
    case invalidPosition(expected: Int, actual: Int)
}

struct GroupManifest: Decodable, Equatable, Sendable {
    static let expectedType = "omgskills.skill_group"
    static let supportedVersion = 2
    static let maximumItemCount = 1_000

    let type: String
    let version: Int
    let group: GroupManifestGroup
    let items: [GroupManifestItem]

    private enum CodingKeys: String, CodingKey {
        case type
        case version
        case group
        case items
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(String.self, forKey: .type)
        version = try container.decode(Int.self, forKey: .version)
        group = try container.decode(GroupManifestGroup.self, forKey: .group)
        items = try container.decode([GroupManifestItem].self, forKey: .items)

        guard type == Self.expectedType else {
            throw GroupManifestValidationError.unexpectedType(type)
        }
        guard version == Self.supportedVersion else {
            throw GroupManifestValidationError.unsupportedVersion(version)
        }
        guard items.count <= Self.maximumItemCount else {
            throw GroupManifestValidationError.tooManyItems(items.count)
        }

        var itemIDs = Set<String>()
        var positions = Set<Int>()
        for (expectedPosition, item) in items.enumerated() {
            guard itemIDs.insert(item.id).inserted else {
                throw GroupManifestValidationError.duplicateItemID(item.id)
            }
            guard positions.insert(item.position).inserted else {
                throw GroupManifestValidationError.duplicatePosition(item.position)
            }
            guard item.position == expectedPosition else {
                throw GroupManifestValidationError.invalidPosition(
                    expected: expectedPosition,
                    actual: item.position
                )
            }
        }
    }
}

struct GroupManifestGroup: Decodable, Equatable, Sendable {
    let id: String
    let name: String
    let description: String?
    let slug: String
    let revision: Int

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case description
        case slug
        case revision
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try requireNormalizedText(container.decode(String.self, forKey: .id), field: "group.id")
        name = try requireNormalizedText(container.decode(String.self, forKey: .name), field: "group.name")
        description = try optionalNormalizedText(
            container.decodeIfPresent(String.self, forKey: .description),
            field: "group.description"
        )
        slug = try requireNormalizedText(container.decode(String.self, forKey: .slug), field: "group.slug")
        revision = try container.decode(Int.self, forKey: .revision)
        guard revision > 0 else {
            throw GroupManifestValidationError.invalidField("group.revision")
        }
    }
}

enum GroupManifestItemKind: String, Decodable, Equatable, Sendable {
    case catalog
    case github
    case synced
}

struct GroupManifestItem: Decodable, Equatable, Sendable {
    let id: String
    let kind: GroupManifestItemKind
    let position: Int
    let name: String
    let description: String?
    let note: String?
    let installability: GroupManifestInstallability

    private enum CodingKeys: String, CodingKey {
        case id
        case kind
        case position
        case name
        case description
        case note
        case installability
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try requireNormalizedText(container.decode(String.self, forKey: .id), field: "item.id")
        kind = try container.decode(GroupManifestItemKind.self, forKey: .kind)
        position = try container.decode(Int.self, forKey: .position)
        guard position >= 0 else {
            throw GroupManifestValidationError.invalidField("item.position")
        }
        name = try requireNormalizedText(container.decode(String.self, forKey: .name), field: "item.name")
        description = try optionalNormalizedText(
            container.decodeIfPresent(String.self, forKey: .description),
            field: "item.description"
        )
        note = try optionalNormalizedText(
            container.decodeIfPresent(String.self, forKey: .note),
            field: "item.note"
        )
        installability = try container.decode(GroupManifestInstallability.self, forKey: .installability)
    }
}

enum GroupManifestMetadataOnlyReason: String, Decodable, CaseIterable, Equatable, Sendable {
    case releaseUnavailable = "release_unavailable"
    case sourceUnavailable = "source_unavailable"
    case sourceMismatch = "source_mismatch"
    case incompleteRelease = "incomplete_release"
    case invalidRelease = "invalid_release"
    case releaseSourceMismatch = "release_source_mismatch"
    case syncedMissing = "synced_missing"
    case syncedLocalOnly = "synced_local_only"
    case syncedAmbiguous = "synced_ambiguous"
    case syncedUnresolved = "synced_unresolved"
}

enum GroupManifestInstallability: Decodable, Equatable, Sendable {
    case installable(source: GroupManifestSource, release: GroupManifestRelease)
    case metadataOnly(reason: GroupManifestMetadataOnlyReason)

    private enum Status: String, Decodable {
        case installable
        case metadataOnly = "metadata_only"
    }

    private enum CodingKeys: String, CodingKey {
        case status
        case source
        case release
        case reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Status.self, forKey: .status) {
        case .installable:
            self = .installable(
                source: try container.decode(GroupManifestSource.self, forKey: .source),
                release: try container.decode(GroupManifestRelease.self, forKey: .release)
            )
        case .metadataOnly:
            self = .metadataOnly(
                reason: try container.decode(GroupManifestMetadataOnlyReason.self, forKey: .reason)
            )
        }
    }
}

enum GroupManifestSource: Decodable, Equatable, Sendable {
    case catalog(id: String, catalogSkillID: String, normalizedRoot: String)
    case publicGitHub(id: String, repositoryID: String, repositorySlug: String, normalizedRoot: String)
    case privateGitHub(id: String)

    private enum Kind: String, Decodable {
        case catalog
        case publicGitHub = "public_github"
        case privateGitHub = "private_github"
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case kind
        case catalogSkillID = "catalogSkillId"
        case normalizedRoot
        case repositoryID = "repositoryId"
        case repositorySlug
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try requireNormalizedText(container.decode(String.self, forKey: .id), field: "source.id")
        switch try container.decode(Kind.self, forKey: .kind) {
        case .catalog:
            self = .catalog(
                id: id,
                catalogSkillID: try requireNormalizedText(
                    container.decode(String.self, forKey: .catalogSkillID),
                    field: "source.catalogSkillId"
                ),
                normalizedRoot: try requireNormalizedText(
                    container.decode(String.self, forKey: .normalizedRoot),
                    field: "source.normalizedRoot"
                )
            )
        case .publicGitHub:
            let repositoryID = try requireNormalizedText(
                container.decode(String.self, forKey: .repositoryID),
                field: "source.repositoryId"
            )
            guard repositoryID.allSatisfy(\.isNumber) else {
                throw GroupManifestValidationError.invalidField("source.repositoryId")
            }
            let repositorySlug = try requireNormalizedText(
                container.decode(String.self, forKey: .repositorySlug),
                field: "source.repositorySlug"
            )
            guard isRepositorySlug(repositorySlug) else {
                throw GroupManifestValidationError.invalidField("source.repositorySlug")
            }
            self = .publicGitHub(
                id: id,
                repositoryID: repositoryID,
                repositorySlug: repositorySlug,
                normalizedRoot: try requireNormalizedText(
                    container.decode(String.self, forKey: .normalizedRoot),
                    field: "source.normalizedRoot"
                )
            )
        case .privateGitHub:
            self = .privateGitHub(id: id)
        }
    }
}

struct GroupManifestRelease: Decodable, Equatable, Sendable {
    let id: String
    let commitSha: String
    let treeSha: String
    let skillMdSha: String

    var coordinates: SkillPackageCoordinates {
        SkillPackageCoordinates(
            commitSha: commitSha,
            treeSha: treeSha,
            skillMdSha: skillMdSha
        )
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case commitSha
        case treeSha
        case skillMdSha
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try requireNormalizedText(container.decode(String.self, forKey: .id), field: "release.id")
        commitSha = try requireGitSha(container.decode(String.self, forKey: .commitSha), field: "release.commitSha")
        treeSha = try requireGitSha(container.decode(String.self, forKey: .treeSha), field: "release.treeSha")
        skillMdSha = try requireGitSha(container.decode(String.self, forKey: .skillMdSha), field: "release.skillMdSha")
    }
}

enum DeviceGroupManifestRouteError: Error, Equatable, Sendable {
    case invalidHandle
    case invalidGroupSlug
}

struct DeviceGroupManifestRoute: Equatable, Sendable {
    let handle: String
    let groupSlug: String

    init(handle: String, groupSlug: String) throws {
        let normalizedHandle = handle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedSlug = groupSlug.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard isRouteSegment(normalizedHandle) else {
            throw DeviceGroupManifestRouteError.invalidHandle
        }
        guard isRouteSegment(normalizedSlug) else {
            throw DeviceGroupManifestRouteError.invalidGroupSlug
        }
        self.handle = normalizedHandle
        self.groupSlug = normalizedSlug
    }
}

private func requireNormalizedText(_ value: String, field: String) throws -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed == value else {
        throw GroupManifestValidationError.invalidField(field)
    }
    return value
}

private func optionalNormalizedText(_ value: String?, field: String) throws -> String? {
    guard let value else { return nil }
    return try requireNormalizedText(value, field: field)
}

private func requireGitSha(_ value: String, field: String) throws -> String {
    guard value.utf8.count == 40, value.utf8.allSatisfy({ byte in
        (48...57).contains(byte) || (65...70).contains(byte) || (97...102).contains(byte)
    }) else {
        throw GroupManifestValidationError.invalidField(field)
    }
    return value.lowercased()
}

private func isRepositorySlug(_ value: String) -> Bool {
    let parts = value.split(separator: "/", omittingEmptySubsequences: false)
    return parts.count == 2 && parts.allSatisfy { !$0.isEmpty }
}

private func isRouteSegment(_ value: String) -> Bool {
    guard !value.isEmpty, value.utf8.count <= 80 else { return false }
    return value.split(separator: "-", omittingEmptySubsequences: false).allSatisfy { part in
        !part.isEmpty && part.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (97...122).contains(byte)
        }
    }
}
