import Foundation
import Observation

/// "Restore" on the website opens `omgskills://restore?name=<skill>&key=<saved key>&version=<id>`. The app checks
/// that version is one of this account's saved versions, asks first, downloads it (checked against its hashes),
/// and puts it in place of every copy on this Mac. Current copies go to the Trash. A link alone changes nothing.
enum SkillRestore {
    struct Request: Equatable {
        let name: String
        let key: String
        let versionID: String
    }

    static func request(from url: URL) -> Request? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "omgskills", components.host?.lowercased() == "restore",
              components.path.isEmpty, components.fragment == nil,
              components.user == nil, components.password == nil, components.port == nil,
              let items = components.queryItems, items.count == 3
        else { return nil }
        var values: [String: String] = [:]
        for item in items {
            guard ["name", "key", "version"].contains(item.name), values[item.name] == nil,
                  let value = item.value?.trimmingCharacters(in: .whitespaces), !value.isEmpty, value.count <= 200,
                  value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
            else { return nil }
            values[item.name] = value
        }
        guard let name = values["name"], let key = values["key"], let version = values["version"],
              version.range(of: "^[0-9a-fA-F-]{16,100}$", options: .regularExpression) != nil,
              !key.contains("/"), key != ".", key != ".."
        else { return nil }
        return Request(name: name, key: key, versionID: version)
    }

    /// The copies a restore link may replace: same skill name and saved under the link's key (its folder name),
    /// so one skill's saved files can never land on another skill.
    static func copies(for request: Request, in installations: [Skill]) -> [Skill] {
        SkillRemoval.copies(named: [request.name], in: installations).filter {
            CloudSaveFolder.key(forFolderName: URL(fileURLWithPath: $0.installCmd).lastPathComponent) == request.key
        }
    }

    /// Writes a downloaded version to a new folder (already checked by the download).
    nonisolated static func write(_ package: SkillPackage, to folder: URL, fileManager: FileManager = .default) throws {
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        for entry in package.entries {
            let destination = folder.appendingPathComponent(entry.path, isDirectory: false)
            guard destination.standardizedFileURL.path.hasPrefix(folder.standardizedFileURL.path + "/") else {
                throw CocoaError(.fileWriteInvalidFileName)
            }
            try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try entry.data.write(to: destination, options: .atomic)
            try fileManager.setAttributes([.posixPermissions: entry.mode == "100755" ? 0o755 : 0o644],
                                          ofItemAtPath: destination.path)
        }
    }

    /// Restores into every copy: the first real folder gets the downloaded files, then the others follow it
    /// (links link to it, folders get a copy). Returns the agents that failed, and those left empty-handed.
    nonisolated static func restore(_ copies: [Skill], from downloaded: URL,
                                    trash: @escaping @Sendable (Skill) throws -> Void) -> (replaced: Int, failed: [String], lost: [String]) {
        let isLink = { (copy: Skill) in
            (try? URL(fileURLWithPath: copy.installCmd).resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true
        }
        guard let primary = copies.first(where: { !isLink($0) }) ?? copies.first else { return (0, [], []) }
        var replaced = 0, failed: [String] = [], lost: [String] = []
        func attempt(_ copy: Skill, source: URL, alwaysCopy: Bool) -> Bool {
            do { try SkillVersionMatch.replace(copy, with: source, alwaysCopy: alwaysCopy, trash: trash); replaced += 1; return true }
            catch SkillVersionMatch.ReplaceError.trashedNotReplaced { lost.append(copy.origin ?? "Agent") }
            catch { failed.append(copy.origin ?? "Agent") }
            return false
        }
        guard attempt(primary, source: downloaded, alwaysCopy: true) else { return (replaced, failed, lost) }
        let primaryFolder = URL(fileURLWithPath: primary.installCmd)
        for copy in copies where copy.installCmd != primary.installCmd {
            _ = attempt(copy, source: primaryFolder, alwaysCopy: false)
        }
        return (replaced, failed, lost)
    }
}

@MainActor
@Observable
final class SkillRestoreController {
    enum State: Equatable {
        case idle
        case checking(name: String)
        case confirm(request: SkillRestore.Request, version: CloudSavedVersion, copies: [Skill])
        case working(name: String)
        case alreadyRestored(name: String)
        case done(name: String, message: String)
        case failed(message: String)
    }

    private(set) var state: State = .idle
    var onChanged: () -> Void = {}

    @ObservationIgnored private let installations: () -> [Skill]
    @ObservationIgnored private let credential: () -> StoredDeviceCredential?
    @ObservationIgnored private let versions: (String, StoredDeviceCredential) async throws -> [CloudSavedVersion]
    @ObservationIgnored private let download: (String, GroupManifestRelease, StoredDeviceCredential) async throws -> SkillPackage
    @ObservationIgnored private let trash: @Sendable (Skill) throws -> Void
    @ObservationIgnored private var attempt = UUID()

    init(installations: @escaping () -> [Skill],
         credential: @escaping () -> StoredDeviceCredential?,
         versions: @escaping (String, StoredDeviceCredential) async throws -> [CloudSavedVersion],
         download: @escaping (String, GroupManifestRelease, StoredDeviceCredential) async throws -> SkillPackage,
         trash: @escaping @Sendable (Skill) throws -> Void) {
        self.installations = installations
        self.credential = credential
        self.versions = versions
        self.download = download
        self.trash = trash
    }

