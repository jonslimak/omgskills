import Foundation
import Observation

protocol GroupSnapshotInstalling: Sendable {
    func installGroupSnapshot(
        _ request: ManagedGroupSnapshotInstallRequest,
        credential: StoredDeviceCredential,
        packageLoader: any GroupSkillPackageLoading
    ) async throws -> ManagedGroupSnapshotInstallResult
}

extension ManagedSkillInstaller: GroupSnapshotInstalling {}

enum GroupSnapshotInstallTarget: String, CaseIterable, Hashable, Identifiable, Sendable {
    case claude
    case codex

    var id: String { rawValue }

    var title: String {
        switch self {
        case .claude: "Claude"
        case .codex: "Codex"
        }
    }

    func destination(homeDirectory: URL) -> ManagedGroupSnapshotDestination {
        let rootComponent: String
        let rootIdentifier: String
        let agent: ManagedSkillTargetAgent

        switch self {
        case .claude:
            rootComponent = ".claude/skills"
            rootIdentifier = "claude-user-global"
            agent = .claude
        case .codex:
            rootComponent = ".codex/skills"
            rootIdentifier = "codex-user-global"
            agent = .codex
        }

        return ManagedGroupSnapshotDestination(
            agent: agent,
            scope: .userGlobal,
            rootIdentifier: rootIdentifier,
            rootURL: homeDirectory
                .appendingPathComponent(rootComponent, isDirectory: true)
                .standardizedFileURL
        )
    }
}

struct GroupSnapshotInstallItem: Identifiable, Equatable, Sendable {
    enum Availability: Equatable, Sendable {
        case installable
        case metadataOnly(reason: String)
    }

    let id: String
    let name: String
    let description: String?
    let note: String?
    let position: Int
    let availability: Availability
}

struct GroupSnapshotInstallSummary: Equatable, Sendable {
    let installedCount: Int
    let updatedCount: Int
    let skippedCount: Int
}

struct GroupSnapshotInstallFailure: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case reconnectRequired
        case contentReadRequired
        case temporarilyUnavailable
        case packageUnavailable
        case installation
    }

    let kind: Kind
    let message: String

    var canRetry: Bool {
        switch kind {
        case .reconnectRequired, .contentReadRequired:
            false
        case .temporarilyUnavailable, .packageUnavailable, .installation:
            true
        }
    }
}

@MainActor
@Observable
final class GroupSnapshotInstallModel {
    enum Phase: Equatable, Sendable {
        case ready
        case installing
        case cancelling
        case success(GroupSnapshotInstallSummary)
        case failure(GroupSnapshotInstallFailure)
        case cancelled
    }

    let groupName: String
    let groupDescription: String?
    let groupRevision: Int
    let items: [GroupSnapshotInstallItem]

    var selectedTarget: GroupSnapshotInstallTarget?
    var acknowledgesMetadataOnly = false
    private(set) var phase: Phase = .ready

    @ObservationIgnored private let manifest: GroupManifest
    @ObservationIgnored private let route: DeviceGroupManifestRoute
    @ObservationIgnored private let credential: StoredDeviceCredential
    @ObservationIgnored private let installer: any GroupSnapshotInstalling
    @ObservationIgnored private let packageLoader: any GroupSkillPackageLoading
    @ObservationIgnored private let updateCoordinator: UpdateInstallCoordinator
    @ObservationIgnored private let homeDirectory: URL
    @ObservationIgnored private var activeTask: Task<Void, Never>?
    @ObservationIgnored private var activeAttemptID: UUID?

    init(
        manifest: GroupManifest,
        route: DeviceGroupManifestRoute,
        credential: StoredDeviceCredential,
        installer: any GroupSnapshotInstalling,
        packageLoader: any GroupSkillPackageLoading,
        updateCoordinator: UpdateInstallCoordinator,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) {
        self.manifest = manifest
        self.route = route
        self.credential = credential
        self.installer = installer
        self.packageLoader = packageLoader
        self.updateCoordinator = updateCoordinator
        self.homeDirectory = homeDirectory.standardizedFileURL
        groupName = manifest.group.name
        groupDescription = manifest.group.description
        groupRevision = manifest.group.revision
        items = manifest.items.map { item in
            GroupSnapshotInstallItem(
                id: item.id,
                name: item.name,
                description: item.description,
                note: item.note,
                position: item.position,
                availability: Self.presentationAvailability(for: item.installability)
            )
        }
    }

    var installableCount: Int {
        items.reduce(into: 0) { count, item in
            if case .installable = item.availability {
                count += 1
            }
        }
    }

