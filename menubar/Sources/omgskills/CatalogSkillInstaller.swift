import Foundation

protocol CatalogSkillInstalling: Sendable {
    func install(_ skill: Skill, target: SkillInstaller.Target) async throws
    func isInstalled(_ skill: Skill, target: SkillInstaller.Target) -> Bool
}

struct CatalogSkillInstaller: CatalogSkillInstalling {
    typealias LegacyInstall = @Sendable (Skill, SkillInstaller.Target) async throws -> Void
    typealias DestinationBuilder = @Sendable (SkillInstaller.Target, String) -> ManagedSkillDestination

    enum InstallError: LocalizedError, Equatable, Sendable {
        case invalidPinnedMetadata

        var errorDescription: String? {
            switch self {
            case .invalidPinnedMetadata:
                return "This skill has incomplete or invalid installation metadata"
            }
        }
    }

    private let packageFetcher: any PublicSkillPackageFetching
    private let managedInstaller: ManagedSkillInstaller
    private let legacyInstall: LegacyInstall
    private let destinationBuilder: DestinationBuilder
    private let filesystemPaths: SkillFilesystemPaths

    init(
        packageFetcher: any PublicSkillPackageFetching = GitPublicSkillPackageFetcher(),
        managedInstaller: ManagedSkillInstaller,
        filesystemPaths: SkillFilesystemPaths = .production(),
        legacyInstall: LegacyInstall? = nil,
        destinationBuilder: DestinationBuilder? = nil
    ) {
        self.packageFetcher = packageFetcher
        self.managedInstaller = managedInstaller
        self.filesystemPaths = filesystemPaths
        self.legacyInstall = legacyInstall ?? { skill, target in
            _ = try await SkillInstaller.install(
                skill,
                target: target,
                filesystemPaths: filesystemPaths
            )
        }
        self.destinationBuilder = destinationBuilder ?? { target, targetName in
            ManagedSkillDestination(
                agent: target.managedAgent,
                scope: .userGlobal,
                rootIdentifier: target.managedRootIdentifier,
                rootURL: filesystemPaths.skillsRoot(for: target),
                targetName: targetName
            )
        }
    }

    func install(_ skill: Skill, target: SkillInstaller.Target) async throws {
        switch skill.pinnedInstallMetadataState {
        case .legacy:
            try await legacyInstall(skill, target)
        case .invalid:
            throw InstallError.invalidPinnedMetadata
        case .complete(let metadata):
            let request = ManagedSkillInstallRequest(
                sourceKind: .catalog,
                sourceId: skill.id,
                releaseId: metadata.coordinates.commitSha,
                groupRevision: nil,
                catalogSkillId: skill.id,
                githubUrl: skill.githubUrl,
                expectedCoordinates: metadata.coordinates,
                mode: .snapshot,
                destination: destinationBuilder(target, metadata.targetName)
            )
            let packageFetcher = packageFetcher
            _ = try await managedInstaller.install(request) {
                try await packageFetcher.fetchPackage(
                    repositorySlug: metadata.repositorySlug,
                    normalizedRoot: metadata.packageRoot,
                    expected: metadata.coordinates
                )
            }
        }
    }

    func isInstalled(_ skill: Skill, target: SkillInstaller.Target) -> Bool {
        switch skill.pinnedInstallMetadataState {
        case .legacy:
            return SkillInstaller.isInstalled(
                skill,
                target: target,
                filesystemPaths: filesystemPaths
            )
        case .invalid:
            return false
        case .complete(let metadata):
            let destination = destinationBuilder(target, metadata.targetName)
            return FileManager.default.fileExists(
                atPath: destination.rootURL
                    .appendingPathComponent(destination.targetName, isDirectory: true)
                    .appendingPathComponent("SKILL.md", isDirectory: false)
                    .path
            )
        }
    }
}

private extension SkillInstaller.Target {
    var managedAgent: ManagedSkillTargetAgent {
        switch self {
        case .claude: return .claude
        case .codex: return .codex
        }
    }

    var managedRootIdentifier: String {
        switch self {
        case .claude: return "claude-user-global"
        case .codex: return "codex-user-global"
        }
    }
}
