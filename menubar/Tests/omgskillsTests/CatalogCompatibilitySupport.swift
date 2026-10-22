#if DEBUG
import Foundation
import CryptoKit
@testable import omgskills

enum CompatibilityError: LocalizedError, CustomStringConvertible {
    case stopped(String)
    var description: String { switch self { case .stopped(let message): message } }
    var errorDescription: String? { description }
}

struct CompatibilityManifest: Decodable, Sendable {
    struct Entry: Decodable, Sendable {
        let id: String
        let agent: String
        let status: String
        let categories: [String]
        let record: CatalogInstallRecord
        let manualInstructionSHA256: String?
        var target: SkillInstaller.Target { agent == "claude" ? .claude : .codex }
    }
    let version: Int
    let sourceCommit: String
    let localOrigin: URL
    let manualRoot: String
    let cases: [Entry]

    static func load() throws -> Self {
        guard let url = Bundle.module.url(forResource: "catalog-compatibility-sample", withExtension: "json", subdirectory: "Fixtures")
        else { throw CompatibilityError.stopped("Missing fixed sample.") }
        let data = try Data(contentsOf: url)
        guard data.count < 256 * 1024 else { throw CompatibilityError.stopped("Sample exceeds test budget.") }
        let manifest = try JSONDecoder().decode(Self.self, from: data)
        try manifest.validate()
        return manifest
    }

    func validate() throws {
        guard version == 1, sourceCommit == "9c201c2d", cases.count == 20,
              Set(cases.map(\.id)).count == 20, cases.filter({ $0.status == "pending" }).count == 18,
              cases.filter({ $0.agent == "claude" }).count == 10, cases.filter({ $0.agent == "codex" }).count == 10,
              manualRoot.range(of: "^/private/tmp/omgskills-f1-[A-Za-z0-9-]+$", options: .regularExpression) != nil
        else { throw CompatibilityError.stopped("Sample count, targets or manual root changed.") }
        _ = try CatalogInstallRecordClient(localOrigin: localOrigin)
        var destinations = Set<String>()
        for entry in cases {
            guard ["claude", "codex"].contains(entry.agent), ["pending", "manual-passed"].contains(entry.status),
                  CatalogInstallRequest.validID(entry.id), entry.id == entry.record.id
            else { throw CompatibilityError.stopped("Invalid sample entry.") }
            let spec = try CompatibilitySourceSpec(entry.record.skill)
            guard destinations.insert(entry.agent + "/" + spec.name.lowercased()).inserted
            else { throw CompatibilityError.stopped("Two sample entries share a destination.") }
            let tags = Set(entry.categories)
            guard tags.contains(spec.pinned == nil ? "legacy" : "pinned"),
                  !tags.contains("missing-path") || entry.record.skillMDPath == nil,
                  !tags.contains("root") || spec.packageRoot == ".",
                  !tags.contains("old-alias") || spec.name != (spec.packageRoot == "." ? spec.repository.split(separator: "/").last.map(String.init) : spec.packageRoot.split(separator: "/").last.map(String.init)),
                  !tags.contains("dot-directory") || spec.packageRoot.split(separator: "/").contains(where: { $0.hasPrefix(".") })
            else { throw CompatibilityError.stopped("Coverage label does not match the record: " + entry.id) }
            if entry.status == "manual-passed" {
                guard ["anthropics/skills:skills/frontend-design/codex", "blader/humanizer/claude"].contains(entry.id + "/" + entry.agent),
                      entry.manualInstructionSHA256?.count == 64
                else { throw CompatibilityError.stopped("Unknown manual control.") }
            }
        }
    }
}

struct CompatibilitySourceSpec: Sendable {
    let repository: String
    let packageRoot: String
    let name: String
    let pinned: PinnedSkillInstallMetadata?
    var remote: String { "https://github.com/" + repository }

    init(_ skill: Skill) throws {
        switch skill.pinnedInstallMetadataState {
        case .invalid: throw CompatibilityError.stopped("Invalid catalog pin: " + skill.id)
        case .complete(let metadata):
            guard SkillInstaller.validatedRepositorySlug(from: skill.githubUrl) == metadata.repositorySlug
            else { throw CompatibilityError.stopped("Source and pin disagree: " + skill.id) }
            repository = metadata.repositorySlug; packageRoot = metadata.packageRoot; name = metadata.targetName; pinned = metadata
        case .legacy:
            try SkillInstaller.validateNewInstallationSpec(for: skill)
            let spec = try SkillInstaller.installationSpec(for: skill)
            repository = SkillInstaller.validatedRepositorySlug(from: skill.githubUrl)!
            packageRoot = spec.skillRelativePath; name = spec.targetName; pinned = nil
        }
    }
}

enum CompatibilitySourceTree: Equatable {
    case available(String)
    case unavailable(String)

