import CryptoKit
import Darwin
import Foundation

enum ManagedSkillSourceKind: String, Codable, Equatable, Sendable {
    case catalog
    case publicGitHub = "public_github"
    case privateGitHub = "private_github"
}

enum ManagedSkillTargetAgent: String, Codable, CaseIterable, Equatable, Sendable {
    case claude
    case codex
}

enum ManagedSkillTargetScope: String, Codable, Equatable, Sendable {
    case userGlobal = "user_global"
    case project
}

enum ManagedSkillInstallMode: String, Codable, Equatable, Sendable {
    case snapshot
    case subscribed
}

struct ManagedSkillDestination: Equatable, Sendable {
    let agent: ManagedSkillTargetAgent
    let scope: ManagedSkillTargetScope
    let rootIdentifier: String
    let rootURL: URL
    let targetName: String
}

struct ManagedSkillInstallRequest: Equatable, Sendable {
    let sourceKind: ManagedSkillSourceKind
    let sourceId: String
    let releaseId: String
    let groupId: String?
    let groupRoute: String?
    let groupName: String?
    let groupRevision: Int?
    let catalogSkillId: String?
    let githubUrl: String?
    let expectedCoordinates: SkillPackageCoordinates
    let mode: ManagedSkillInstallMode
    let destination: ManagedSkillDestination

    init(
        sourceKind: ManagedSkillSourceKind,
        sourceId: String,
        releaseId: String,
        groupId: String? = nil,
        groupRoute: String? = nil,
        groupName: String? = nil,
        groupRevision: Int?,
        catalogSkillId: String?,
        githubUrl: String?,
        expectedCoordinates: SkillPackageCoordinates,
        mode: ManagedSkillInstallMode,
        destination: ManagedSkillDestination
    ) {
        self.sourceKind = sourceKind
        self.sourceId = sourceId
        self.releaseId = releaseId
        self.groupId = groupId
        self.groupRoute = groupRoute
        self.groupName = groupName
        self.groupRevision = groupRevision
        self.catalogSkillId = catalogSkillId
        self.githubUrl = githubUrl
        self.expectedCoordinates = expectedCoordinates
        self.mode = mode
        self.destination = destination
    }
}

struct ManagedGroupSnapshotDestination: Equatable, Sendable {
    let agent: ManagedSkillTargetAgent
    let scope: ManagedSkillTargetScope
    let rootIdentifier: String
    let rootURL: URL
}

struct ManagedGroupSnapshotInstallRequest: Equatable, Sendable {
    let manifest: GroupManifest
    let route: DeviceGroupManifestRoute
    let destination: ManagedGroupSnapshotDestination
    let mode: ManagedSkillInstallMode

    init(
        manifest: GroupManifest,
        route: DeviceGroupManifestRoute,
        destination: ManagedGroupSnapshotDestination,
        mode: ManagedSkillInstallMode = .snapshot
    ) {
        self.manifest = manifest
        self.route = route
        self.destination = destination
        self.mode = mode
    }
}

struct ManagedGroupMetadataOnlyItem: Equatable, Sendable {
    let id: String
    let name: String
    let position: Int
    let reason: GroupManifestMetadataOnlyReason
}

struct ManagedGroupSnapshotInstallResult: Equatable, Sendable {
    let installedCount: Int
    let updatedCount: Int
    let removedCount: Int
    let metadataOnlyItems: [ManagedGroupMetadataOnlyItem]
    /// Items left alone because another install already uses their name.
    let alreadyPresentNames: [String]

    init(
        installedCount: Int,
        updatedCount: Int,
        removedCount: Int = 0,
        metadataOnlyItems: [ManagedGroupMetadataOnlyItem],
        alreadyPresentNames: [String] = []
    ) {
        self.installedCount = installedCount
        self.updatedCount = updatedCount
        self.removedCount = removedCount
        self.metadataOnlyItems = metadataOnlyItems
        self.alreadyPresentNames = alreadyPresentNames
    }
}

struct ManagedSkillCleanupReport: Equatable, Sendable {
    let removedActivations: Int
    let removedPackages: Int
}

private struct PlannedGroupItem: Sendable {
    let manifestItem: GroupManifestItem
    let installRequest: ManagedSkillInstallRequest
    let targetURL: URL
    let previousActivation: URL?
}

private struct GroupInstallPlan: Sendable {
    let installable: [PlannedGroupItem]
    let metadataOnly: [ManagedGroupMetadataOnlyItem]
    let alreadyPresent: [String]
    let alreadyPresentItemIDs: Set<String>
}

private struct StoredGroupItem: Sendable {
    let planned: PlannedGroupItem
    let packageContent: URL
}

private struct PreparedGroupItem: Sendable {
    let planned: PlannedGroupItem
    let activation: URL
}

private struct PlannedGroupRemoval: Sendable {
    let targetName: String
    let targetURL: URL
    let previousActivation: URL
}

private enum PreparedGroupMutation: Sendable {
    case replace(PreparedGroupItem)
    case remove(PlannedGroupRemoval)

    var targetName: String {
        switch self {
        case .replace(let item):
            item.planned.installRequest.destination.targetName
        case .remove(let item):
            item.targetName
        }
    }
}

private struct ManagedGroupTransactionJournal: Codable, Sendable {
    static let supportedVersion = 1

    let version: Int
    let transactionId: String
    let groupId: String
    let groupRoute: String
    let groupRevision: Int
    let targetAgent: String
    let targetScope: String
    let targetRootIdentifier: String
    let targetRootRelativePath: String
    let entries: [Entry]
    let subscription: Subscription?

    struct Entry: Codable, Sendable {
        enum Operation: String, Codable, Sendable {
            case replace
            case remove
        }

        let targetName: String
        let previousActivationRelativePath: String?
        let preparedActivationRelativePath: String?
        let operation: Operation?
    }

    struct Subscription: Codable, Sendable {
        let relativePath: String
        let previousData: Data?
        let replacementData: Data
    }
}

private struct JournalRecoveryEntry {
    let targetURL: URL
    let previousContent: URL?
    let operation: Operation

    enum Operation {
        case replace(preparedContent: URL)
        case remove
    }
}