    var metadataOnlyCount: Int {
        items.count - installableCount
    }

    var isOperationActive: Bool {
        switch phase {
        case .installing, .cancelling:
            true
        case .ready, .success, .failure, .cancelled:
            false
        }
    }

    var canInstall: Bool {
        guard phase == .ready,
              activeTask == nil,
              selectedTarget != nil,
              installableCount > 0 else {
            return false
        }
        return metadataOnlyCount == 0 || acknowledgesMetadataOnly
    }

    var canDismiss: Bool {
        !isOperationActive
    }

    @discardableResult
    func startInstall() -> Task<Void, Never>? {
        guard canInstall, let selectedTarget else { return nil }

        let request = ManagedGroupSnapshotInstallRequest(
            manifest: manifest,
            route: route,
            destination: selectedTarget.destination(homeDirectory: homeDirectory)
        )
        let attemptID = UUID()
        let activity = updateCoordinator.beginActivity(.skillInstall)
        let installer = installer
        let credential = credential
        let packageLoader = packageLoader

        activeAttemptID = attemptID
        phase = .installing

        let task = Task { @MainActor [weak self] in
            defer {
                activity.finish()
                self?.finishAttempt(attemptID)
            }

            do {
                let result = try await installer.installGroupSnapshot(
                    request,
                    credential: credential,
                    packageLoader: packageLoader
                )
                guard self?.activeAttemptID == attemptID else { return }
                self?.phase = .success(GroupSnapshotInstallSummary(
                    installedCount: result.installedCount,
                    updatedCount: result.updatedCount,
                    skippedCount: result.metadataOnlyItems.count
                ))
            } catch is CancellationError {
                guard self?.activeAttemptID == attemptID else { return }
                self?.phase = .cancelled
            } catch {
                guard self?.activeAttemptID == attemptID else { return }
                self?.phase = .failure(Self.failure(for: error))
            }
        }
        activeTask = task
        return task
    }

    func cancelInstall() {
        guard phase == .installing else { return }
        phase = .cancelling
        activeTask?.cancel()
    }

    @discardableResult
    func retryInstall() -> Task<Void, Never>? {
        guard !isOperationActive else { return nil }
        switch phase {
        case .failure(let failure) where failure.canRetry:
            phase = .ready
        case .cancelled:
            phase = .ready
        default:
            return nil
        }
        return startInstall()
    }

    private func finishAttempt(_ attemptID: UUID) {
        guard activeAttemptID == attemptID else { return }
        activeAttemptID = nil
        activeTask = nil
    }

    private static func presentationAvailability(
        for installability: GroupManifestInstallability
    ) -> GroupSnapshotInstallItem.Availability {
        switch installability {
        case .installable:
            .installable
        case .metadataOnly(let reason):
            .metadataOnly(reason: metadataOnlyMessage(for: reason))
        }
    }

    private static func metadataOnlyMessage(for reason: GroupManifestMetadataOnlyReason) -> String {
        switch reason {
        case .releaseUnavailable:
            "No published version is available."
        case .sourceUnavailable:
            "The skill source is unavailable."
        case .sourceMismatch:
            "The skill source no longer matches this group."
        case .incompleteRelease:
            "The published version is incomplete."
        case .invalidRelease:
            "The published version could not be verified."
        case .releaseSourceMismatch:
            "The published version does not match its source."
        case .syncedMissing:
            "The shared skill is no longer available."
        case .syncedLocalOnly:
            "This skill only exists on the owner's Mac."
        case .syncedAmbiguous:
            "This shared skill matches more than one source."
        case .syncedUnresolved:
            "This shared skill could not be matched to an installable source."
        }
    }

    private static func failure(for error: Error) -> GroupSnapshotInstallFailure {
        guard let loaderError = error as? GroupSkillPackageLoaderError else {
            return GroupSnapshotInstallFailure(
                kind: .installation,
                message: error.localizedDescription
            )
        }

        let message = loaderError.errorDescription ?? "The group could not be installed."
        let kind: GroupSnapshotInstallFailure.Kind = switch loaderError {
        case .reconnectRequired:
            .reconnectRequired
        case .contentReadRequired:
            .contentReadRequired
        case .rateLimited, .temporarilyUnavailable, .server:
            .temporarilyUnavailable
        case .metadataOnly, .catalogSkillUnavailable, .invalidCatalogRepository,
             .invalidPublicRepository, .repositoryUnavailable, .packageUnavailable,
             .responseTooLarge, .invalidResponse:
            .packageUnavailable
        }
        return GroupSnapshotInstallFailure(kind: kind, message: message)
    }
}