    static func resolve(git: any GitCommandRunning, reference: URL, commit: String,
                        spec: CompatibilitySourceSpec, allowUnavailable: Bool) async throws -> Self {
        guard commit.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil else {
            throw CompatibilityError.stopped("Invalid fetched commit.")
        }
        if spec.packageRoot == "." {
            let data = try await git.run(arguments: ["--git-dir", reference.path, "rev-parse", commit + "^{tree}"], maximumOutputBytes: 1024)
            let tree = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            guard tree.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil else {
                throw CompatibilityError.stopped("Invalid root tree.")
            }
            return .available(tree)
        }
        // GitCommandRunner sets GIT_LITERAL_PATHSPECS=1; pathspec magic would become part of the name.
        let data = try await git.run(arguments: ["--git-dir", reference.path, "ls-tree", "-z", commit,
            "--", spec.packageRoot], maximumOutputBytes: 16 * 1024)
        if data.isEmpty {
            guard allowUnavailable, spec.pinned == nil else {
                throw CompatibilityError.stopped("Required package path is absent: " + spec.packageRoot)
            }
            return .unavailable("Package path '\(spec.packageRoot)' is absent at fetched commit \(commit).")
        }
        let rows = data.split(separator: 0)
        guard data.last == 0, rows.count == 1, let row = rows.first,
              let text = String(data: Data(row), encoding: .utf8), let tab = text.firstIndex(of: "\t")
        else { throw CompatibilityError.stopped("Invalid exact-path tree response.") }
        let header = text[..<tab].split(separator: " ")
        guard header.count == 3, header[0] == "040000", header[1] == "tree",
              header[2].range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil,
              String(text[text.index(after: tab)...]) == spec.packageRoot
        else { throw CompatibilityError.stopped("Package path is not the expected directory.") }
        return .available(String(header[2]))
    }
}

struct CompatibilityGitEntry: Codable, Equatable, Sendable {
    let path: String
    let mode: String
    let blobSHA: String
    let size: Int

    static func parse(_ data: Data) throws -> [Self] {
        guard data.count <= 2 * 1024 * 1024 else { throw CompatibilityError.stopped("Tree exceeds test budget.") }
        var result: [Self] = []
        for row in data.split(separator: 0) {
            guard let text = String(data: Data(row), encoding: .utf8), let tab = text.firstIndex(of: "\t")
            else { throw CompatibilityError.stopped("Unsupported tree encoding.") }
            let parts = text[..<tab].split(whereSeparator: \.isWhitespace)
            let path = String(text[text.index(after: tab)...])
            guard parts.count == 4, parts[1] == "blob", ["100644", "100755", "120000"].contains(String(parts[0])),
                  parts[2].range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil,
                  let size = Int(parts[3]), size >= 0, size <= 32 * 1024 * 1024,
                  validPath(path)
            else { throw CompatibilityError.stopped("Unsupported tree entry or file budget: " + path) }
            result.append(Self(path: path, mode: String(parts[0]), blobSHA: String(parts[2]), size: size))
        }
        guard result.count <= 5000, Set(result.map(\.path)).count == result.count,
              result.reduce(0, { $0 + $1.size }) <= 128 * 1024 * 1024,
              result.contains(where: { $0.path == "SKILL.md" && $0.mode != "120000" })
        else { throw CompatibilityError.stopped("Package exceeds test budget or lacks SKILL.md.") }
        return result.sorted { $0.path < $1.path }
    }

    static func validPath(_ path: String) -> Bool {
        !path.hasPrefix("/") && !path.contains("\\") && !path.utf8.contains(0)
            && path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !["", ".", "..", ".git"].contains(String($0)) }
    }
}

struct CompatibilityFile: Codable, Equatable, Sendable {
    let path: String
    let mode: String
    let bytes: Int
    let sha256: String
    let binary: Bool
}

struct CompatibilitySnapshot: Codable, Equatable, Sendable {
    let link: String
    let provenanceSHA256: String
    let files: [CompatibilityFile]
}

enum CompatibilityVerifier {
    static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func contained(_ url: URL, in root: URL) -> Bool {
        let base = root.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        return url.resolvingSymlinksInPath().standardizedFileURL.path.hasPrefix(base)
    }

