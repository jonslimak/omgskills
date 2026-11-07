import Foundation

/// One skill folder on this Mac, read as a package ready for cloud save.
struct CloudSaveFolder: Equatable, Sendable {
    let key: String
    let directory: URL
    let entries: [SkillPackageEntry]
    let coordinates: SkillPackageCoordinates
    /// When any file in the folder last changed.
    let modifiedAt: Date
    /// The skill's SKILL.md name, sent with each save so a different skill never saves over it.
    var name: String? = nil

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
        /// A link points somewhere cloud save never reads, such as keys, settings or other apps' data.
        case privateLink(String)
        case invalid(SkillPackageValidationFailureCode)
    }

    /// Which links a skill folder may follow. Without one, any link inside a folder stops it being saved.
    struct LinkPolicy: Equatable, Sendable {
        let home: URL
        /// Where older omgskills versions kept library repos and linked skills into.
        let libraryRoot: URL

        /// Hidden folders in the home folder that hold skills; any other hidden folder holds settings or keys.
        private static let agentFolders: Set<String> = [".claude", ".codex", ".agents", ".cursor"]

        enum Target: Equatable { case library, own, privateFile }

        func reachesThroughLink(_ url: URL) -> Bool {
            let homePath = home.standardizedFileURL.path
            let path = url.standardizedFileURL.path
            guard path.hasPrefix(homePath + "/") else {
                return (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink == true
            }
            var current = home.standardizedFileURL
            for component in path.dropFirst(homePath.count + 1).split(separator: "/") {
                current.appendPathComponent(String(component))
                if (try? current.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink == true { return true }
            }
            return false
        }

        func classify(_ target: URL) -> Target {
            let path = target.resolvingSymlinksInPath().standardizedFileURL.path
            let library = libraryRoot.resolvingSymlinksInPath().standardizedFileURL.path
            if path == library || path.hasPrefix(library + "/") {
                // Library copies are public, but a repo's hidden files (.git holds its settings) are never read.
                let inside = path.dropFirst(library.count).split(separator: "/")
                return inside.contains { $0.hasPrefix(".") } ? .privateFile : .library
            }
            let homePath = home.resolvingSymlinksInPath().standardizedFileURL.path
            guard path.hasPrefix(homePath + "/") else { return .privateFile }
            let parts = path.dropFirst(homePath.count + 1).split(separator: "/").map(String.init)
            guard let first = parts.first, first != "Library" else { return .privateFile }
            for (index, part) in parts.enumerated() where part.hasPrefix(".") {
                // Agent folders also hold sign-in and settings files (~/.codex/auth.json); only their skills folder is read.
                if index == 0 && Self.agentFolders.contains(part) && parts.count > 2 && parts[1] == "skills" { continue }
                return .privateFile
            }
            return .own
        }

        /// A skill copied from someone else can carry links (git keeps them), so a link inside a skill is
        /// followed only within the skill's own folder or to another installed skill. Anything else, such as
        /// Documents, Desktop, Downloads or a project folder, means the skill isn't saved.
        func follows(_ target: URL, root: URL) -> Bool {
            let path = target.resolvingSymlinksInPath().standardizedFileURL.path
            let rootPath = root.resolvingSymlinksInPath().standardizedFileURL.path
            if path.hasPrefix(rootPath + "/") { return true }
            let parts = relativeParts(path)
            return parts.count > 2 && Self.agentFolders.contains(parts[0]) && parts[1] == "skills"
        }

        /// Whether the path is a skill folder or inside one, below the home folder itself.
        func insideSkill(_ path: String) -> Bool {
            var folder = home.resolvingSymlinksInPath().standardizedFileURL.path
            for part in relativeParts(path) {
                folder += "/" + part
                if FileManager.default.fileExists(atPath: folder + "/SKILL.md") { return true }
            }
            return false
        }

        private func relativeParts(_ path: String) -> [String] {
            let homePath = home.resolvingSymlinksInPath().standardizedFileURL.path
            guard path.hasPrefix(homePath + "/") else { return [] }
            return path.dropFirst(homePath.count + 1).split(separator: "/").map(String.init)
        }
    }

    /// A skill's identity across agents and Macs, matching the server: the folder name, NFC and lower case.
    /// Nothing is trimmed; the server refuses names it can't store, and that skill is reported, not saved.
    static func key(forFolderName name: String) -> String {
        // JavaScript lowercases a word-final capital sigma to ς, Swift to σ; match the server and web.
        let characters = Array(name.precomposedStringWithCanonicalMapping)
        var result = ""
        for (index, character) in characters.enumerated() {
            // A capital sigma may carry accents in the same character ("Σ́").
            guard character.unicodeScalars.first == "Σ" else { result += character.lowercased(); continue }
            let afterLetter = characters[..<index].last(where: { !$0.isCaseIgnorable })?.isCased == true
            let beforeLetter = characters[(index + 1)...].first(where: { !$0.isCaseIgnorable })?.isCased == true
            result += afterLetter && !beforeLetter ? "ς" : "σ"
            result += String(String.UnicodeScalarView(character.unicodeScalars.dropFirst())).lowercased()
        }
        return result
    }

    /// `key`: the skill's cloud key when it isn't just the folder name (see CloudSaveKeys).
    static func read(directory: URL, key: String? = nil, links: LinkPolicy? = nil,
                     fileManager: FileManager = .default) throws -> CloudSaveFolder {
        let root = directory.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw ReadError.unreadable
        }
        let rootIsLink = links?.reachesThroughLink(directory) ?? false
        if let links {
            switch links.classify(root) {
            // Older omgskills versions kept library copies there and linked skills to them; they're saved like any skill.
            case .library: break
            case .privateFile where rootIsLink: throw ReadError.privateLink(directory.lastPathComponent)
            // A skill folder linked to somewhere that isn't a skill, such as the Desktop.
            case .own where rootIsLink && !links.insideSkill(root.standardizedFileURL.path):
                throw ReadError.privateLink(directory.lastPathComponent)
            default: break
            }
        }
        var reader = Reader(links: links, root: root, fileManager: fileManager, visited: [root.standardizedFileURL.path])
        try reader.collect(root, prefix: "", throughLink: links != nil && rootIsLink)
        let entries = reader.entries, modifiedAt = reader.modifiedAt
        do {
            let coordinates = try SkillPackageValidator.unpinnedCoordinates(for: entries, limits: limits)
            return CloudSaveFolder(key: key ?? Self.key(forFolderName: directory.lastPathComponent), directory: directory,
                entries: entries, coordinates: coordinates, modifiedAt: modifiedAt)
        } catch let error as SkillPackageValidationError {
            throw ReadError.invalid(error.code)
        }
    }

    private struct Reader {
        let links: LinkPolicy?
        /// The skill's own folder; its links may not leave it except to another installed skill.
        let root: URL
        let fileManager: FileManager
        /// Folders already read, so a link back up the tree can't loop.
        var visited: Set<String>
        var entries: [SkillPackageEntry] = []
        var modifiedAt = Date.distantPast

        /// `throughLink`: this folder was reached by following a link, so it may be a project folder
        /// holding hidden files such as .env; those are never read.
        mutating func collect(_ directory: URL, prefix: String, throughLink: Bool) throws {
            let names: [String]
            do { names = try fileManager.contentsOfDirectory(atPath: directory.path) }
            catch { throw ReadError.unreadable }
            for name in names.sorted() where !ignoredNames.contains(name) && !(throughLink && name.hasPrefix(".")) {
                var url = directory.appendingPathComponent(name)
                let path = prefix.isEmpty ? name : "\(prefix)/\(name)"
                var values = try? url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .isRegularFileKey])
                var followed = throughLink
                if values?.isSymbolicLink == true {
                    guard let links else { throw ReadError.containsLink(path) }
                    let target = url.resolvingSymlinksInPath()
                    switch links.classify(target) {
                    case .library: break
                    case .privateFile: throw ReadError.privateLink(path)
                    case .own: guard links.follows(target, root: root) else { throw ReadError.privateLink(path) }
                    }
                    // Read what the link points to as if it were here.
                    url = target
                    followed = true
                    values = try? url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .isRegularFileKey])
                    guard values?.isDirectory == true || values?.isRegularFile == true else { throw ReadError.containsLink(path) }
                }
                if values?.isDirectory == true {
                    guard visited.insert(url.standardizedFileURL.path).inserted else { throw ReadError.containsLink(path) }
                    try collect(url, prefix: path, throughLink: followed)
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
}

private extension Character {
    var isCased: Bool { unicodeScalars.contains { $0.properties.isCased } }
    var isCaseIgnorable: Bool { unicodeScalars.allSatisfy { $0.properties.isCaseIgnorable } }
}
