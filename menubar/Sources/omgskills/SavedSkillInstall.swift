import Foundation
import Observation

/// "Install" on the website, for a skill in My skills that isn't on this Mac, opens
/// `omgskills://install-saved?name=<skill>&key=<saved key>`. The app checks the account keeps that skill,
/// asks which agent gets it, downloads the newest saved version (checked against its hashes), and puts it in
/// that agent's skills folder. A link alone changes nothing, and it never replaces a folder already there.
enum SavedSkillInstall {
    struct Request: Equatable {
        let name: String
        let key: String
    }

    static func request(from url: URL) -> Request? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "omgskills", components.host?.lowercased() == "install-saved",
              components.path.isEmpty, components.fragment == nil,
              components.user == nil, components.password == nil, components.port == nil,
              let items = components.queryItems, items.count == 2
        else { return nil }
        var values: [String: String] = [:]
        for item in items {
            guard ["name", "key"].contains(item.name), values[item.name] == nil,
                  let value = item.value?.trimmingCharacters(in: .whitespaces), !value.isEmpty, value.count <= 200,
                  value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
            else { return nil }
            values[item.name] = value
        }
        // The key becomes the folder name, so it may only name one folder inside the skills folder.
        guard let name = values["name"], let key = values["key"], !key.contains("/"), !key.contains("\\"),
              !key.hasPrefix("."), key == CloudSaveFolder.key(forFolderName: key)
        else { return nil }
        return Request(name: name, key: key)
    }

    /// Copies already on this Mac under that key, in any agent folder.
    static func copies(for request: Request, in installations: [Skill]) -> [Skill] {
        installations.filter {
            CloudSaveFolder.key(forFolderName: URL(fileURLWithPath: $0.installCmd).lastPathComponent) == request.key
        }
    }

    /// Writes the package next to the destination, then moves it into place, so an agent never sees half a skill.
    /// Refuses when anything already has that name.
    nonisolated static func install(_ package: SkillPackage, key: String, into root: URL,
                                    fileManager: FileManager = .default) throws -> URL {
        let destination = root.appendingPathComponent(key, isDirectory: true)
        guard (try? fileManager.attributesOfItem(atPath: destination.path)) == nil else {
            throw CocoaError(.fileWriteFileExists)
        }
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        let staging = root.appendingPathComponent(".omgskills-install-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: staging) }
        try SkillRestore.write(package, to: staging)
        try fileManager.moveItem(at: staging, to: destination)
        return destination
    }
}

@MainActor
@Observable
final class SavedSkillInstallController {
    enum State: Equatable {
        case idle
        case checking(name: String)
        case choose(request: SavedSkillInstall.Request, version: CloudSavedVersion)
        case working(name: String)
        case alreadyHere(name: String, agents: String)
        case done(name: String, message: String)
        case failed(message: String)
    }

    private(set) var state: State = .idle
    var onChanged: () -> Void = {}

    @ObservationIgnored private let installations: () -> [Skill]
    @ObservationIgnored private let credential: () -> StoredDeviceCredential?
    @ObservationIgnored private let versions: (String, StoredDeviceCredential) async throws -> [CloudSavedVersion]
    @ObservationIgnored private let download: (String, GroupManifestRelease, StoredDeviceCredential) async throws -> SkillPackage
    @ObservationIgnored private let root: (SkillInstaller.Target) -> URL
    @ObservationIgnored private var attempt = UUID()

    init(installations: @escaping () -> [Skill],
         credential: @escaping () -> StoredDeviceCredential?,
         versions: @escaping (String, StoredDeviceCredential) async throws -> [CloudSavedVersion],
         download: @escaping (String, GroupManifestRelease, StoredDeviceCredential) async throws -> SkillPackage,
         root: @escaping (SkillInstaller.Target) -> URL) {
        self.installations = installations
        self.credential = credential
        self.versions = versions
        self.download = download
        self.root = root
    }

    var isActive: Bool { state != .idle }
    var isWorking: Bool { if case .working = state { true } else { false } }