    var isActive: Bool { state != .idle }
    /// While files are being replaced nothing else may start or close this.
    var isWorking: Bool { if case .working = state { true } else { false } }

    /// Returns true for any restore link. A newer link replaces an open question, never a restore in progress.
    func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "omgskills", url.host?.lowercased() == "restore" else { return false }
        guard !isWorking else { return true }
        guard let request = SkillRestore.request(from: url) else {
            state = .failed(message: "This restore link is invalid.")
            return true
        }
        let id = UUID()
        attempt = id
        state = .checking(name: request.name)
        Task { await check(request, attempt: id) }
        return true
    }

    private func check(_ request: SkillRestore.Request, attempt id: UUID) async {
        guard let credential = credential() else {
            return finish(id, .failed(message: "Connect this Mac to your account to restore skills."))
        }
        let copies = SkillRestore.copies(for: request, in: installations())
        guard !copies.isEmpty else {
            return finish(id, .failed(message: "\(request.name) isn't on this Mac, so there's nothing to restore into."))
        }
        do {
            // Only this account's own saved versions can be restored.
            guard let version = try await versions(request.key, credential).first(where: { $0.id == request.versionID }) else {
                return finish(id, .failed(message: "That saved version wasn't found. Nothing was changed."))
            }
            // Every copy already has that SKILL.md: nothing to put back.
            if copies.allSatisfy({ $0.skillMdSha?.lowercased() == version.skillMdSha.lowercased() }) {
                return finish(id, .alreadyRestored(name: request.name))
            }
            finish(id, .confirm(request: request, version: version, copies: copies))
        } catch {
            finish(id, .failed(message: "Couldn't reach your saved versions. Check your connection and try again."))
        }
    }

    private func finish(_ id: UUID, _ next: State) {
        guard attempt == id else { return }
        state = next
    }

    func confirm() async {
        guard case .confirm(let request, let version, let asked) = state, let credential = credential() else { return }
        let id = attempt
        state = .working(name: request.name)
        let shown = Set(asked.map(SkillRemoval.location))
        let copies = SkillRestore.copies(for: request, in: installations()).filter { shown.contains(SkillRemoval.location($0)) }
        guard !copies.isEmpty else {
            return finish(id, .failed(message: "\(request.name) is no longer on this Mac. Nothing was changed."))
        }
        let package: SkillPackage
        do { package = try await download(version.sourceId, version.release, credential) }
        catch GroupSkillPackageLoaderError.contentReadRequired {
            return finish(id, .failed(message: "Reconnect this Mac to your account to allow downloads, then try again."))
        } catch { return finish(id, .failed(message: "Couldn't download that version. Nothing was changed.")) }
        let trash = self.trash
        let outcome = await Task.detached { () -> (replaced: Int, failed: [String], lost: [String])? in
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("omgskills-restore-\(UUID().uuidString)")
            defer { try? FileManager.default.removeItem(at: folder) }
            do { try SkillRestore.write(package, to: folder) } catch { return nil }
            return SkillRestore.restore(copies, from: folder, trash: trash)
        }.value
        guard let outcome else { return finish(id, .failed(message: "Couldn't prepare that version. Nothing was changed.")) }
        if outcome.replaced > 0 || !outcome.lost.isEmpty { onChanged() }
        let agents = { (list: [String]) in Set(list).sorted().joined(separator: ", ") }
        if !outcome.lost.isEmpty {
            finish(id, .failed(message: "The old \(agents(outcome.lost)) copy is in the Trash, but the restored one couldn't be "
                + "put in its place. Put it back from the Trash."))
        } else if !outcome.failed.isEmpty {
            finish(id, .failed(message: "Couldn't restore the \(agents(outcome.failed)) copy. "
                + (outcome.replaced > 0 ? "The others were restored." : "Nothing was changed.")))
        } else {
            finish(id, .done(name: request.name, message: "Restored. The copies it replaced are in the Trash."))
        }
    }

    func close() {
        guard !isWorking else { return }
        attempt = UUID()
        state = .idle
    }
}

#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI

struct SkillRestoreView: View {
    let controller: SkillRestoreController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch controller.state {
            case .idle:
                EmptyView()
            case .checking(let name):
                ProgressView("Checking \(name)…").controlSize(.small)
                Button("Cancel") { controller.close() }.keyboardShortcut(.cancelAction)
            case .confirm(let request, let version, let copies):
                Text("Restore \(request.name)?").font(.headline)
                Text("Puts the version saved \(Self.date(version.savedAt)) in place of the copies in \(SkillRemoval.agents(copies)). "
                    + "Current copies go to the Trash.")
                    .font(.callout).foregroundStyle(.secondary)
                    .help(copies.map(\.installCmd).joined(separator: "\n"))
                VStack(spacing: 6) {
                    Button { Task { await controller.confirm() } } label: { Text("Restore").frame(maxWidth: .infinity) }
                        .keyboardShortcut(.defaultAction)
                    Button { controller.close() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                        .keyboardShortcut(.cancelAction)
                }
            case .working(let name):
                ProgressView("Restoring \(name)…").controlSize(.small)
            case .alreadyRestored(let name):
                Text("\(name) already has that version").font(.headline)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .done(let name, let message):
                Text("Restored \(name)").font(.headline)
                Text(message).font(.callout).foregroundStyle(.secondary)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .failed(let message):
                Text(message).font(.callout).foregroundStyle(.red)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            }
        }
    }

    static func date(_ savedAt: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: savedAt) else { return savedAt }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
#endif
