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
    let metadataOnlyItems: [ManagedGroupMetadataOnlyItem]
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
}

private struct StoredGroupItem: Sendable {
    let planned: PlannedGroupItem
    let packageContent: URL
}

private struct PreparedGroupItem: Sendable {
    let planned: PlannedGroupItem
    let activation: URL
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

    struct Entry: Codable, Sendable {
        let targetName: String
        let previousActivationRelativePath: String?
        let preparedActivationRelativePath: String
    }
}

private struct JournalRecoveryEntry {
    let targetURL: URL
    let previousContent: URL?
    let preparedContent: URL
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
        case invalidStoredPackage
        case invalidManagedActivation
        case invalidGroupManifest
        case invalidTransactionJournal
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
            case .invalidStoredPackage:
                return "Stored package does not match its validated release"
            case .invalidManagedActivation:
                return "Managed installation state is incomplete or unsafe"
            case .invalidGroupManifest:
                return "This group cannot be installed safely"
            case .invalidTransactionJournal:
                return "A previous group installation cannot be recovered safely"
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

    private let managedRoot: URL
    private let pathAnchor: URL
    private let limits: SkillPackageValidationLimits
    private let beforeActivationSwitch: BeforeActivationSwitch
    private let beforeGroupActivationSwitch: BeforeGroupActivationSwitch
    private var mutationInProgress = false

    init(
        managedRoot: URL = ManagedSkillInstaller.defaultManagedRoot,
        pathAnchor: URL = FileManager.default.homeDirectoryForCurrentUser,
        limits: SkillPackageValidationLimits = .standard,
        beforeActivationSwitch: @escaping BeforeActivationSwitch = {},
        beforeGroupActivationSwitch: @escaping BeforeGroupActivationSwitch = { _, _ in }
    ) {
        self.managedRoot = managedRoot
        self.pathAnchor = pathAnchor.standardizedFileURL
        self.limits = limits
        self.beforeActivationSwitch = beforeActivationSwitch
        self.beforeGroupActivationSwitch = beforeGroupActivationSwitch
    }

