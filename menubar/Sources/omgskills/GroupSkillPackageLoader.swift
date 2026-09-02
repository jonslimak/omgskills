import Foundation

enum GroupSkillPackageLoaderError: LocalizedError, Equatable, Sendable {
    case metadataOnly(GroupManifestMetadataOnlyReason)
    case catalogSkillUnavailable(String)
    case invalidCatalogRepository(String)
    case invalidPublicRepository(String)
    case repositoryUnavailable
    case packageUnavailable
    case contentReadRequired
    case reconnectRequired
    case rateLimited(retryAfter: String?)
    case temporarilyUnavailable(retryAfter: String?)
    case server(statusCode: Int)
    case responseTooLarge
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .metadataOnly:
            return "This group item contains information only and cannot be installed."
        case .catalogSkillUnavailable:
            return "This catalog skill is no longer available."
        case .invalidCatalogRepository, .invalidPublicRepository:
            return "This skill has an invalid GitHub repository."
        case .repositoryUnavailable:
            return "The GitHub repository or pinned release is unavailable."
        case .packageUnavailable:
            return "The pinned skill package could not be loaded."
        case .contentReadRequired:
            return "Reconnect this Mac and allow access to shared skill content."
        case .reconnectRequired:
            return "This Mac is no longer connected. Connect it again to load this skill."
        case .rateLimited:
            return "Too many requests. Wait briefly and try again."
        case .temporarilyUnavailable:
            return "Shared skill content is temporarily unavailable."
        case .server:
            return "The web portal could not load this skill. Try again shortly."
        case .responseTooLarge, .invalidResponse:
            return "The web portal returned an invalid skill package."
        }
    }
}

protocol GroupSkillPackageLoading: Sendable {
    func loadPackage(
        for item: GroupManifestItem,
        credential: StoredDeviceCredential
    ) async throws -> SkillPackage
}

protocol PublicSkillPackageFetching: Sendable {
    func fetchPackage(
        repositorySlug: String,
        normalizedRoot: String,
        expected: SkillPackageCoordinates
    ) async throws -> SkillPackage
}

protocol PrivateSkillPackageFetching: Sendable {
    func fetchPackage(
        sourceID: String,
        release: GroupManifestRelease,
        credential: StoredDeviceCredential
    ) async throws -> SkillPackage
}

struct CatalogSkillPackageIndex: Sendable {
    private enum Entry: Sendable {
        case repository(String)
        case invalid
    }

    private let entries: [String: Entry]

    init(skills: [Skill]) {
        var entries: [String: Entry] = [:]
        var duplicateIDs = Set<String>()
        for skill in skills {
            guard duplicateIDs.contains(skill.id) == false else { continue }
            if entries[skill.id] != nil {
                entries[skill.id] = .invalid
                duplicateIDs.insert(skill.id)
                continue
            }
            guard let repository = Self.githubRepository(from: skill.githubUrl),
                  Self.catalogRepository(from: skill.id)?.caseInsensitiveCompare(repository)
                    == .orderedSame else {
                entries[skill.id] = .invalid
                continue
            }
            entries[skill.id] = .repository(repository)
        }
        self.entries = entries
    }

    func repositorySlug(for catalogSkillID: String) throws -> String {
        guard let entry = entries[catalogSkillID] else {
            throw GroupSkillPackageLoaderError.catalogSkillUnavailable(catalogSkillID)
        }
        switch entry {
        case .repository(let repository):
            return repository
        case .invalid:
            throw GroupSkillPackageLoaderError.invalidCatalogRepository(catalogSkillID)
        }
    }

    private static func catalogRepository(from catalogSkillID: String) -> String? {
        guard let separator = catalogSkillID.firstIndex(of: ":") else { return nil }
        let value = String(catalogSkillID[..<separator])
        return GitHubRepositorySlug.normalized(value)
    }

    private static func githubRepository(from githubURL: String) -> String? {
        guard let components = URLComponents(string: githubURL),
              components.scheme?.lowercased() == "https",
              components.host?.lowercased() == "github.com",
              components.user == nil,
              components.password == nil,
              components.port == nil,
              components.query == nil,
              components.fragment == nil else {
            return nil
        }
        let parts = components.path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count >= 2 else { return nil }
        var repository = String(parts[1])
        if repository.lowercased().hasSuffix(".git") {
            repository.removeLast(4)
        }
        return GitHubRepositorySlug.normalized("\(parts[0])/\(repository)")
    }
}

struct GroupSkillPackageLoader: GroupSkillPackageLoading, Sendable {
    private let catalog: CatalogSkillPackageIndex
    private let publicFetcher: any PublicSkillPackageFetching
    private let privateFetcher: any PrivateSkillPackageFetching
    private let limits: SkillPackageValidationLimits

    init(
        catalog: CatalogSkillPackageIndex,
        publicFetcher: any PublicSkillPackageFetching = GitPublicSkillPackageFetcher(),
        privateFetcher: any PrivateSkillPackageFetching = DevicePrivateSkillPackageAPI(),
        limits: SkillPackageValidationLimits = .standard
    ) {
        self.catalog = catalog
        self.publicFetcher = publicFetcher
        self.privateFetcher = privateFetcher
        self.limits = limits
    }

    func loadPackage(
        for item: GroupManifestItem,
        credential: StoredDeviceCredential
    ) async throws -> SkillPackage {
        guard case .installable(let source, let release) = item.installability else {
            if case .metadataOnly(let reason) = item.installability {
                throw GroupSkillPackageLoaderError.metadataOnly(reason)
            }
            throw GroupSkillPackageLoaderError.invalidResponse
        }

        let package: SkillPackage
        switch source {
        case .catalog(_, let catalogSkillID, let normalizedRoot):
            package = try await publicFetcher.fetchPackage(
                repositorySlug: catalog.repositorySlug(for: catalogSkillID),
                normalizedRoot: normalizedRoot,
                expected: release.coordinates
            )
        case .publicGitHub(_, _, let repositorySlug, let normalizedRoot):
            guard let repository = GitHubRepositorySlug.normalized(repositorySlug) else {
                throw GroupSkillPackageLoaderError.invalidPublicRepository(repositorySlug)
            }
            package = try await publicFetcher.fetchPackage(
                repositorySlug: repository,
                normalizedRoot: normalizedRoot,
                expected: release.coordinates
            )
        case .privateGitHub(let sourceID):
            package = try await privateFetcher.fetchPackage(
                sourceID: sourceID,
                release: release,
                credential: credential
            )
        }

        try Task.checkCancellation()
        _ = try SkillPackageValidator.validate(package, expected: release.coordinates, limits: limits)
        return package
    }
}

enum GitHubRepositorySlug {
    static func normalized(_ value: String) -> String? {
        let parts = value.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2,
              isValidOwner(String(parts[0])),
              isValidRepository(String(parts[1])) else {
            return nil
        }
        return "\(parts[0])/\(parts[1])"
    }

    private static func isValidOwner(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 39,
              value.first != "-", value.last != "-" else { return false }
        return value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) ||
                (97...122).contains(byte) || byte == 45
        }
    }

    private static func isValidRepository(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 100, value != ".", value != ".." else {
            return false
        }
        return value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) ||
                (97...122).contains(byte) || byte == 45 || byte == 46 || byte == 95
        }
    }
}