    static func content(_ directory: URL, entries: [CompatibilityGitEntry], boundary: URL) throws -> [CompatibilityFile] {
        guard contained(directory, in: boundary) else { throw CompatibilityError.stopped("Destination escaped isolated root.") }
        let fm = FileManager.default
        let resolved = directory.resolvingSymlinksInPath()
        guard let enumerator = fm.enumerator(atPath: resolved.path) else {
            throw CompatibilityError.stopped("Cannot read installed contents.")
        }
        var actual = Set<String>()
        for case let relative as String in enumerator {
            let url = resolved.appendingPathComponent(relative)
            if relative == ".git" { enumerator.skipDescendants(); continue }
            let attributes = try fm.attributesOfItem(atPath: url.path)
            if attributes[.type] as? FileAttributeType == .typeDirectory { continue }
            actual.insert(relative)
        }
        guard actual == Set(entries.map(\.path)) else {
            throw CompatibilityError.stopped("Installed file inventory differs from Git: actual=\(actual.sorted()), expected=\(entries.map(\.path)).")
        }
        return try entries.map { entry in
            let file = resolved.appendingPathComponent(entry.path)
            let attributes = try fm.attributesOfItem(atPath: file.path)
            let data: Data
            if entry.mode == "120000" {
                guard attributes[.type] as? FileAttributeType == .typeSymbolicLink, contained(file, in: boundary) else {
                    throw CompatibilityError.stopped("Installed symlink type or containment differs.")
                }
                data = Data(try fm.destinationOfSymbolicLink(atPath: file.path).utf8)
            } else {
                guard attributes[.type] as? FileAttributeType == .typeRegular,
                      (attributes[.size] as? NSNumber)?.intValue == entry.size,
                      (((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0) & 0o111 != 0) == (entry.mode == "100755")
                else { throw CompatibilityError.stopped("Installed file type, size or executable bits differ: " + entry.path) }
                data = try Data(contentsOf: file)
            }
            guard data.count == entry.size, SkillIdentityResolver.gitBlobSHA(for: data) == entry.blobSHA else {
                throw CompatibilityError.stopped("Installed bytes differ from Git: " + entry.path)
            }
            return CompatibilityFile(path: entry.path, mode: entry.mode, bytes: data.count, sha256: hash(data), binary: data.contains(0))
        }
    }

    static func install(_ entry: CompatibilityManifest.Entry, spec: CompatibilitySourceSpec, paths: SkillFilesystemPaths,
                        boundary: URL, files: [CompatibilityGitEntry]) throws -> CompatibilitySnapshot {
        let targetRoot = paths.skillsRoot(for: entry.target)
        let destination = targetRoot.appendingPathComponent(spec.name)
        let link = try FileManager.default.destinationOfSymbolicLink(atPath: destination.path)
        let measured = try content(destination, entries: files, boundary: boundary)
        // Keep the activation link unresolved: its content link points onward to the shared package.
        let activationContent = link.hasPrefix("/") ? URL(fileURLWithPath: link) : targetRoot.appendingPathComponent(link)
        let record = spec.pinned == nil
            ? SkillInstallProvenanceStore.metadataURL(targetRoot: targetRoot, targetName: spec.name)
            : activationContent.deletingLastPathComponent().appendingPathComponent("provenance.json")
        guard contained(record, in: boundary) else { throw CompatibilityError.stopped("Install record escaped isolated root.") }
        let recordData = try Data(contentsOf: record)
        let provenance = try JSONDecoder().decode(SkillInstallProvenance.self, from: recordData)
        guard provenance.catalogSkillId == entry.id, provenance.githubUrl == entry.record.githubURL,
              provenance.skillMdSha == files.first(where: { $0.path == "SKILL.md" })?.blobSHA
        else { throw CompatibilityError.stopped("Install record differs from source.") }
        if let pin = spec.pinned {
            guard provenance.commitSha == pin.coordinates.commitSha, provenance.treeSha == pin.coordinates.treeSha else {
                throw CompatibilityError.stopped("Pinned install record differs from catalog.")
            }
        }
        if let expected = entry.manualInstructionSHA256 {
            guard measured.first(where: { $0.path == "SKILL.md" })?.sha256 == expected else {
                throw CompatibilityError.stopped("Manual control changed since acceptance.")
            }
        }
        return CompatibilitySnapshot(link: link, provenanceSHA256: hash(recordData), files: measured)
    }
}

struct CompatibilityAuditGit: GitCommandRunning {
    let base: any GitCommandRunning
    let legacyCommits: [String: String]
    let boundary: URL
    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        if arguments.first == "clone" {
            guard arguments.count == 3, let expected = legacyCommits[arguments[1]],
                  CompatibilityVerifier.contained(URL(fileURLWithPath: arguments[2]), in: boundary)
            else { throw CompatibilityError.stopped("Unexpected legacy clone.") }
            let data = try await base.run(arguments: arguments, maximumOutputBytes: maximumOutputBytes)
            let head = try await base.run(arguments: ["-C", arguments[2], "rev-parse", "HEAD"], maximumOutputBytes: 1024)
            guard String(decoding: head, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) == expected else {
                throw CompatibilityError.stopped("Legacy HEAD changed after preflight.")
            }
            return data
        }
        return try await base.run(arguments: arguments, maximumOutputBytes: maximumOutputBytes)
    }
}
#endif
