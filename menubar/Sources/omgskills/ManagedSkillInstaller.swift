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
    let groupRevision: Int?
    let catalogSkillId: String?
    let githubUrl: String?
    let expectedCoordinates: SkillPackageCoordinates
    let mode: ManagedSkillInstallMode
    let destination: ManagedSkillDestination
}

struct ManagedSkillCleanupReport: Equatable, Sendable {
    let removedActivations: Int
    let removedPackages: Int
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
            case .filesystemFailure(let message):
                return message.isEmpty ? "Managed install failed" : message
            }
        }
    }

    typealias PackageLoader = @Sendable () async throws -> SkillPackage
    typealias BeforeActivationSwitch = @Sendable () throws -> Void

    private let managedRoot: URL
    private let limits: SkillPackageValidationLimits
    private let beforeActivationSwitch: BeforeActivationSwitch

    init(
        managedRoot: URL = ManagedSkillInstaller.defaultManagedRoot,
        limits: SkillPackageValidationLimits = .standard,
        beforeActivationSwitch: @escaping BeforeActivationSwitch = {}
    ) {
        self.managedRoot = managedRoot
        self.limits = limits
        self.beforeActivationSwitch = beforeActivationSwitch
    }

    static var defaultManagedRoot: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("omgskills/managed", isDirectory: true)
    }

    func install(
        _ request: ManagedSkillInstallRequest,
        loadPackage: PackageLoader
    ) async throws -> InstallResult {
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

    func cleanup(targetRoots: [URL]) throws -> ManagedSkillCleanupReport {
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

    private var packagesRoot: URL {
        managedRoot.appendingPathComponent("packages", isDirectory: true)
    }

    private var activationsRoot: URL {
        managedRoot.appendingPathComponent("activations", isDirectory: true)
    }

    private var stagingRoot: URL {
        managedRoot.appendingPathComponent("staging", isDirectory: true)
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
        let targetName = request.destination.targetName
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

        try fileManager.createDirectory(
            at: destination.rootURL,
            withIntermediateDirectories: true
        )
        let activationParent = activationsRoot.appendingPathComponent(
            stableKey("\(destination.rootIdentifier):\(destination.targetName)"),
            isDirectory: true
        )
        try fileManager.createDirectory(at: activationParent, withIntermediateDirectories: true)
        let activation = activationParent.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: activation, withIntermediateDirectories: false)
        var switched = false
        defer {
            if !switched {
                try? fileManager.removeItem(at: activation)
            }
        }

        let activationContent = activation.appendingPathComponent("content", isDirectory: true)
        try fileManager.createSymbolicLink(at: activationContent, withDestinationURL: packageContent)
        let provenance = makeProvenance(request)
        try SkillInstallProvenanceStore.write(
            provenance,
            to: activation.appendingPathComponent("provenance.json")
        )
        guard fileManager.fileExists(
            atPath: activationContent.appendingPathComponent("SKILL.md").path
        ) else {
            throw InstallError.invalidManagedActivation
        }

        try beforeActivationSwitch()
        let temporaryTarget = destination.rootURL.appendingPathComponent(
            ".omgskills-activate-\(UUID().uuidString)",
            isDirectory: true
        )
        try fileManager.createSymbolicLink(at: temporaryTarget, withDestinationURL: activationContent)
        defer { try? fileManager.removeItem(at: temporaryTarget) }

        guard Darwin.rename(temporaryTarget.path, targetURL.path) == 0 else {
            throw InstallError.filesystemFailure(String(cString: strerror(errno)))
        }
        switched = true
        return existingManaged == nil ? .installed : .updated
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
        guard fileManager.fileExists(
            atPath: activation.appendingPathComponent("provenance.json").path
        ) else {
            throw InstallError.invalidManagedActivation
        }
        return activation
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
