import Foundation

protocol GroupSubscriptionDetecting: Sendable {
    func detectGroupSubscription(
        manifest: GroupManifest,
        route: DeviceGroupManifestRoute,
        destination: ManagedGroupSnapshotDestination
    ) async throws -> GroupSubscriptionDiff?
}

extension ManagedSkillInstaller: GroupSubscriptionDetecting {
    func detectGroupSubscription(
        manifest: GroupManifest,
        route: DeviceGroupManifestRoute,
        destination: ManagedGroupSnapshotDestination
    ) async throws -> GroupSubscriptionDiff? {
        try Task.checkCancellation()
        guard let baseline = try GroupSubscriptionStore.read(
            groupId: manifest.group.id,
            targetRoot: destination.rootURL
        ) else {
            return nil
        }
        let current = try GroupSubscriptionRecord.make(
            manifest: manifest,
            route: route,
            destination: destination
        )

        var localStates: [String: GroupSubscriptionLocalState] = [:]
        for item in baseline.items {
            try Task.checkCancellation()
            guard case .installable(
                let sourceId,
                let releaseId,
                let commitSha,
                let treeSha,
                let skillMdSha
            ) = item.state else {
                continue
            }
            let targetURL = destination.rootURL.appendingPathComponent(
                item.name,
                isDirectory: true
            )
            let packageRoot: URL
            do {
                guard let resolved = try managedPackageContentURL(at: targetURL) else {
                    localStates[item.id] = .missing
                    continue
                }
                packageRoot = resolved
            } catch InstallError.unmanagedTargetExists {
                localStates[item.id] = .replaced
                continue
            } catch {
                localStates[item.id] = .unreadable
                continue
            }
            localStates[item.id] = LocalManagedPackageInspector.inspect(
                packageRoot: packageRoot,
                targetName: item.name,
                sourceId: sourceId,
                releaseId: releaseId,
                groupId: baseline.groupId,
                destination: destination,
                expected: SkillPackageCoordinates(
                    commitSha: commitSha,
                    treeSha: treeSha,
                    skillMdSha: skillMdSha
                )
            )
        }
        return try GroupSubscriptionDiffer.compare(
            baseline: baseline,
            current: current,
            localStates: localStates
        )
    }
}

private enum LocalManagedPackageInspector {
    static func inspect(
        packageRoot: URL,
        targetName: String,
        sourceId: String,
        releaseId: String,
        groupId: String,
        destination: ManagedGroupSnapshotDestination,
        expected: SkillPackageCoordinates,
        fileManager: FileManager = .default
    ) -> GroupSubscriptionLocalState {
        let skillURL = packageRoot.appendingPathComponent("SKILL.md")
        guard fileManager.fileExists(atPath: skillURL.path) else { return .missing }
        guard let provenance = SkillInstallProvenanceStore.read(
            targetRoot: destination.rootURL,
            targetName: targetName
        ),
              provenance.groupId == groupId,
              provenance.sourceId == sourceId,
              provenance.releaseId == releaseId,
              provenance.targetAgent == destination.agent.rawValue,
              provenance.targetScope == destination.scope.rawValue,
              provenance.targetRootIdentifier == destination.rootIdentifier
        else {
            return .replaced
        }

        do {
            let package = try loadPackage(
                at: packageRoot,
                expected: expected,
                fileManager: fileManager
            )
            _ = try SkillPackageValidator.validate(package, expected: expected)
            return .clean
        } catch let error as SkillPackageValidationError {
            switch error.code {
            case .blobShaMismatch, .treeShaMismatch, .skillMdShaMismatch,
                 .duplicatePath, .pathConflict, .caseCollision, .symbolicLink,
                 .submodule, .unsupportedEntryType, .tooManyFiles, .fileTooLarge,
                 .skillMdTooLarge, .packageTooLarge, .missingSkillMd:
                return .modified
            case .invalidSha, .commitShaMismatch, .invalidPath:
                return .unreadable
            }
        } catch {
            return .unreadable
        }
    }

    private static func loadPackage(
        at root: URL,
        expected: SkillPackageCoordinates,
        fileManager: FileManager
    ) throws -> SkillPackage {
        var entries: [SkillPackageEntry] = []
        var pending: [(url: URL, relativePath: String)] = [(root, "")]
        var totalBytes = 0
        let limits = SkillPackageValidationLimits.standard

        while let directory = pending.popLast() {
            try Task.checkCancellation()
            let children = try fileManager.contentsOfDirectory(
                at: directory.url,
                includingPropertiesForKeys: [
                    .isDirectoryKey,
                    .isRegularFileKey,
                    .isSymbolicLinkKey,
                    .fileSizeKey
                ],
                options: []
            ).sorted { $0.lastPathComponent < $1.lastPathComponent }

            for child in children {
                try Task.checkCancellation()
                let relativePath = directory.relativePath.isEmpty
                    ? child.lastPathComponent
                    : "\(directory.relativePath)/\(child.lastPathComponent)"
                let values = try child.resourceValues(forKeys: [
                    .isDirectoryKey,
                    .isRegularFileKey,
                    .isSymbolicLinkKey,
                    .fileSizeKey
                ])
                if values.isSymbolicLink == true {
                    throw SkillPackageValidationError(code: .symbolicLink, path: relativePath)
                }
                if values.isDirectory == true {
                    pending.append((child, relativePath))
                    continue
                }
                guard values.isRegularFile == true else {
                    throw SkillPackageValidationError(code: .unsupportedEntryType, path: relativePath)
                }
                guard entries.count < limits.maximumFileCount else {
                    throw SkillPackageValidationError(code: .tooManyFiles, path: nil)
                }
                let size = values.fileSize ?? Int.max
                guard size <= limits.maximumFileBytes else {
                    throw SkillPackageValidationError(code: .fileTooLarge, path: relativePath)
                }
                let (nextTotal, overflow) = totalBytes.addingReportingOverflow(size)
                guard !overflow, nextTotal <= limits.maximumTotalBytes else {
                    throw SkillPackageValidationError(code: .packageTooLarge, path: nil)
                }
                let data = try Data(contentsOf: child)
                totalBytes = nextTotal
                let attributes = try fileManager.attributesOfItem(atPath: child.path)
                let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
                entries.append(SkillPackageEntry(
                    path: relativePath,
                    mode: permissions & 0o111 == 0 ? "100644" : "100755",
                    data: data,
                    blobSha: SkillIdentityResolver.gitBlobSHA(for: data)
                ))
            }
        }

        return SkillPackage(
            coordinates: expected,
            entries: entries.sorted { $0.path < $1.path }
        )
    }
}
