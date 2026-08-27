import CryptoKit
import Foundation

struct SkillPackageCoordinates: Equatable, Sendable {
    let commitSha: String
    let treeSha: String
    let skillMdSha: String
}

struct SkillPackageEntry: Equatable, Sendable {
    let path: String
    let mode: String
    let data: Data
    let blobSha: String
}

struct SkillPackage: Equatable, Sendable {
    let coordinates: SkillPackageCoordinates
    let entries: [SkillPackageEntry]
}

struct SkillPackageValidationLimits: Equatable, Sendable {
    let maximumFileCount: Int
    let maximumTotalBytes: Int
    let maximumFileBytes: Int
    let maximumSkillMdBytes: Int

    static let standard = SkillPackageValidationLimits(
        maximumFileCount: 512,
        maximumTotalBytes: 50 * 1024 * 1024,
        maximumFileBytes: 10 * 1024 * 1024,
        maximumSkillMdBytes: 2 * 1024 * 1024
    )
}

struct ValidatedSkillPackage: Equatable, Sendable {
    let coordinates: SkillPackageCoordinates
    let fileCount: Int
    let totalBytes: Int
}

enum SkillPackageValidationFailureCode: String, Codable, Equatable, Sendable {
    case invalidSha = "invalid_sha"
    case commitShaMismatch = "commit_sha_mismatch"
    case treeShaMismatch = "tree_sha_mismatch"
    case skillMdShaMismatch = "skill_md_sha_mismatch"
    case blobShaMismatch = "blob_sha_mismatch"
    case invalidPath = "invalid_path"
    case duplicatePath = "duplicate_path"
    case pathConflict = "path_conflict"
    case caseCollision = "case_collision"
    case symbolicLink = "symbolic_link"
    case submodule = "submodule"
    case unsupportedEntryType = "unsupported_entry_type"
    case tooManyFiles = "too_many_files"
    case fileTooLarge = "file_too_large"
    case skillMdTooLarge = "skill_md_too_large"
    case packageTooLarge = "package_too_large"
    case missingSkillMd = "missing_skill_md"
}

struct SkillPackageValidationError: LocalizedError, Equatable, Sendable {
    let code: SkillPackageValidationFailureCode
    let path: String?

    var errorDescription: String? {
        let subject = path.map { " at \($0)" } ?? ""
        switch code {
        case .invalidSha: return "Package contains an invalid Git SHA\(subject)"
        case .commitShaMismatch: return "Package commit SHA does not match the release"
        case .treeShaMismatch: return "Package tree SHA does not match the release"
        case .skillMdShaMismatch: return "SKILL.md SHA does not match the release"
        case .blobShaMismatch: return "File SHA does not match its bytes\(subject)"
        case .invalidPath: return "Package contains an unsafe path\(subject)"
        case .duplicatePath: return "Package contains a duplicate path\(subject)"
        case .pathConflict: return "Package contains a file and directory path conflict\(subject)"
        case .caseCollision: return "Package contains paths that collide on macOS\(subject)"
        case .symbolicLink: return "Package contains a symbolic link\(subject)"
        case .submodule: return "Package contains a Git submodule\(subject)"
        case .unsupportedEntryType: return "Package contains an unsupported entry type\(subject)"
        case .tooManyFiles: return "Package contains too many files"
        case .fileTooLarge: return "Package contains a file that is too large\(subject)"
        case .skillMdTooLarge: return "SKILL.md is too large"
        case .packageTooLarge: return "Package is too large"
        case .missingSkillMd: return "Package is missing a root SKILL.md"
        }
    }
}

enum SkillPackageValidator {
    private static let regularFileMode = "100644"
    private static let executableFileMode = "100755"
    private static let symbolicLinkMode = "120000"
    private static let submoduleMode = "160000"
    private static let posixLocale = Locale(identifier: "en_US_POSIX")