    static var defaultManagedRoot: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("omgskills/managed", isDirectory: true)
    }

    func install(
        _ request: ManagedSkillInstallRequest,
        loadPackage: PackageLoader
    ) async throws -> InstallResult {
        try beginMutation()
        defer { endMutation() }
        try recoverPendingTransaction()
        try validate(request)

        let package = try await loadPackage()
        try Task.checkCancellation()
        _ = try SkillPackageValidator.validate(
            package,
            expected: request.expectedCoordinates,
            limits: limits
        )

        let packageContent = try storePackage(package, for: request)
        return try activate(packageContent: packageContent, request: request)
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

        guard !prepared.isEmpty else {
            return ManagedGroupSnapshotInstallResult(
                installedCount: 0,
                updatedCount: 0,
                metadataOnlyItems: plan.metadataOnly
            )
        }

        let journal = try makeJournal(for: request, prepared: prepared)
        try writeJournal(journal)
        do {
            for (index, item) in prepared.enumerated() {
                try Task.checkCancellation()
                try beforeGroupActivationSwitch(index, item.planned.installRequest.destination.targetName)
                try switchTarget(
                    item.planned.targetURL,
                    to: item.activation.appendingPathComponent("content", isDirectory: true)
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
            metadataOnlyItems: plan.metadataOnly
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

    private func beginMutation() throws {
        guard !mutationInProgress else {
            throw InstallError.operationInProgress
        }
        mutationInProgress = true
    }

    private func endMutation() {
        mutationInProgress = false
    }

    private func makeGroupPlan(
        _ request: ManagedGroupSnapshotInstallRequest
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
                let installRequest = ManagedSkillInstallRequest(
                    sourceKind: sourceValues.kind,
                    sourceId: sourceValues.id,
                    releaseId: release.id,
                    groupId: manifest.group.id,
                    groupRoute: groupRoute,
                    groupRevision: manifest.group.revision,
                    catalogSkillId: sourceValues.catalogSkillId,
                    githubUrl: sourceValues.githubUrl,
                    expectedCoordinates: release.coordinates,
                    mode: .snapshot,
                    destination: ManagedSkillDestination(
                        agent: destination.agent,
                        scope: destination.scope,
                        rootIdentifier: destination.rootIdentifier,
                        rootURL: destination.rootURL,
                        targetName: item.name
                    )
                )
                try validate(installRequest)
                let collisionKey = portableTargetKey(item.name)
                guard targetKeys.insert(collisionKey).inserted else {
                    throw InstallError.invalidGroupManifest
                }
                let targetURL = destination.rootURL.appendingPathComponent(
                    item.name,
                    isDirectory: true
                )
                installable.append(PlannedGroupItem(
                    manifestItem: item,
                    installRequest: installRequest,
                    targetURL: targetURL,
                    previousActivation: try existingManagedActivation(
                        at: targetURL,
                        fileManager: .default
                    )
                ))
            }
        }

        return GroupInstallPlan(installable: installable, metadataOnly: metadataOnly)
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
        prepared: [PreparedGroupItem]
    ) throws -> ManagedGroupTransactionJournal {
        guard let targetRootRelativePath = relativePath(
            of: request.destination.rootURL,
            under: pathAnchor
        ) else {
            throw InstallError.invalidGroupManifest
        }
        let entries = try prepared.map { item in
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
                preparedActivationRelativePath: preparedPath
            )
        }
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
            entries: entries
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
              size <= 1_048_576,
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
              !journal.entries.isEmpty,
              journal.entries.count <= GroupManifest.maximumItemCount,
              let targetRoot = resolveRelativePath(
                journal.targetRootRelativePath,
                under: pathAnchor
              )
        else {
            throw InstallError.invalidTransactionJournal
        }

        var targetKeys = Set<String>()
        var recoveryEntries: [JournalRecoveryEntry] = []
        recoveryEntries.reserveCapacity(journal.entries.count)
        for entry in journal.entries {
            try validateTargetName(entry.targetName)
            let key = portableTargetKey(entry.targetName)
            guard targetKeys.insert(key).inserted,
                  let preparedActivation = resolveActivationPath(
                    entry.preparedActivationRelativePath
                  )
            else {
                throw InstallError.invalidTransactionJournal
            }
            let previousActivation = try entry.previousActivationRelativePath.map { path in
                guard let activation = resolveActivationPath(path) else {
                    throw InstallError.invalidTransactionJournal
                }
                return activation
            }
            let targetURL = targetRoot.appendingPathComponent(entry.targetName, isDirectory: true)
            let preparedContent = preparedActivation.appendingPathComponent(
                "content",
                isDirectory: true
            )
            let previousContent = previousActivation?.appendingPathComponent(
                "content",
                isDirectory: true
            )
            let current = symlinkDestination(of: targetURL, fileManager: fileManager)
            if previousContent == nil {
                guard !pathExists(targetURL, fileManager: fileManager) || current == preparedContent
                else {
                    throw InstallError.invalidTransactionJournal
                }
            } else {
                guard current == previousContent || current == preparedContent else {
                    throw InstallError.invalidTransactionJournal
                }
            }
            recoveryEntries.append(JournalRecoveryEntry(
                targetURL: targetURL,
                previousContent: previousContent,
                preparedContent: preparedContent
            ))
        }

        for entry in recoveryEntries.reversed() {
            let current = symlinkDestination(of: entry.targetURL, fileManager: fileManager)
            if let previousContent = entry.previousContent {
                guard current == previousContent || current == entry.preparedContent else {
                    throw InstallError.invalidTransactionJournal
                }
                if current != previousContent {
                    try switchTarget(entry.targetURL, to: previousContent)
                }
            } else if pathExists(entry.targetURL, fileManager: fileManager) {
                guard current == entry.preparedContent else {
                    throw InstallError.invalidTransactionJournal
                }
                try fileManager.removeItem(at: entry.targetURL)
            }
        }
        try removeJournal()
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
        request: ManagedSkillInstallRequest
    ) throws -> InstallResult {
        let fileManager = FileManager.default
        let destination = request.destination
        let targetURL = destination.rootURL.appendingPathComponent(
            destination.targetName,
            isDirectory: true
        )
        let existingManaged = try existingManagedActivation(
            at: targetURL,
            fileManager: fileManager
        )
        let activation = try prepareActivation(packageContent: packageContent, request: request)
        do {
            try beforeActivationSwitch()
            try switchTarget(
                targetURL,
                to: activation.appendingPathComponent("content", isDirectory: true)
            )
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
        guard let enumerator = fileManager.enumerator(
            at: contentRoot,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
            options: [],
            errorHandler: { _, _ in false }
        ) else {
            throw InstallError.invalidStoredPackage
        }

        var entries: [SkillPackageEntry] = []
        while let item = enumerator.nextObject() as? URL {
            let values = try item.resourceValues(
                forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]
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
            let data = try Data(contentsOf: item)
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