    /// Returns true for any saved-skill install link. A newer link replaces an open question, never an install in progress.
    func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "omgskills", url.host?.lowercased() == "install-saved" else { return false }
        guard !isWorking else { return true }
        guard let request = SavedSkillInstall.request(from: url) else {
            state = .failed(message: "This install link is invalid.")
            return true
        }
        let id = UUID()
        attempt = id
        state = .checking(name: request.name)
        Task { await check(request, attempt: id) }
        return true
    }

    private func check(_ request: SavedSkillInstall.Request, attempt id: UUID) async {
        guard let credential = credential() else {
            return finish(id, .failed(message: "Connect this Mac to your account to install your skills."))
        }
        let here = SavedSkillInstall.copies(for: request, in: installations())
        if !here.isEmpty { return finish(id, .alreadyHere(name: request.name, agents: SkillRemoval.agents(here))) }
        do {
            // Only this account's own saved skills; the newest version is installed.
            guard let version = try await versions(request.key, credential).first else {
                return finish(id, .failed(message: "\(request.name) isn't saved in your account, so it can't be installed here."))
            }
            finish(id, .choose(request: request, version: version))
        } catch GroupSkillPackageLoaderError.contentReadRequired {
            finish(id, .failed(message: "Reconnect this Mac to your account to allow downloads, then try again."))
        } catch {
            finish(id, .failed(message: "Couldn't reach My skills. Check your connection and try again."))
        }
    }

    private func finish(_ id: UUID, _ next: State) {
        guard attempt == id else { return }
        state = next
    }

    func install(for target: SkillInstaller.Target) async {
        guard case .choose(let request, let version) = state, let credential = credential() else { return }
        let id = attempt
        state = .working(name: request.name)
        let here = SavedSkillInstall.copies(for: request, in: installations())
        guard here.isEmpty else { return finish(id, .alreadyHere(name: request.name, agents: SkillRemoval.agents(here))) }
        let package: SkillPackage
        do { package = try await download(version.sourceId, version.release, credential) }
        catch GroupSkillPackageLoaderError.contentReadRequired {
            return finish(id, .failed(message: "Reconnect this Mac to your account to allow downloads, then try again."))
        } catch { return finish(id, .failed(message: "Couldn't download \(request.name). Nothing was changed.")) }
        let root = root(target)
        let installed = await Task.detached { () -> Bool in
            (try? SavedSkillInstall.install(package, key: request.key, into: root)) != nil
        }.value
        guard installed else {
            return finish(id, .failed(message: "Couldn't put \(request.name) in the \(target.rawValue) skills folder. Nothing was changed."))
        }
        onChanged()
        finish(id, .done(name: request.name, message: "Installed for \(target.rawValue)."))
    }

    func close() {
        guard !isWorking else { return }
        attempt = UUID()
        state = .idle
    }
}

#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI

struct SavedSkillInstallView: View {
    let controller: SavedSkillInstallController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch controller.state {
            case .idle:
                EmptyView()
            case .checking(let name):
                ProgressView("Checking \(name)…").controlSize(.small)
                Button("Cancel") { controller.close() }.keyboardShortcut(.cancelAction)
            case .choose(let request, let version):
                Text("Install \(request.name)?").font(.headline)
                Text("From My skills, the version synced \(SkillRestoreView.date(version.savedAt)).")
                    .font(.callout).foregroundStyle(.secondary)
                VStack(spacing: 6) {
                    Button { Task { await controller.install(for: .claude) } } label: {
                        Text("Install for Claude").frame(maxWidth: .infinity)
                    }.keyboardShortcut(.defaultAction)
                    Button { Task { await controller.install(for: .codex) } } label: {
                        Text("Install for Codex").frame(maxWidth: .infinity)
                    }
                    Button { controller.close() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                        .keyboardShortcut(.cancelAction)
                }
            case .working(let name):
                ProgressView("Installing \(name)…").controlSize(.small)
            case .alreadyHere(let name, let agents):
                Text("\(name) is already on this Mac").font(.headline)
                Text("In \(agents).").font(.callout).foregroundStyle(.secondary)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .done(let name, let message):
                Text("Installed \(name)").font(.headline)
                Text(message).font(.callout).foregroundStyle(.secondary)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .failed(let message):
                Text(message).font(.callout).foregroundStyle(.red)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            }
        }
    }
}
#endif