actor ManagedSkillInstaller {
    enum InstallResult: Equatable, Sendable {
        case installed
        case updated
    }

    enum InstallError: LocalizedError, Equatable, Sendable {
        case invalidIdentifier
        case invalidTargetName
        case unmanagedTargetExists
        case targetOwnedByAnotherInstall
        case invalidStoredPackage
        case invalidManagedActivation
        case invalidGroupManifest
        case invalidTransactionJournal
        case subscriptionNotFound
        case subscriptionChanged
        case subscriptionHasLocalConflicts
        case operationInProgress
        case filesystemFailure(String)

        var errorDescription: String? {
            switch self {
            case .invalidIdentifier:
                return "Managed install has an invalid source, release, or destination identifier"
            case .invalidTargetName:
                return "Managed install target name is unsafe"
            case .unmanagedTargetExists:
                return "Install blocked because an unmanaged skill already uses this name"
            case .targetOwnedByAnotherInstall:
                return "Install blocked because another installation already uses this name"
            case .invalidStoredPackage:
                return "Stored package does not match its validated release"
            case .invalidManagedActivation:
                return "Managed installation state is incomplete or unsafe"
            case .invalidGroupManifest:
                return "This group cannot be installed safely"
            case .invalidTransactionJournal:
                return "A previous group installation cannot be recovered safely"
            case .subscriptionNotFound:
                return "This Skill Group subscription is no longer installed"
            case .subscriptionChanged:
                return "The installed Skill Group changed. Refresh it and try again"
            case .subscriptionHasLocalConflicts:
                return "Resolve the local skill changes before applying this group update"
            case .operationInProgress:
                return "Another managed installation is already in progress"
            case .filesystemFailure(let message):
                return message.isEmpty ? "Managed install failed" : message
            }
        }
    }

    typealias PackageLoader = @Sendable () async throws -> SkillPackage
    typealias BeforeActivationSwitch = @Sendable () throws -> Void
    typealias BeforeGroupActivationSwitch = @Sendable (Int, String) throws -> Void
    typealias BeforeSubscriptionWrite = @Sendable () throws -> Void

    private let managedRoot: URL
    private let pathAnchor: URL
    private let limits: SkillPackageValidationLimits
    private let beforeActivationSwitch: BeforeActivationSwitch
    private let beforeGroupActivationSwitch: BeforeGroupActivationSwitch
    private let beforeSubscriptionWrite: BeforeSubscriptionWrite
    private var mutationInProgress = false

    private struct PublicInstallBase: Equatable, Sendable {
        let targetLink: String
        let activation: URL
        let packageLink: String
        let provenanceData: Data
    }

    private struct PreparedPublicInstall: Sendable {
        let review: PublicSkillInstallReview
        let request: ManagedSkillInstallRequest
        let package: SkillPackage
        let base: PublicInstallBase?
    }

    private var preparedPublicInstall: PreparedPublicInstall?

    init(
        managedRoot: URL = ManagedSkillInstaller.defaultManagedRoot,
        pathAnchor: URL = FileManager.default.homeDirectoryForCurrentUser,
        limits: SkillPackageValidationLimits = .standard,
        beforeActivationSwitch: @escaping BeforeActivationSwitch = {},
        beforeGroupActivationSwitch: @escaping BeforeGroupActivationSwitch = { _, _ in },
        beforeSubscriptionWrite: @escaping BeforeSubscriptionWrite = {}
    ) {
        self.managedRoot = managedRoot
        self.pathAnchor = pathAnchor.standardizedFileURL
        self.limits = limits
        self.beforeActivationSwitch = beforeActivationSwitch
        self.beforeGroupActivationSwitch = beforeGroupActivationSwitch
        self.beforeSubscriptionWrite = beforeSubscriptionWrite
    }

    static var defaultManagedRoot: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("omgskills/managed", isDirectory: true)
    }

    func install(
        _ request: ManagedSkillInstallRequest,
        policy: SkillInstallPolicy = .existingBehavior,
        loadPackage: PackageLoader
    ) async throws -> InstallResult {
        try beginMutation()
        defer { endMutation() }
        if policy == .existingBehavior { try recoverPendingTransaction() }
        else if pathExists(journalURL, fileManager: .default) { throw InstallError.operationInProgress }
        try validate(request)
        if policy == .newOnly { try requireNewCatalogDestination(request) }

        let package = try await loadPackage()
        try Task.checkCancellation()
        _ = try SkillPackageValidator.validate(
            package,
            expected: request.expectedCoordinates,
            limits: limits
        )

        let packageContent = try storePackage(package, for: request)
        return try activate(packageContent: packageContent, request: request, policy: policy)
    }

    func recognizesCatalogInstall(_ request: ManagedSkillInstallRequest) throws -> Bool {
        let target = request.destination.rootURL.appendingPathComponent(request.destination.targetName)
        try requireDirectoryChain(request.destination.rootURL, under: pathAnchor)
        guard let activation = try existingManagedActivation(at: target, fileManager: .default),
              let data = try? Data(contentsOf: activation.appendingPathComponent("provenance.json")),
              let provenance = try? JSONDecoder().decode(SkillInstallProvenance.self, from: data) else { return false }
        let expectedParent = activationsRoot.appendingPathComponent(
            stableKey("\(request.destination.rootIdentifier):\(request.destination.targetName)"))
        return activation.deletingLastPathComponent() == expectedParent
            && provenance.catalogSkillId == request.catalogSkillId && provenance.githubUrl == request.githubUrl
            && provenance.sourceKind == ManagedSkillSourceKind.catalog.rawValue
            && provenance.sourceId == request.sourceId && provenance.groupId == nil
            && provenance.targetAgent == request.destination.agent.rawValue
            && provenance.targetScope == request.destination.scope.rawValue
            && provenance.targetRootIdentifier == request.destination.rootIdentifier
    }

    private func requireNewCatalogDestination(_ request: ManagedSkillInstallRequest) throws {
        try requireDirectoryChain(request.destination.rootURL, under: pathAnchor)
        try requireDirectoryChain(request.destination.rootURL.appendingPathComponent(".omgskills"), under: pathAnchor)
        try CatalogInstallFilesystem.requireVacant(root: request.destination.rootURL, name: request.destination.targetName)
    }

    func preparePublicInstall(
        _ source: PublicSkillInstallRequest,
        package: SkillPackage,
        filesystemPaths: SkillFilesystemPaths
    ) throws -> PublicSkillInstallReview {
        try beginMutation()
        defer { endMutation() }
        guard preparedPublicInstall == nil else { throw InstallError.operationInProgress }
        try Task.checkCancellation()
        guard filesystemPaths.homeDirectory.standardizedFileURL == pathAnchor else {
            throw PublicSkillReviewError.destinationConflict
        }
        if let commit = source.commitSha, commit != package.coordinates.commitSha.lowercased() {
            throw SkillPackageValidationError(code: .commitShaMismatch, path: nil)
        }
        _ = try SkillPackageValidator.validate(package, expected: package.coordinates, limits: limits)
        let request = ManagedSkillInstallRequest(
            sourceKind: .publicGitHub, sourceId: source.sourceID,
            releaseId: package.coordinates.commitSha.lowercased(),
            groupRevision: nil,
            catalogSkillId: source.catalogID, githubUrl: source.githubURL,
            expectedCoordinates: package.coordinates, mode: .snapshot,
            destination: ManagedSkillDestination(
                agent: .codex, scope: .userGlobal, rootIdentifier: "codex-user-global",
                rootURL: filesystemPaths.codexSkillsRoot, targetName: source.targetName
            )
        )
        try validate(request)
        let current = try publicInstallState(for: request)
        let action: PublicSkillInstallReview.Action = current.package == nil ? .install
            : current.package?.coordinates == package.coordinates ? .unchanged : .update
        let review = PublicSkillInstallReview(
            id: UUID(), action: action, source: source,
            destination: request.destination.rootURL.appendingPathComponent(source.targetName),
            fromCoordinates: current.package?.coordinates, toCoordinates: package.coordinates,
            changes: try PublicSkillPackageReview.changes(from: current.package, to: package)
        )
        preparedPublicInstall = PreparedPublicInstall(
            review: review, request: request, package: package, base: current.base
        )
        return review
    }

    func cancelPublicInstall(reviewID: UUID) {
        if preparedPublicInstall?.review.id == reviewID { preparedPublicInstall = nil }
    }

    func applyPublicInstall(reviewID: UUID) throws -> PublicSkillInstallReview.Action {
        try beginMutation()
        defer { endMutation() }
        guard let prepared = preparedPublicInstall, prepared.review.id == reviewID else {
            throw PublicSkillReviewError.staleReview
        }
        // A failed or completed apply needs a fresh review; never reuse stale consent.
        defer { preparedPublicInstall = nil }
        try Task.checkCancellation()
        guard try publicInstallState(for: prepared.request).base == prepared.base else {
            throw PublicSkillReviewError.staleReview
        }
        if prepared.review.action == .unchanged { return .unchanged }

        let content = try storePackage(prepared.package, for: prepared.request)
        let activation = try prepareActivation(packageContent: content, request: prepared.request)
        do {
            try beforeActivationSwitch()
            try Task.checkCancellation()
            guard try publicInstallState(for: prepared.request).base == prepared.base else {
                throw PublicSkillReviewError.staleReview
            }
            try switchTarget(
                prepared.review.destination,
                to: activation.appendingPathComponent("content", isDirectory: true)
            )
            return prepared.review.action
        } catch {
            try? FileManager.default.removeItem(at: activation)
            throw error
        }
    }

    func installGroupSnapshot(
        _ request: ManagedGroupSnapshotInstallRequest,
        credential: StoredDeviceCredential,
        packageLoader: any GroupSkillPackageLoading
    ) async throws -> ManagedGroupSnapshotInstallResult {
        try beginMutation()
        defer { endMutation() }
        try recoverPendingTransaction()

        let plan = try makeGroupPlan(request)
        return try await performGroupTransaction(
            request: request,
            plan: plan,
            removals: [],
            credential: credential,
            packageLoader: packageLoader
        )
    }

    func applyGroupSubscriptionUpdate(
        _ request: ManagedGroupSnapshotInstallRequest,
        credential: StoredDeviceCredential,
        packageLoader: any GroupSkillPackageLoading
    ) async throws -> ManagedGroupSnapshotInstallResult {
        try beginMutation()
        defer { endMutation() }
        try recoverPendingTransaction()
        guard request.mode == .subscribed,
              let baseline = try GroupSubscriptionStore.read(
                  groupId: request.manifest.group.id,
                  targetRoot: request.destination.rootURL
              ),
              let diff = try await detectGroupSubscription(
                  manifest: request.manifest,
                  route: request.route,
                  destination: request.destination
              )
        else {
            throw InstallError.subscriptionNotFound
        }
        guard diff.hasUpstreamChanges else {
            return ManagedGroupSnapshotInstallResult(
                installedCount: 0,
                updatedCount: 0,
                removedCount: 0,
                metadataOnlyItems: []
            )
        }
        guard !diff.hasBlockingLocalConflicts else {
            throw InstallError.subscriptionHasLocalConflicts
        }

        let packageItemIDs = Set(diff.changes.compactMap { change in
            switch change.packageAction {
            case .install, .update, .rename:
                change.id
            case .remove, .none:
                nil
            }
        })
        let baselineTargetKeys = Set<String>(baseline.items.compactMap { item in
            guard !item.isMetadataOnly && !item.isAlreadyInstalled else { return nil }
            return portableTargetKey(item.name)
        })
        let plan = try makeGroupPlan(
            request,
            installing: packageItemIDs,
            allowedExistingTargetKeys: baselineTargetKeys
        )
        let currentTargetKeys = Set<String>(request.manifest.items.compactMap { item in
            guard case .installable = item.installability else { return nil }
            return portableTargetKey(item.name)
        })
        let baselineByID = Dictionary(uniqueKeysWithValues: baseline.items.map { ($0.id, $0) })
        var removals: [PlannedGroupRemoval] = []
        for change in diff.changes where change.packageAction == .remove || change.packageAction == .rename {
            guard let previous = baselineByID[change.id],
                  !previous.isMetadataOnly,
                  !currentTargetKeys.contains(portableTargetKey(previous.name))
            else {
                continue
            }
            let targetURL = request.destination.rootURL.appendingPathComponent(
                previous.name,
                isDirectory: true
            )
            guard let activation = try existingManagedActivation(
                at: targetURL,
                fileManager: .default
            ) else {
                continue
            }
            removals.append(PlannedGroupRemoval(
                targetName: previous.name,
                targetURL: targetURL,
                previousActivation: activation
            ))
        }

        return try await performGroupTransaction(
            request: request,
            plan: plan,
            removals: removals,
            credential: credential,
            packageLoader: packageLoader,
            expectedInstalledRevision: diff.installedRevision
        )
    }

    private func performGroupTransaction(
        request: ManagedGroupSnapshotInstallRequest,
        plan: GroupInstallPlan,
        removals: [PlannedGroupRemoval],
        credential: StoredDeviceCredential,
        packageLoader: any GroupSkillPackageLoading,
        expectedInstalledRevision: Int? = nil
    ) async throws -> ManagedGroupSnapshotInstallResult {
        var stored: [StoredGroupItem] = []
        stored.reserveCapacity(plan.installable.count)
        for item in plan.installable {
            try Task.checkCancellation()
            let package = try await packageLoader.loadPackage(
                for: item.manifestItem,
                credential: credential
            )
            try Task.checkCancellation()
            _ = try SkillPackageValidator.validate(
                package,
                expected: item.installRequest.expectedCoordinates,
                limits: limits
            )
            let packageContent = try storePackage(package, for: item.installRequest)
            stored.append(StoredGroupItem(planned: item, packageContent: packageContent))
        }

        try Task.checkCancellation()
        if let expectedInstalledRevision {
            guard let latestDiff = try await detectGroupSubscription(
                manifest: request.manifest,
                route: request.route,
                destination: request.destination
            ), latestDiff.installedRevision == expectedInstalledRevision else {
                throw InstallError.subscriptionChanged
            }
            guard !latestDiff.hasBlockingLocalConflicts else {
                throw InstallError.subscriptionHasLocalConflicts
            }
        }
        let prepared = try stored.map { item in
            let current = try existingManagedActivation(
                at: item.planned.targetURL,
                fileManager: .default
            )
            guard current == item.planned.previousActivation else {
                throw InstallError.invalidManagedActivation
            }
            return PreparedGroupItem(
                planned: item.planned,
                activation: try prepareActivation(
                    packageContent: item.packageContent,
                    request: item.planned.installRequest
                )
            )
        }

        let mutations = prepared.map(PreparedGroupMutation.replace)
            + removals.map(PreparedGroupMutation.remove)
        guard !mutations.isEmpty || request.mode == .subscribed else {
            return ManagedGroupSnapshotInstallResult(
                installedCount: 0,
                updatedCount: 0,
                removedCount: 0,
                metadataOnlyItems: plan.metadataOnly,
                alreadyPresentNames: plan.alreadyPresent
            )
        }

        let journal = try makeJournal(for: request, mutations: mutations, skipping: plan.alreadyPresentItemIDs)
        try writeJournal(journal)
        do {
            for (index, mutation) in mutations.enumerated() {
                try Task.checkCancellation()
                try beforeGroupActivationSwitch(index, mutation.targetName)
                switch mutation {
                case .replace(let item):
                    try switchTarget(
                        item.planned.targetURL,
                        to: item.activation.appendingPathComponent("content", isDirectory: true)
                    )
                case .remove(let item):
                    let current = try existingManagedActivation(
                        at: item.targetURL,
                        fileManager: .default
                    )
                    guard current == item.previousActivation else {
                        throw InstallError.invalidManagedActivation
                    }
                    try FileManager.default.removeItem(at: item.targetURL)
                }
            }
            if let subscription = journal.subscription {
                try beforeSubscriptionWrite()
                let subscriptionURL = request.destination.rootURL
                    .appendingPathComponent(subscription.relativePath)
                try GroupSubscriptionStore.write(
                    subscription.replacementData,
                    to: subscriptionURL
                )
            }
            try removeJournal()
        } catch {
            do {
                try recoverPendingTransaction()
            } catch {
                throw InstallError.invalidTransactionJournal
            }
            throw error
        }

        return ManagedGroupSnapshotInstallResult(
            installedCount: prepared.filter { $0.planned.previousActivation == nil }.count,
            updatedCount: prepared.filter { $0.planned.previousActivation != nil }.count,
            removedCount: removals.count,
            metadataOnlyItems: plan.metadataOnly,
            alreadyPresentNames: plan.alreadyPresent
        )
    }

    func cleanup(targetRoots: [URL]) throws -> ManagedSkillCleanupReport {
        try beginMutation()
        defer { endMutation() }
        try recoverPendingTransaction()
        let fileManager = FileManager.default
        let activationRoot = activationsRoot
        let packageRoot = packagesRoot
        var activeActivations = Set<String>()
        var activePackages = Set<String>()

        for targetRoot in targetRoots {
            guard pathExists(targetRoot, fileManager: fileManager) else { continue }
            let targets: [URL]
            do {
                targets = try fileManager.contentsOfDirectory(
                    at: targetRoot,
                    includingPropertiesForKeys: [.isSymbolicLinkKey],
                    options: [.skipsHiddenFiles]
                )
            } catch {
                throw InstallError.filesystemFailure(error.localizedDescription)
            }

            for target in targets {
                guard let destination = symlinkDestination(of: target, fileManager: fileManager) else {
                    continue
                }
                guard isDescendant(destination, of: managedRoot) else { continue }
                guard destination.lastPathComponent == "content",
                      isDescendant(destination, of: activationRoot)
                else {
                    throw InstallError.invalidManagedActivation
                }
                let activation = destination.deletingLastPathComponent().standardizedFileURL
                let provenanceURL = activation.appendingPathComponent("provenance.json")
                guard let data = try? Data(contentsOf: provenanceURL),
                      (try? JSONDecoder().decode(SkillInstallProvenance.self, from: data)) != nil,
                      let packageContent = symlinkDestination(
                        of: activation.appendingPathComponent("content"),
                        fileManager: fileManager
                      ),
                      packageContent.lastPathComponent == "content",
                      isDescendant(packageContent, of: packageRoot)
                else {
                    throw InstallError.invalidManagedActivation
                }
                activeActivations.insert(activation.path)
                activePackages.insert(packageContent.deletingLastPathComponent().standardizedFileURL.path)
            }
        }

        var removedActivations = 0
        for activation in try leafDirectories(twoLevelsBelow: activationRoot, fileManager: fileManager) {
            guard !activeActivations.contains(activation.standardizedFileURL.path) else { continue }
            try fileManager.removeItem(at: activation)
            removedActivations += 1
        }

        var removedPackages = 0
        for package in try leafDirectories(twoLevelsBelow: packageRoot, fileManager: fileManager) {
            guard !activePackages.contains(package.standardizedFileURL.path) else { continue }
            try makePackageRemovable(package, fileManager: fileManager)
            try fileManager.removeItem(at: package)
            removedPackages += 1
        }
        try removeEmptyChildren(of: activationRoot, fileManager: fileManager)
        try removeEmptyChildren(of: packageRoot, fileManager: fileManager)

        return ManagedSkillCleanupReport(
            removedActivations: removedActivations,
            removedPackages: removedPackages
        )
    }

    func managedPackageContentURL(at targetURL: URL) throws -> URL? {
        guard let activation = try existingManagedActivation(
            at: targetURL,
            fileManager: .default
        ),
              let packageContent = symlinkDestination(
                  of: activation.appendingPathComponent("content", isDirectory: true),
                  fileManager: .default
              )
        else {
            return nil
        }
        return packageContent
    }

    private func beginMutation() throws {
        guard !mutationInProgress else {
            throw InstallError.operationInProgress
        }
        mutationInProgress = true
    }

    private func endMutation() {
        mutationInProgress = false
    }

    private func publicInstallState(
        for request: ManagedSkillInstallRequest
    ) throws -> (base: PublicInstallBase?, package: SkillPackage?) {
        // Reviews are read-only. A pending group recovery must be handled by its owner.
        guard !pathExists(journalURL, fileManager: .default) else {
            throw InstallError.invalidTransactionJournal
        }
        let destination = request.destination
        let otherRoot = pathAnchor.appendingPathComponent(".agents/skills", isDirectory: true)
        try requireDirectoryChain(destination.rootURL, under: pathAnchor)
        try requireDirectoryChain(otherRoot, under: pathAnchor)
        let alternate = otherRoot.appendingPathComponent(destination.targetName)
        let legacyRecord = SkillInstallProvenanceStore.metadataURL(
            targetRoot: destination.rootURL, targetName: destination.targetName
        )
        guard !pathExists(alternate, fileManager: .default),
              !pathExists(legacyRecord, fileManager: .default) else {
            throw PublicSkillReviewError.destinationConflict
        }
        let activationParent = activationsRoot.appendingPathComponent(
            stableKey("\(destination.rootIdentifier):\(destination.targetName)"), isDirectory: true
        )
        try requireDirectoryChain(activationParent, under: managedRoot)
        try requireDirectoryChain(packageRoot(for: request), under: managedRoot)
        try requireDirectoryChain(stagingRoot, under: managedRoot)

        let target = destination.rootURL.appendingPathComponent(destination.targetName)
        guard let activation = try existingManagedActivation(at: target, fileManager: .default) else {
            return (nil, nil)
        }
        guard activation.deletingLastPathComponent() == activationParent else {
            throw PublicSkillReviewError.ownershipConflict
        }
        try requireDirectoryChain(activation, under: managedRoot)
        let provenanceURL = activation.appendingPathComponent("provenance.json")
        let attributes = try FileManager.default.attributesOfItem(atPath: provenanceURL.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber, size.intValue <= 64 * 1024 else {
            throw InstallError.invalidManagedActivation
        }
        let provenanceData = try Data(contentsOf: provenanceURL)
        let provenance = try JSONDecoder().decode(SkillInstallProvenance.self, from: provenanceData)
        guard provenance.sourceKind == request.sourceKind.rawValue,
              provenance.sourceId == request.sourceId,
              provenance.groupId == nil, provenance.groupRoute == nil, provenance.groupRevision == nil,
              provenance.targetAgent == destination.agent.rawValue,
              provenance.targetScope == destination.scope.rawValue,
              provenance.targetRootIdentifier == destination.rootIdentifier,
              provenance.installMode == ManagedSkillInstallMode.snapshot.rawValue,
              let commit = provenance.commitSha, provenance.releaseId == commit,
              let tree = provenance.treeSha, let skillMD = provenance.skillMdSha else {
            throw PublicSkillReviewError.ownershipConflict
        }
        let content = packagesRoot.appendingPathComponent(stableKey(request.sourceId))
            .appendingPathComponent(stableKey(commit)).appendingPathComponent("content", isDirectory: true)
        guard symlinkDestination(of: activation.appendingPathComponent("content"), fileManager: .default) == content else {
            throw PublicSkillReviewError.ownershipConflict
        }
        try requireDirectoryChain(content, under: managedRoot)
        let coordinates = SkillPackageCoordinates(commitSha: commit, treeSha: tree, skillMdSha: skillMD)
        let package: SkillPackage
        do {
            package = try readPackage(from: content, coordinates: coordinates)
            _ = try SkillPackageValidator.validate(package, expected: coordinates, limits: limits)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw PublicSkillReviewError.localChanges
        }
        return (PublicInstallBase(
            targetLink: try FileManager.default.destinationOfSymbolicLink(atPath: target.path),
            activation: activation,
            packageLink: try FileManager.default.destinationOfSymbolicLink(atPath: activation.appendingPathComponent("content").path),
            provenanceData: provenanceData
        ), package)
    }

    private func requireDirectoryChain(_ url: URL, under anchor: URL) throws {
        guard let relative = relativePath(of: url, under: anchor) else {
            throw PublicSkillReviewError.destinationConflict
        }
        var current = anchor
        let parts = relative == "." ? [] : relative.split(separator: "/").map(String.init)
        for part in [""] + parts {
            if !part.isEmpty { current.appendPathComponent(part, isDirectory: true) }
            if pathExists(current, fileManager: .default) {
                let attributes = try FileManager.default.attributesOfItem(atPath: current.path)
                guard attributes[.type] as? FileAttributeType == .typeDirectory else {
                    throw PublicSkillReviewError.destinationConflict
                }
            }
        }
    }

    private func makeGroupPlan(
        _ request: ManagedGroupSnapshotInstallRequest,
        installing itemIDs: Set<String>? = nil,
        allowedExistingTargetKeys: Set<String>? = nil
    ) throws -> GroupInstallPlan {
        let manifest = request.manifest
        let destination = request.destination
        guard manifest.group.slug == request.route.groupSlug,
              destination.scope == .userGlobal,
              destination.rootIdentifier.range(
                of: "^[a-z0-9][a-z0-9._-]{0,127}$",
                options: .regularExpression
              ) != nil,
              relativePath(of: destination.rootURL, under: pathAnchor) != nil
        else {
            throw InstallError.invalidGroupManifest
        }

        let groupRoute = "/u/\(request.route.handle)/sets/\(request.route.groupSlug)"
        var installable: [PlannedGroupItem] = []
        var metadataOnly: [ManagedGroupMetadataOnlyItem] = []
        var alreadyPresent: [String] = []
        var alreadyPresentItemIDs = Set<String>()
        var targetKeys = Set<String>()

        for item in manifest.items {
            switch item.installability {
            case .metadataOnly(let reason):
                metadataOnly.append(ManagedGroupMetadataOnlyItem(
                    id: item.id,
                    name: item.name,
                    position: item.position,
                    reason: reason
                ))
            case .installable(let source, let release):
                let sourceValues = try managedSourceValues(for: item, source: source)
                try validateTargetName(item.name)
                let collisionKey = portableTargetKey(item.name)
                let skipsOccupiedTargets = allowedExistingTargetKeys?.contains(collisionKey) != true
                guard targetKeys.insert(collisionKey).inserted else {
                    throw InstallError.invalidGroupManifest
                }
                guard itemIDs?.contains(item.id) ?? true else { continue }
                let installRequest = ManagedSkillInstallRequest(
                    sourceKind: sourceValues.kind,
                    sourceId: sourceValues.id,
                    releaseId: release.id,
                    groupId: manifest.group.id,
                    groupRoute: groupRoute,
                    groupName: manifest.group.name,
                    groupRevision: manifest.group.revision,
                    catalogSkillId: sourceValues.catalogSkillId,
                    githubUrl: sourceValues.githubUrl,
                    expectedCoordinates: release.coordinates,
                    mode: request.mode,
                    destination: ManagedSkillDestination(
                        agent: destination.agent,
                        scope: destination.scope,
                        rootIdentifier: destination.rootIdentifier,
                        rootURL: destination.rootURL,
                        targetName: item.name
                    )
                )
                try validate(installRequest)
                let targetURL = destination.rootURL.appendingPathComponent(
                    item.name,
                    isDirectory: true
                )
                let previousActivation: URL?
                do {
                    previousActivation = try existingManagedActivation(at: targetURL, fileManager: .default)
                } catch InstallError.unmanagedTargetExists where skipsOccupiedTargets {
                    alreadyPresent.append(item.name)
                    alreadyPresentItemIDs.insert(item.id)
                    continue
                }
                if previousActivation != nil,
                   let allowedExistingTargetKeys,
                   !allowedExistingTargetKeys.contains(collisionKey) {
                    alreadyPresent.append(item.name)
                    alreadyPresentItemIDs.insert(item.id)
                    continue
                }
                // A first install may replace only this Set's own skills, never a single install or another Set's.
                if let previousActivation, allowedExistingTargetKeys == nil,
                   activationGroupId(previousActivation) != manifest.group.id {
                    guard skipsOccupiedTargets else { throw InstallError.targetOwnedByAnotherInstall }
                    alreadyPresent.append(item.name)
                    alreadyPresentItemIDs.insert(item.id)
                    continue
                }
                installable.append(PlannedGroupItem(
                    manifestItem: item,
                    installRequest: installRequest,
                    targetURL: targetURL,
                    previousActivation: previousActivation
                ))
            }
        }

        return GroupInstallPlan(installable: installable, metadataOnly: metadataOnly,
                              alreadyPresent: alreadyPresent, alreadyPresentItemIDs: alreadyPresentItemIDs)
    }

    private func managedSourceValues(
        for item: GroupManifestItem,
        source: GroupManifestSource
    ) throws -> (
        kind: ManagedSkillSourceKind,
        id: String,
        catalogSkillId: String?,
        githubUrl: String?
    ) {
        switch source {
        case .catalog(let id, let catalogSkillID, _):
            guard item.kind == .catalog || item.kind == .synced,
                  let repository = CatalogSkillID.repositorySlug(from: catalogSkillID)
            else {
                throw InstallError.invalidGroupManifest
            }
            return (.catalog, id, catalogSkillID, "https://github.com/\(repository)")
        case .publicGitHub(let id, _, let repositorySlug, _):
            guard item.kind == .github || item.kind == .synced,
                  let repository = GitHubRepositorySlug.normalized(repositorySlug)
            else {
                throw InstallError.invalidGroupManifest
            }
            return (.publicGitHub, id, nil, "https://github.com/\(repository)")
        case .privateGitHub(let id):
            guard item.kind == .github || item.kind == .synced else {
                throw InstallError.invalidGroupManifest
            }
            return (.privateGitHub, id, nil, nil)
        }
    }

    private func makeJournal(
        for request: ManagedGroupSnapshotInstallRequest,
        mutations: [PreparedGroupMutation],
        skipping itemIDs: Set<String>
    ) throws -> ManagedGroupTransactionJournal {
        guard let targetRootRelativePath = relativePath(
            of: request.destination.rootURL,
            under: pathAnchor
        ) else {
            throw InstallError.invalidGroupManifest
        }
        let entries = try mutations.map { mutation in
            switch mutation {
            case .replace(let item):
                guard let preparedPath = relativePath(of: item.activation, under: managedRoot)
                else {
                    throw InstallError.invalidManagedActivation
                }
                let previousPath = try item.planned.previousActivation.map { activation in
                    guard let path = relativePath(of: activation, under: managedRoot) else {
                        throw InstallError.invalidManagedActivation
                    }
                    return path
                }
                return ManagedGroupTransactionJournal.Entry(
                    targetName: item.planned.installRequest.destination.targetName,
                    previousActivationRelativePath: previousPath,
                    preparedActivationRelativePath: preparedPath,
                    operation: .replace
                )
            case .remove(let item):
                guard let previousPath = relativePath(
                    of: item.previousActivation,
                    under: managedRoot
                ) else {
                    throw InstallError.invalidManagedActivation
                }
                return ManagedGroupTransactionJournal.Entry(
                    targetName: item.targetName,
                    previousActivationRelativePath: previousPath,
                    preparedActivationRelativePath: nil,
                    operation: .remove
                )
            }
        }
        let subscription = try makeSubscriptionMutation(for: request, skipping: itemIDs)
        return ManagedGroupTransactionJournal(
            version: ManagedGroupTransactionJournal.supportedVersion,
            transactionId: UUID().uuidString.lowercased(),
            groupId: request.manifest.group.id,
            groupRoute: "/u/\(request.route.handle)/sets/\(request.route.groupSlug)",
            groupRevision: request.manifest.group.revision,
            targetAgent: request.destination.agent.rawValue,
            targetScope: request.destination.scope.rawValue,
            targetRootIdentifier: request.destination.rootIdentifier,
            targetRootRelativePath: targetRootRelativePath,
            entries: entries,
            subscription: subscription
        )
    }

    private func makeSubscriptionMutation(
        for request: ManagedGroupSnapshotInstallRequest,
        skipping itemIDs: Set<String>
    ) throws -> ManagedGroupTransactionJournal.Subscription? {
        guard request.mode == .subscribed else { return nil }
        let previous = try GroupSubscriptionStore.read(
            groupId: request.manifest.group.id, targetRoot: request.destination.rootURL)
        let skipped = itemIDs.union(previous?.items.filter(\.isAlreadyInstalled).map(\.id) ?? [])
        let record = try GroupSubscriptionRecord.make(
            manifest: request.manifest,
            route: request.route,
            destination: request.destination,
            skipping: skipped
        )
        let replacementData = try GroupSubscriptionStore.encode(record)
        let url = GroupSubscriptionStore.recordURL(
            groupId: request.manifest.group.id,
            targetRoot: request.destination.rootURL
        )
        guard let relativePath = relativePath(of: url, under: request.destination.rootURL),
              relativePath.hasPrefix(".omgskills/groups/")
        else {
            throw InstallError.invalidGroupManifest
        }

        let previousData: Data?
        if let previous {
            guard previous.groupId == record.groupId,
                  previous.targetAgent == record.targetAgent,
                  previous.targetScope == record.targetScope,
                  previous.targetRootIdentifier == record.targetRootIdentifier
            else {
                throw InstallError.invalidGroupManifest
            }
            previousData = try Data(contentsOf: url)
        } else {
            previousData = nil
        }
        return ManagedGroupTransactionJournal.Subscription(
            relativePath: relativePath,
            previousData: previousData,
            replacementData: replacementData
        )
    }

    private func writeJournal(_ journal: ManagedGroupTransactionJournal) throws {
        let fileManager = FileManager.default
        guard !pathExists(journalURL, fileManager: fileManager) else {
            throw InstallError.invalidTransactionJournal
        }
        try fileManager.createDirectory(
            at: transactionsRoot,
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(journal).write(to: journalURL, options: .atomic)
    }

    private func removeJournal() throws {
        let fileManager = FileManager.default
        guard pathExists(journalURL, fileManager: fileManager) else { return }
        try fileManager.removeItem(at: journalURL)
        if (try? fileManager.contentsOfDirectory(atPath: transactionsRoot.path).isEmpty) == true {
            try? fileManager.removeItem(at: transactionsRoot)
        }
    }

    private func recoverPendingTransaction() throws {
        let fileManager = FileManager.default
        guard pathExists(journalURL, fileManager: fileManager) else { return }
        guard let values = try? journalURL.resourceValues(
                  forKeys: [.isRegularFileKey, .isSymbolicLinkKey]
              ),
              values.isRegularFile == true,
              values.isSymbolicLink != true,
              let attributes = try? fileManager.attributesOfItem(atPath: journalURL.path),
              let size = (attributes[.size] as? NSNumber)?.intValue,
              size <= 3_145_728,
              let data = try? Data(contentsOf: journalURL),
              let journal = try? JSONDecoder().decode(
                ManagedGroupTransactionJournal.self,
                from: data
              ),
              journal.version == ManagedGroupTransactionJournal.supportedVersion,
              journal.groupRevision > 0,
              UUID(uuidString: journal.transactionId) != nil,
              UUID(uuidString: journal.groupId) != nil,
              isCanonicalGroupRoute(journal.groupRoute),
              ManagedSkillTargetAgent(rawValue: journal.targetAgent) != nil,
              journal.targetScope == ManagedSkillTargetScope.userGlobal.rawValue,
              journal.targetRootIdentifier.range(
                of: "^[a-z0-9][a-z0-9._-]{0,127}$",
                options: .regularExpression
              ) != nil,
              (!journal.entries.isEmpty || journal.subscription != nil),
              journal.entries.count <= GroupManifest.maximumItemCount * 2,
              let targetRoot = resolveRelativePath(
                journal.targetRootRelativePath,
                under: pathAnchor
              )
        else {
            throw InstallError.invalidTransactionJournal
        }

        let subscriptionRecovery = try validateSubscriptionRecovery(
            journal.subscription,
            journal: journal,
            targetRoot: targetRoot,
            fileManager: fileManager
        )

        var targetKeys = Set<String>()
        var recoveryEntries: [JournalRecoveryEntry] = []
        recoveryEntries.reserveCapacity(journal.entries.count)
        for entry in journal.entries {
            try validateTargetName(entry.targetName)
            let key = portableTargetKey(entry.targetName)
            guard targetKeys.insert(key).inserted else {
                throw InstallError.invalidTransactionJournal
            }
            let previousActivation = try entry.previousActivationRelativePath.map { path in
                guard let activation = resolveActivationPath(path) else {
                    throw InstallError.invalidTransactionJournal
                }
                return activation
            }
            let targetURL = targetRoot.appendingPathComponent(entry.targetName, isDirectory: true)
            let previousContent = previousActivation?.appendingPathComponent(
                "content",
                isDirectory: true
            )
            let current = symlinkDestination(of: targetURL, fileManager: fileManager)
            let operation = entry.operation ?? .replace
            switch operation {
            case .replace:
                guard let preparedPath = entry.preparedActivationRelativePath,
                      let preparedActivation = resolveActivationPath(preparedPath)
                else {
                    throw InstallError.invalidTransactionJournal
                }
                let preparedContent = preparedActivation.appendingPathComponent(
                    "content",
                    isDirectory: true
                )
                if previousContent == nil {
                    guard !pathExists(targetURL, fileManager: fileManager)
                            || current == preparedContent
                    else {
                        throw InstallError.invalidTransactionJournal
                    }
                } else if current != previousContent && current != preparedContent {
                    throw InstallError.invalidTransactionJournal
                }
                recoveryEntries.append(JournalRecoveryEntry(
                    targetURL: targetURL,
                    previousContent: previousContent,
                    operation: .replace(preparedContent: preparedContent)
                ))
            case .remove:
                guard entry.preparedActivationRelativePath == nil,
                      let previousContent
                else {
                    throw InstallError.invalidTransactionJournal
                }
                if pathExists(targetURL, fileManager: fileManager), current != previousContent {
                    throw InstallError.invalidTransactionJournal
                }
                recoveryEntries.append(JournalRecoveryEntry(
                    targetURL: targetURL,
                    previousContent: previousContent,
                    operation: .remove
                ))
            }
        }

        for entry in recoveryEntries.reversed() {
            let current = symlinkDestination(of: entry.targetURL, fileManager: fileManager)
            switch entry.operation {
            case .replace(let preparedContent):
                if let previousContent = entry.previousContent {
                    guard current == previousContent || current == preparedContent else {
                        throw InstallError.invalidTransactionJournal
                    }
                    if current != previousContent {
                        try switchTarget(entry.targetURL, to: previousContent)
                    }
                } else if pathExists(entry.targetURL, fileManager: fileManager) {
                    guard current == preparedContent else {
                        throw InstallError.invalidTransactionJournal
                    }
                    try fileManager.removeItem(at: entry.targetURL)
                }
            case .remove:
                guard let previousContent = entry.previousContent else {
                    throw InstallError.invalidTransactionJournal
                }
                if pathExists(entry.targetURL, fileManager: fileManager) {
                    guard current == previousContent else {
                        throw InstallError.invalidTransactionJournal
                    }
                } else {
                    try switchTarget(entry.targetURL, to: previousContent)
                }
            }
        }
        if let subscriptionRecovery {
            if let previousData = subscriptionRecovery.previousData {
                try GroupSubscriptionStore.write(previousData, to: subscriptionRecovery.url)
            } else if pathExists(subscriptionRecovery.url, fileManager: fileManager) {
                try fileManager.removeItem(at: subscriptionRecovery.url)
            }
        }
        try removeJournal()
    }

    private func validateSubscriptionRecovery(
        _ subscription: ManagedGroupTransactionJournal.Subscription?,
        journal: ManagedGroupTransactionJournal,
        targetRoot: URL,
        fileManager: FileManager
    ) throws -> (url: URL, previousData: Data?)? {
        guard let subscription else { return nil }
        guard let url = resolveRelativePath(subscription.relativePath, under: targetRoot),
              subscription.relativePath.hasPrefix(".omgskills/groups/"),
              url == GroupSubscriptionStore.recordURL(
                  groupId: journal.groupId,
                  targetRoot: targetRoot
              )
        else {
            throw InstallError.invalidTransactionJournal
        }

        let replacement = try decodeJournalSubscription(subscription.replacementData)
        guard replacement.groupId == journal.groupId,
              replacement.groupRoute == journal.groupRoute,
              replacement.groupRevision == journal.groupRevision,
              replacement.targetAgent == journal.targetAgent,
              replacement.targetScope == journal.targetScope,
              replacement.targetRootIdentifier == journal.targetRootIdentifier
        else {
            throw InstallError.invalidTransactionJournal
        }
        if let previousData = subscription.previousData {
            let previous = try decodeJournalSubscription(previousData)
            guard previous.groupId == journal.groupId,
                  previous.targetAgent == journal.targetAgent,
                  previous.targetScope == journal.targetScope,
                  previous.targetRootIdentifier == journal.targetRootIdentifier
            else {
                throw InstallError.invalidTransactionJournal
            }
        }

        let currentData: Data?
        if pathExists(url, fileManager: fileManager) {
            guard let values = try? url.resourceValues(
                      forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
                  ),
                  values.isRegularFile == true,
                  values.isSymbolicLink != true,
                  (values.fileSize ?? Int.max) <= GroupSubscriptionRecord.maximumBytes,
                  let data = try? Data(contentsOf: url)
            else {
                throw InstallError.invalidTransactionJournal
            }
            currentData = data
        } else {
            currentData = nil
        }
        guard currentData == subscription.previousData
                || currentData == subscription.replacementData
                || (currentData == nil && subscription.previousData == nil)
        else {
            throw InstallError.invalidTransactionJournal
        }
        return (url, subscription.previousData)
    }

    private func decodeJournalSubscription(_ data: Data) throws -> GroupSubscriptionRecord {
        guard data.count <= GroupSubscriptionRecord.maximumBytes,
              let record = try? JSONDecoder().decode(GroupSubscriptionRecord.self, from: data),
              (try? record.validate()) != nil
        else {
            throw InstallError.invalidTransactionJournal
        }
        return record
    }

    private func resolveActivationPath(_ relativePath: String) -> URL? {
        guard relativePath.hasPrefix("activations/"),
              let activation = resolveRelativePath(relativePath, under: managedRoot),
              (try? validateManagedActivation(activation, fileManager: .default)) != nil
        else {
            return nil
        }
        return activation
    }

    private func relativePath(of url: URL, under root: URL) -> String? {
        let path = url.standardizedFileURL.path
        let rootPath = root.standardizedFileURL.path
        if path == rootPath { return "." }
        let prefix = rootPath + "/"
        guard path.hasPrefix(prefix) else { return nil }
        let relative = String(path.dropFirst(prefix.count))
        return isSafeRelativePath(relative) ? relative : nil
    }

    private func resolveRelativePath(_ path: String, under root: URL) -> URL? {
        guard isSafeRelativePath(path) else { return nil }
        let resolved = path == "."
            ? root.standardizedFileURL
            : root.appendingPathComponent(path, isDirectory: true).standardizedFileURL
        guard resolved == root.standardizedFileURL || isDescendant(resolved, of: root) else {
            return nil
        }
        return resolved
    }

    private func isSafeRelativePath(_ path: String) -> Bool {
        if path == "." { return true }
        guard !path.isEmpty, !path.hasPrefix("/") else { return false }
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        return components.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    private func portableTargetKey(_ value: String) -> String {
        value.precomposedStringWithCanonicalMapping
            .lowercased(with: Locale(identifier: "en_US_POSIX"))
    }

    private func isCanonicalGroupRoute(_ value: String) -> Bool {
        let parts = value.split(separator: "/", omittingEmptySubsequences: true)
        guard value.hasPrefix("/"), parts.count == 4,
              parts[0] == "u", parts[2] == "sets",
              let route = try? DeviceGroupManifestRoute(
                handle: String(parts[1]),
                groupSlug: String(parts[3])
              )
        else {
            return false
        }
        return value == "/u/\(route.handle)/sets/\(route.groupSlug)"
    }

    private var packagesRoot: URL {
        managedRoot.appendingPathComponent("packages", isDirectory: true)
    }

    private var activationsRoot: URL {
        managedRoot.appendingPathComponent("activations", isDirectory: true)
    }

    private var stagingRoot: URL {
        managedRoot.appendingPathComponent("staging", isDirectory: true)
    }

    private var transactionsRoot: URL {
        managedRoot.appendingPathComponent("transactions", isDirectory: true)
    }

    private var journalURL: URL {
        transactionsRoot.appendingPathComponent("active.json", isDirectory: false)
    }

    private func validate(_ request: ManagedSkillInstallRequest) throws {
        let rootIdentifier = request.destination.rootIdentifier
        guard !request.sourceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !request.releaseId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              rootIdentifier.range(
                of: "^[a-z0-9][a-z0-9._-]{0,127}$",
                options: .regularExpression
              ) != nil,
              request.groupRevision.map({ $0 > 0 }) ?? true
        else {
            throw InstallError.invalidIdentifier
        }
        try validateTargetName(request.destination.targetName)
    }

    private func validateTargetName(_ targetName: String) throws {
        guard !targetName.isEmpty,
              targetName != ".",
              targetName != "..",
              !targetName.contains("/"),
              !targetName.contains("\\"),
              !targetName.unicodeScalars.contains(where: {
                  CharacterSet.controlCharacters.contains($0)
              })
        else {
            throw InstallError.invalidTargetName
        }
    }

    private func storePackage(
        _ package: SkillPackage,
        for request: ManagedSkillInstallRequest
    ) throws -> URL {
        let fileManager = FileManager.default
        let finalRoot = packageRoot(for: request)
        let finalContent = finalRoot.appendingPathComponent("content", isDirectory: true)
        if pathExists(finalRoot, fileManager: fileManager) {
            do {
                let stored = try readPackage(
                    from: finalContent,
                    coordinates: request.expectedCoordinates
                )
                _ = try SkillPackageValidator.validate(
                    stored,
                    expected: request.expectedCoordinates,
                    limits: limits
                )
                try sealPackageRoot(finalRoot, fileManager: fileManager)
                return finalContent
            } catch {
                throw InstallError.invalidStoredPackage
            }
        }

        try fileManager.createDirectory(at: stagingRoot, withIntermediateDirectories: true)
        let stage = stagingRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let stageContent = stage.appendingPathComponent("content", isDirectory: true)
        try fileManager.createDirectory(at: stageContent, withIntermediateDirectories: true)
        var promoted = false
        defer {
            if !promoted {
                try? makePackageRemovable(stage, fileManager: fileManager)
                try? fileManager.removeItem(at: stage)
            }
        }

        for entry in package.entries {
            let destination = stageContent.appendingPathComponent(entry.path, isDirectory: false)
            try fileManager.createDirectory(
                at: destination.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try entry.data.write(to: destination, options: .atomic)
            let permissions = entry.mode == "100755" ? 0o755 : 0o644
            try fileManager.setAttributes(
                [.posixPermissions: permissions],
                ofItemAtPath: destination.path
            )
        }

        let stagedPackage = try readPackage(
            from: stageContent,
            coordinates: request.expectedCoordinates
        )
        _ = try SkillPackageValidator.validate(
            stagedPackage,
            expected: request.expectedCoordinates,
            limits: limits
        )
        try makePackageImmutable(stage, fileManager: fileManager)

        let immutablePackage = try readPackage(
            from: stageContent,
            coordinates: request.expectedCoordinates
        )
        _ = try SkillPackageValidator.validate(
            immutablePackage,
            expected: request.expectedCoordinates,
            limits: limits
        )

        try fileManager.createDirectory(
            at: finalRoot.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        do {
            try fileManager.moveItem(at: stage, to: finalRoot)
            do {
                try sealPackageRoot(finalRoot, fileManager: fileManager)
            } catch {
                try? makePackageRemovable(finalRoot, fileManager: fileManager)
                try? fileManager.removeItem(at: finalRoot)
                throw error
            }
            promoted = true
            return finalContent
        } catch {
            if pathExists(finalRoot, fileManager: fileManager) {
                let stored = try readPackage(
                    from: finalContent,
                    coordinates: request.expectedCoordinates
                )
                _ = try SkillPackageValidator.validate(
                    stored,
                    expected: request.expectedCoordinates,
                    limits: limits
                )
                try sealPackageRoot(finalRoot, fileManager: fileManager)
                return finalContent
            }
            throw InstallError.filesystemFailure(error.localizedDescription)
        }
    }

    private func activate(
        packageContent: URL,
        request: ManagedSkillInstallRequest,
        policy: SkillInstallPolicy = .existingBehavior
    ) throws -> InstallResult {
        let fileManager = FileManager.default
        let destination = request.destination
        let targetURL = destination.rootURL.appendingPathComponent(
            destination.targetName,
            isDirectory: true
        )
        if policy == .newOnly { try requireNewCatalogDestination(request) }
        let existingManaged = try existingManagedActivation(
            at: targetURL,
            fileManager: fileManager
        )
        if policy == .newOnly {
            try fileManager.createDirectory(at: destination.rootURL, withIntermediateDirectories: true)
        }
        let activation = try prepareActivation(packageContent: packageContent, request: request)
        do {
            try beforeActivationSwitch()
            if policy == .newOnly {
                try Task.checkCancellation()
                try requireNewCatalogDestination(request)
                // symlink() is exclusive; unlike rename(), it cannot replace a racing destination.
                do {
                    try fileManager.createSymbolicLink(at: targetURL,
                        withDestinationURL: activation.appendingPathComponent("content", isDirectory: true))
                } catch {
                    if pathExists(targetURL, fileManager: fileManager) { throw SkillInstaller.InstallError.destinationConflict }
                    throw error
                }
            } else {
                try switchTarget(targetURL, to: activation.appendingPathComponent("content", isDirectory: true))
            }
            return existingManaged == nil ? .installed : .updated
        } catch {
            try? fileManager.removeItem(at: activation)
            throw error
        }
    }

    private func prepareActivation(
        packageContent: URL,
        request: ManagedSkillInstallRequest
    ) throws -> URL {
        let fileManager = FileManager.default
        let destination = request.destination
        let activationParent = activationsRoot.appendingPathComponent(
            stableKey("\(destination.rootIdentifier):\(destination.targetName)"),
            isDirectory: true
        )
        try fileManager.createDirectory(at: activationParent, withIntermediateDirectories: true)
        let activation = activationParent.appendingPathComponent(
            UUID().uuidString,
            isDirectory: true
        )
        try fileManager.createDirectory(at: activation, withIntermediateDirectories: false)
        do {
            let activationContent = activation.appendingPathComponent("content", isDirectory: true)
            try fileManager.createSymbolicLink(
                at: activationContent,
                withDestinationURL: packageContent
            )
            try SkillInstallProvenanceStore.write(
                makeProvenance(request),
                to: activation.appendingPathComponent("provenance.json")
            )
            try validateManagedActivation(activation, fileManager: fileManager)
            return activation
        } catch {
            try? fileManager.removeItem(at: activation)
            throw error
        }
    }

    private func switchTarget(_ targetURL: URL, to activationContent: URL) throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(
            at: targetURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let temporaryTarget = targetURL.deletingLastPathComponent().appendingPathComponent(
            ".omgskills-activate-\(UUID().uuidString)",
            isDirectory: true
        )
        try fileManager.createSymbolicLink(
            at: temporaryTarget,
            withDestinationURL: activationContent
        )
        defer { try? fileManager.removeItem(at: temporaryTarget) }
        guard Darwin.rename(temporaryTarget.path, targetURL.path) == 0 else {
            throw InstallError.filesystemFailure(String(cString: strerror(errno)))
        }
    }

    private func existingManagedActivation(
        at targetURL: URL,
        fileManager: FileManager
    ) throws -> URL? {
        guard pathExists(targetURL, fileManager: fileManager) else { return nil }
        guard let destination = symlinkDestination(of: targetURL, fileManager: fileManager),
              destination.lastPathComponent == "content",
              isDescendant(destination, of: activationsRoot)
        else {
            throw InstallError.unmanagedTargetExists
        }
        let activation = destination.deletingLastPathComponent()
        try validateManagedActivation(activation, fileManager: fileManager)
        return activation
    }

    private func activationGroupId(_ activation: URL) -> String? {
        guard let data = try? Data(contentsOf: activation.appendingPathComponent("provenance.json")),
              let provenance = try? JSONDecoder().decode(SkillInstallProvenance.self, from: data)
        else { return nil }
        return provenance.groupId
    }

    private func validateManagedActivation(
        _ activation: URL,
        fileManager: FileManager
    ) throws {
        guard isDescendant(activation, of: activationsRoot),
              let data = try? Data(
                contentsOf: activation.appendingPathComponent("provenance.json")
              ),
              (try? JSONDecoder().decode(SkillInstallProvenance.self, from: data)) != nil,
              let packageContent = symlinkDestination(
                of: activation.appendingPathComponent("content"),
                fileManager: fileManager
              ),
              packageContent.lastPathComponent == "content",
              isDescendant(packageContent, of: packagesRoot),
              fileManager.fileExists(
                atPath: packageContent.appendingPathComponent("SKILL.md").path
              )
        else {
            throw InstallError.invalidManagedActivation
        }
    }

    private func makeProvenance(_ request: ManagedSkillInstallRequest) -> SkillInstallProvenance {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return SkillInstallProvenance(
            catalogSkillId: request.catalogSkillId,
            githubUrl: request.githubUrl,
            installedAt: formatter.string(from: Date()),
            skillMdSha: request.expectedCoordinates.skillMdSha.lowercased(),
            sourceKind: request.sourceKind.rawValue,
            sourceId: request.sourceId,
            releaseId: request.releaseId,
            groupId: request.groupId,
            groupRoute: request.groupRoute,
            groupName: request.groupName,
            groupRevision: request.groupRevision,
            commitSha: request.expectedCoordinates.commitSha.lowercased(),
            treeSha: request.expectedCoordinates.treeSha.lowercased(),
            targetAgent: request.destination.agent.rawValue,
            targetScope: request.destination.scope.rawValue,
            targetRootIdentifier: request.destination.rootIdentifier,
            installMode: request.mode.rawValue
        )
    }

    private func packageRoot(for request: ManagedSkillInstallRequest) -> URL {
        packagesRoot
            .appendingPathComponent(stableKey(request.sourceId), isDirectory: true)
            .appendingPathComponent(stableKey(request.releaseId), isDirectory: true)
    }

    private func stableKey(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private func readPackage(
        from contentRoot: URL,
        coordinates: SkillPackageCoordinates
    ) throws -> SkillPackage {
        let fileManager = FileManager.default
        var enumerationFailed = false
        guard let enumerator = fileManager.enumerator(
            at: contentRoot,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey],
            options: [],
            errorHandler: { _, _ in enumerationFailed = true; return false }
        ) else {
            throw InstallError.invalidStoredPackage
        }

        var entries: [SkillPackageEntry] = []
        var totalBytes = 0
        while let item = enumerator.nextObject() as? URL {
            try Task.checkCancellation()
            let values = try item.resourceValues(
                forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
            )
            if values.isSymbolicLink == true {
                throw InstallError.invalidStoredPackage
            }
            if values.isDirectory == true { continue }
            guard values.isRegularFile == true else {
                throw InstallError.invalidStoredPackage
            }

            let rootPath = contentRoot.standardizedFileURL.path + "/"
            let itemPath = item.standardizedFileURL.path
            guard itemPath.hasPrefix(rootPath) else {
                throw InstallError.invalidStoredPackage
            }
            let relativePath = String(itemPath.dropFirst(rootPath.count))
            let size = values.fileSize ?? Int.max
            guard entries.count < limits.maximumFileCount,
                  size <= limits.maximumFileBytes,
                  size <= limits.maximumTotalBytes - totalBytes,
                  relativePath != "SKILL.md" || size <= limits.maximumSkillMdBytes else {
                throw InstallError.invalidStoredPackage
            }
            let data = try Data(contentsOf: item)
            guard data.count == size else { throw InstallError.invalidStoredPackage }
            totalBytes += size
            let attributes = try fileManager.attributesOfItem(atPath: item.path)
            let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
            let mode = (permissions & 0o111) == 0 ? "100644" : "100755"
            entries.append(SkillPackageEntry(
                path: relativePath,
                mode: mode,
                data: data,
                blobSha: SkillIdentityResolver.gitBlobSHA(for: data)
            ))
        }
        guard !enumerationFailed else { throw InstallError.invalidStoredPackage }
        entries.sort { $0.path < $1.path }
        return SkillPackage(coordinates: coordinates, entries: entries)
    }

    private func symlinkDestination(
        of url: URL,
        fileManager: FileManager
    ) -> URL? {
        guard let destination = try? fileManager.destinationOfSymbolicLink(atPath: url.path) else {
            return nil
        }
        if destination.hasPrefix("/") {
            return URL(fileURLWithPath: destination, isDirectory: true).standardizedFileURL
        }
        return url.deletingLastPathComponent()
            .appendingPathComponent(destination, isDirectory: true)
            .standardizedFileURL
    }

    private func pathExists(_ url: URL, fileManager: FileManager) -> Bool {
        fileManager.fileExists(atPath: url.path) ||
            (try? fileManager.destinationOfSymbolicLink(atPath: url.path)) != nil
    }

    private func isDescendant(_ url: URL, of root: URL) -> Bool {
        let path = url.standardizedFileURL.path
        let rootPath = root.standardizedFileURL.path
        return path.hasPrefix(rootPath + "/")
    }

    private func leafDirectories(
        twoLevelsBelow root: URL,
        fileManager: FileManager
    ) throws -> [URL] {
        guard pathExists(root, fileManager: fileManager) else { return [] }
        var leaves: [URL] = []
        let firstLevel = try fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )
        for parent in firstLevel {
            let values = try parent.resourceValues(forKeys: [.isDirectoryKey])
            guard values.isDirectory == true else {
                throw InstallError.invalidManagedActivation
            }
            let children = try fileManager.contentsOfDirectory(
                at: parent,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            )
            for child in children {
                let childValues = try child.resourceValues(forKeys: [.isDirectoryKey])
                guard childValues.isDirectory == true else {
                    throw InstallError.invalidManagedActivation
                }
                leaves.append(child)
            }
        }
        return leaves
    }

    private func removeEmptyChildren(of root: URL, fileManager: FileManager) throws {
        guard pathExists(root, fileManager: fileManager) else { return }
        for child in try fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) {
            let values = try child.resourceValues(forKeys: [.isDirectoryKey])
            guard values.isDirectory == true else { continue }
            let contents = try fileManager.contentsOfDirectory(atPath: child.path)
            if contents.isEmpty {
                try fileManager.removeItem(at: child)
            }
        }
    }

    private func makePackageImmutable(_ packageRoot: URL, fileManager: FileManager) throws {
        guard let enumerator = fileManager.enumerator(
            at: packageRoot,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey],
            options: []
        ) else {
            throw InstallError.invalidStoredPackage
        }
        var directories: [URL] = []
        while let item = enumerator.nextObject() as? URL {
            let values = try item.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey])
            if values.isDirectory == true {
                directories.append(item)
                continue
            }
            guard values.isRegularFile == true else {
                throw InstallError.invalidStoredPackage
            }
            let attributes = try fileManager.attributesOfItem(atPath: item.path)
            let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
            let immutablePermissions = (permissions & 0o111) == 0 ? 0o444 : 0o555
            try fileManager.setAttributes(
                [.posixPermissions: immutablePermissions],
                ofItemAtPath: item.path
            )
        }
        for directory in directories.reversed() {
            try fileManager.setAttributes([.posixPermissions: 0o555], ofItemAtPath: directory.path)
        }
    }

    private func sealPackageRoot(_ packageRoot: URL, fileManager: FileManager) throws {
        try fileManager.setAttributes([.posixPermissions: 0o555], ofItemAtPath: packageRoot.path)
    }

    private func makePackageRemovable(_ packageRoot: URL, fileManager: FileManager) throws {
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: packageRoot.path)
        guard let enumerator = fileManager.enumerator(
            at: packageRoot,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: []
        ) else { return }
        while let item = enumerator.nextObject() as? URL {
            let values = try item.resourceValues(forKeys: [.isDirectoryKey])
            if values.isDirectory == true {
                try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: item.path)
            }
        }
    }
}