    static func validate(
        _ package: SkillPackage,
        expected: SkillPackageCoordinates,
        limits: SkillPackageValidationLimits = .standard
    ) throws -> ValidatedSkillPackage {
        let expectedCoordinates = try normalizedCoordinates(expected)
        let packageCoordinates = try normalizedCoordinates(package.coordinates)

        guard packageCoordinates.commitSha == expectedCoordinates.commitSha else {
            throw failure(.commitShaMismatch)
        }
        guard packageCoordinates.treeSha == expectedCoordinates.treeSha else {
            throw failure(.treeShaMismatch)
        }
        guard packageCoordinates.skillMdSha == expectedCoordinates.skillMdSha else {
            throw failure(.skillMdShaMismatch)
        }
        guard package.entries.count <= limits.maximumFileCount else {
            throw failure(.tooManyFiles)
        }

        var exactPaths = Set<Data>()
        var portablePathOwners: [Data: Data] = [:]
        let tree = TreeDirectory()
        var totalBytes = 0
        var actualSkillMdSha: String?

        for entry in package.entries {
            let components = try validatedPathComponents(entry.path)
            guard exactPaths.insert(Data(entry.path.utf8)).inserted else {
                throw failure(.duplicatePath, path: entry.path)
            }
            try validatePortablePath(
                components,
                originalPath: entry.path,
                owners: &portablePathOwners
            )
            try validateMode(entry.mode, path: entry.path)

            guard entry.data.count <= limits.maximumFileBytes else {
                throw failure(.fileTooLarge, path: entry.path)
            }
            if entry.path == "SKILL.md", entry.data.count > limits.maximumSkillMdBytes {
                throw failure(.skillMdTooLarge, path: entry.path)
            }

            let (newTotal, overflow) = totalBytes.addingReportingOverflow(entry.data.count)
            guard !overflow, newTotal <= limits.maximumTotalBytes else {
                throw failure(.packageTooLarge)
            }
            totalBytes = newTotal

            let declaredBlobSha = try normalizedSha(entry.blobSha, field: entry.path)
            let actualBlobSha = SkillIdentityResolver.gitBlobSHA(for: entry.data)
            guard declaredBlobSha == actualBlobSha else {
                throw failure(.blobShaMismatch, path: entry.path)
            }
            if entry.path == "SKILL.md" {
                actualSkillMdSha = actualBlobSha
            }

            try tree.insert(
                components: ArraySlice(components),
                file: TreeFile(mode: entry.mode, sha: actualBlobSha),
                fullPath: entry.path
            )
        }

        guard let actualSkillMdSha else {
            throw failure(.missingSkillMd)
        }
        guard actualSkillMdSha == expectedCoordinates.skillMdSha else {
            throw failure(.skillMdShaMismatch, path: "SKILL.md")
        }

        let actualTreeSha = try tree.sha()
        guard actualTreeSha == expectedCoordinates.treeSha else {
            throw failure(.treeShaMismatch)
        }

        return ValidatedSkillPackage(
            coordinates: expectedCoordinates,
            fileCount: package.entries.count,
            totalBytes: totalBytes
        )
    }

    private static func normalizedCoordinates(
        _ coordinates: SkillPackageCoordinates
    ) throws -> SkillPackageCoordinates {
        SkillPackageCoordinates(
            commitSha: try normalizedSha(coordinates.commitSha, field: "commitSha"),
            treeSha: try normalizedSha(coordinates.treeSha, field: "treeSha"),
            skillMdSha: try normalizedSha(coordinates.skillMdSha, field: "skillMdSha")
        )
    }

    private static func normalizedSha(_ value: String, field: String) throws -> String {
        guard value.utf8.count == 40, value.utf8.allSatisfy({ byte in
            (48...57).contains(byte) || (65...70).contains(byte) || (97...102).contains(byte)
        }) else {
            throw failure(.invalidSha, path: field)
        }
        return value.lowercased()
    }

    private static func validatedPathComponents(_ path: String) throws -> [String] {
        guard !path.isEmpty,
              !path.hasPrefix("/"),
              !path.contains("\\"),
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
        else {
            throw failure(.invalidPath, path: path)
        }

        let components = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !components.isEmpty, components.allSatisfy({ component in
            !component.isEmpty &&
                component != "." &&
                component != ".." &&
                component.lowercased(with: posixLocale) != ".git"
        }) else {
            throw failure(.invalidPath, path: path)
        }
        return components
    }

