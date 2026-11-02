import Foundation

/// One skill folder on this Mac, read as a package ready for cloud save.
struct CloudSaveFolder: Equatable, Sendable {
    let key: String
    let directory: URL
    let entries: [SkillPackageEntry]
    let coordinates: SkillPackageCoordinates
    /// When any file in the folder last changed.
    let modifiedAt: Date

    var treeSha: String { coordinates.treeSha }

    // Netlify buffers request bodies up to 6 MB, so the server takes at most 4 MB per file.
    static let limits = SkillPackageValidationLimits(
        maximumFileCount: 512,
        maximumTotalBytes: 12 * 1024 * 1024,
        maximumFileBytes: 4 * 1024 * 1024,
        maximumSkillMdBytes: 2 * 1024 * 1024
    )

    /// Files the agent never reads and that would make every Mac's copy differ.
    private static let ignoredNames: Set<String> = [".DS_Store", ".git"]

    enum ReadError: Error, Equatable, Sendable {
        case unreadable
        case containsLink(String)
        case invalid(SkillPackageValidationFailureCode)
    }

    /// A skill's identity across agents and Macs, matching the server: the folder name, NFC and lower case.
    /// Nothing is trimmed; the server refuses names it can't store, and that skill is reported, not saved.
    static func key(forFolderName name: String) -> String {
        name.precomposedStringWithCanonicalMapping.lowercased()
    }

    static func read(directory: URL, fileManager: FileManager = .default) throws -> CloudSaveFolder {
        let root = directory.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw ReadError.unreadable
        }
        var entries: [SkillPackageEntry] = []
        var modifiedAt = Date.distantPast
        try collect(root, prefix: "", into: &entries, modifiedAt: &modifiedAt, fileManager: fileManager)
        do {
            let coordinates = try SkillPackageValidator.unpinnedCoordinates(for: entries, limits: limits)
            return CloudSaveFolder(key: key(forFolderName: directory.lastPathComponent), directory: directory,
                entries: entries, coordinates: coordinates, modifiedAt: modifiedAt)
        } catch let error as SkillPackageValidationError {
            throw ReadError.invalid(error.code)
        }
    }

    private static func collect(_ directory: URL, prefix: String, into entries: inout [SkillPackageEntry],
                                modifiedAt: inout Date, fileManager: FileManager) throws {
        let names: [String]
        do { names = try fileManager.contentsOfDirectory(atPath: directory.path) }
        catch { throw ReadError.unreadable }
        for name in names.sorted() where !ignoredNames.contains(name) {
            let url = directory.appendingPathComponent(name)
            let path = prefix.isEmpty ? name : "\(prefix)/\(name)"
            let values = try? url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .isRegularFileKey])
            if values?.isSymbolicLink == true { throw ReadError.containsLink(path) }
            if values?.isDirectory == true {
                try collect(url, prefix: path, into: &entries, modifiedAt: &modifiedAt, fileManager: fileManager)
                continue
            }
            guard values?.isRegularFile == true else { throw ReadError.invalid(.unsupportedEntryType) }
            if entries.count >= limits.maximumFileCount { throw ReadError.invalid(.tooManyFiles) }
            let attributes = try? fileManager.attributesOfItem(atPath: url.path)
            if let size = attributes?[.size] as? Int, size > limits.maximumFileBytes {
                throw ReadError.invalid(.fileTooLarge)
            }
            guard let data = try? Data(contentsOf: url) else { throw ReadError.unreadable }
            let permissions = (attributes?[.posixPermissions] as? Int) ?? 0
            if let changed = attributes?[.modificationDate] as? Date, changed > modifiedAt { modifiedAt = changed }
            entries.append(SkillPackageEntry(path: path, mode: permissions & 0o111 != 0 ? "100755" : "100644",
                data: data, blobSha: SkillIdentityResolver.gitBlobSHA(for: data)))
        }
    }
}
