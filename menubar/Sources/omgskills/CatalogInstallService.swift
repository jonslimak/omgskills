import Foundation

actor CatalogInstallService {
    enum Result: Equatable, Sendable {
        case installed, alreadyInstalled, conflict, needsGit, unavailable
        case failed(String)
    }
    typealias GitProvider = @Sendable () async throws -> any GitCommandRunning
    typealias RecordWriter = @Sendable (Skill, URL, String, String) throws -> Void
    private let installer: CatalogSkillInstaller
    private let paths: SkillFilesystemPaths
    private let gitProvider: GitProvider
    private let writeRecord: RecordWriter
    private var installing = false

    init(installer: CatalogSkillInstaller,
         gitProvider: @escaping GitProvider = { try await SkillInstaller.usableGitRunner() },
         writeRecord: @escaping RecordWriter = { skill, root, name, sha in
             try SkillInstallProvenanceStore.writeNew(catalogSkillId: skill.id, githubUrl: skill.githubUrl,
                 skillMdSha: sha, targetRoot: root, targetName: name)
         }) {
        self.installer = installer
        paths = installer.installationPaths
        self.gitProvider = gitProvider
        self.writeRecord = writeRecord
    }

    func destination(for skill: Skill, target: SkillInstaller.Target) throws -> URL {
        let name: String
        switch skill.pinnedInstallMetadataState {
        case .invalid: throw CatalogSkillInstaller.InstallError.invalidPinnedMetadata
        case .legacy:
            try SkillInstaller.validateNewInstallationSpec(for: skill)
            name = try SkillInstaller.installationSpec(for: skill).targetName
        case .complete(let metadata):
            guard SkillInstaller.validatedRepositorySlug(from: skill.githubUrl)?.lowercased() == metadata.repositorySlug.lowercased()
            else { throw SkillInstaller.InstallError.invalidGitHubURL }
            name = metadata.targetName
        }
        return paths.skillsRoot(for: target).appendingPathComponent(name)
    }

    func install(_ skill: Skill, target: SkillInstaller.Target) async -> Result {
        guard !installing else { return .failed("Another installation is already in progress") }
        installing = true
        defer { installing = false }
        do {
            try Task.checkCancellation()
            let destination = try destination(for: skill, target: target)
            let root = paths.skillsRoot(for: target)
            try CatalogInstallFilesystem.requireDirectoryChain(root, under: paths.homeDirectory)
            try CatalogInstallFilesystem.requireDirectoryChain(root.appendingPathComponent(".omgskills"), under: root)
            if try hasOtherDestination(catalogID: skill.id, root: root, expectedName: destination.lastPathComponent) {
                return .conflict
            }
            let record = SkillInstallProvenanceStore.metadataURL(targetRoot: root, targetName: destination.lastPathComponent)
            if CatalogInstallFilesystem.exists(destination) {
                guard FileManager.default.fileExists(atPath: destination.appendingPathComponent("SKILL.md").path),
                      let provenance = SkillInstallProvenanceStore.read(targetRoot: root, targetName: destination.lastPathComponent),
                      provenance.catalogSkillId == skill.id, provenance.githubUrl == skill.githubUrl else { return .conflict }
                if provenance.sourceKind == nil,
                   let spec = try? SkillInstaller.installationSpec(for: skill),
                   let link = try? FileManager.default.destinationOfSymbolicLink(atPath: destination.path) {
                    let repo = paths.legacyRepoCacheRoot.appendingPathComponent(spec.repoCacheName)
                    try CatalogInstallFilesystem.requireDirectoryChain(repo, under: paths.legacyRepoCacheRoot.deletingLastPathComponent())
                    let expected = spec.skillRelativePath == "." ? repo : repo.appendingPathComponent(spec.skillRelativePath)
                    let linked = link.hasPrefix("/") ? URL(fileURLWithPath: link) : root.appendingPathComponent(link)
                    let resolved = expected.resolvingSymlinksInPath().standardizedFileURL
                    let cache = repo.resolvingSymlinksInPath().standardizedFileURL
                    guard linked.standardizedFileURL == expected.standardizedFileURL,
                          resolved == cache || resolved.path.hasPrefix(cache.path + "/") else { return .conflict }
                    return .alreadyInstalled
                }
                if !CatalogInstallFilesystem.exists(record),
                   (try? await installer.recognizesManagedInstall(skill, target: target)) == true {
                    return .alreadyInstalled
                }
                return .conflict
            }
            guard !CatalogInstallFilesystem.exists(record) else { return .conflict }
            let git: any GitCommandRunning
            do { git = try await gitProvider() }
            catch is CancellationError { return .failed("Installation canceled") }
            catch { return .needsGit }
            try Task.checkCancellation()
            try await installer.installNew(skill, target: target, gitRunner: git, writeNewRecord: writeRecord)
            return .installed
        } catch SkillInstaller.InstallError.destinationConflict { return .conflict }
        catch CatalogSkillInstaller.InstallError.invalidPinnedMetadata { return .unavailable }
        catch SkillInstaller.InstallError.invalidGitHubURL { return .unavailable }
        catch SkillInstaller.InstallError.invalidInstallCommand { return .unavailable }
        catch SkillInstaller.InstallError.missingGit { return .needsGit }
        catch { return .failed(error.localizedDescription) }
    }

    private func hasOtherDestination(catalogID: String, root: URL, expectedName: String) throws -> Bool {
        let fm = FileManager.default
        var names = Set<String>()
        if CatalogInstallFilesystem.exists(root) {
            names.formUnion(try fm.contentsOfDirectory(atPath: root.path).filter { !$0.hasPrefix(".") })
        }
        let records = root.appendingPathComponent(".omgskills")
        if CatalogInstallFilesystem.exists(records) {
            names.formUnion(try fm.contentsOfDirectory(atPath: records.path).filter { $0.hasSuffix(".json") }
                .map { String($0.dropLast(5)) })
        }
        for name in names where name != expectedName {
            if SkillInstallProvenanceStore.read(targetRoot: root, targetName: name)?.catalogSkillId == catalogID {
                return true
            }
        }
        return false
    }
}