    private static func validatePortablePath(
        _ components: [String],
        originalPath: String,
        owners: inout [Data: Data]
    ) throws {
        for index in components.indices {
            let prefix = components[...index].joined(separator: "/")
            let portablePath = components[...index]
                .map {
                    $0.precomposedStringWithCanonicalMapping
                        .lowercased(with: posixLocale)
                }
                .joined(separator: "/")
            let portableKey = Data(portablePath.utf8)
            let ownerKey = Data(prefix.utf8)
            if let owner = owners[portableKey], owner != ownerKey {
                throw failure(.caseCollision, path: originalPath)
            }
            owners[portableKey] = ownerKey
        }
    }

    private static func validateMode(_ mode: String, path: String) throws {
        switch mode {
        case regularFileMode, executableFileMode:
            return
        case symbolicLinkMode:
            throw failure(.symbolicLink, path: path)
        case submoduleMode:
            throw failure(.submodule, path: path)
        default:
            throw failure(.unsupportedEntryType, path: path)
        }
    }

    private static func failure(
        _ code: SkillPackageValidationFailureCode,
        path: String? = nil
    ) -> SkillPackageValidationError {
        SkillPackageValidationError(code: code, path: path)
    }
}

private struct TreeFile {
    let mode: String
    let sha: String
}

private final class TreeDirectory {
    private var files: [String: TreeFile] = [:]
    private var directories: [String: TreeDirectory] = [:]

    func insert(
        components: ArraySlice<String>,
        file: TreeFile,
        fullPath: String
    ) throws {
        guard let name = components.first else {
            throw SkillPackageValidationError(code: .invalidPath, path: fullPath)
        }

        if components.count == 1 {
            guard files[name] == nil else {
                throw SkillPackageValidationError(code: .duplicatePath, path: fullPath)
            }
            guard directories[name] == nil else {
                throw SkillPackageValidationError(code: .pathConflict, path: fullPath)
            }
            files[name] = file
            return
        }

        guard files[name] == nil else {
            throw SkillPackageValidationError(code: .pathConflict, path: fullPath)
        }
        let child = directories[name] ?? TreeDirectory()
        directories[name] = child
        try child.insert(components: components.dropFirst(), file: file, fullPath: fullPath)
    }

    func sha() throws -> String {
        var objects = files.map { name, file in
            TreeObject(name: name, mode: file.mode, sha: file.sha, isDirectory: false)
        }
        for (name, directory) in directories {
            objects.append(
                TreeObject(name: name, mode: "40000", sha: try directory.sha(), isDirectory: true)
            )
        }
        objects.sort { lhs, rhs in
            lhs.sortKey.lexicographicallyPrecedes(rhs.sortKey)
        }

        var content = Data()
        for object in objects {
            content.append(Data("\(object.mode) \(object.name)\0".utf8))
            guard let shaBytes = Data(hexadecimal: object.sha) else {
                throw SkillPackageValidationError(code: .invalidSha, path: object.name)
            }
            content.append(shaBytes)
        }

        var object = Data("tree \(content.count)\0".utf8)
        object.append(content)
        return Insecure.SHA1.hash(data: object).map { String(format: "%02x", $0) }.joined()
    }
}

private struct TreeObject {
    let name: String
    let mode: String
    let sha: String
    let isDirectory: Bool

    var sortKey: [UInt8] {
        Array(name.utf8) + (isDirectory ? [UInt8(ascii: "/")] : [])
    }
}

private extension Data {
    init?(hexadecimal value: String) {
        guard value.count.isMultiple(of: 2) else { return nil }
        var bytes: [UInt8] = []
        bytes.reserveCapacity(value.count / 2)
        var index = value.startIndex
        while index < value.endIndex {
            let next = value.index(index, offsetBy: 2)
            guard let byte = UInt8(value[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}
