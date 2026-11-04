import Foundation
import Observation

/// "Make versions match" on the website opens `omgskills://match?name=<skill>`. The app shows the skill's
/// versions on this Mac (newest picked), and on confirm replaces every other copy with the chosen one. The old
/// copies go to the Trash, so it can be undone. A link alone never changes anything.
enum SkillVersionMatch {
    struct Version: Equatable {
        let sha: String
        let copies: [Skill]
        let modified: Date?
    }

    /// The skill name in a match link, or nil for anything that is not exactly one.
    static func name(from url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "omgskills", components.host?.lowercased() == "match",
              components.path.isEmpty, components.fragment == nil,
              components.user == nil, components.password == nil, components.port == nil,
              let items = components.queryItems, items.count == 1, items[0].name == "name",
              let name = items[0].value?.trimmingCharacters(in: .whitespaces), !name.isEmpty, name.count <= 200,
              name.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
        else { return nil }
        return name
    }

    /// The skill's copies grouped by SKILL.md content, newest first. Copies without a readable SKILL.md are left out.
    static func versions(named name: String, in installations: [Skill],
                         modified: (Skill) -> Date? = SkillVersionMatch.modified) -> [Version] {
        let copies = SkillRemoval.copies(named: [name], in: installations).filter { $0.skillMdSha?.isEmpty == false }
        let grouped = Dictionary(grouping: copies) { $0.skillMdSha!.lowercased() }
        return grouped.map { sha, copies in
            Version(sha: sha, copies: copies, modified: copies.compactMap(modified).max())
        }.sorted { ($0.modified ?? .distantPast, $0.copies.count) > ($1.modified ?? .distantPast, $1.copies.count) }
    }

    /// When a copy's SKILL.md last changed (through any link).
    static func modified(_ copy: Skill) -> Date? {
        let file = URL(fileURLWithPath: copy.installCmd).appendingPathComponent("SKILL.md").resolvingSymlinksInPath()
        return (try? FileManager.default.attributesOfItem(atPath: file.path))?[.modificationDate] as? Date
    }

    enum ReplaceError: Error, Equatable {
        /// The old copy is in the Trash but the new one couldn't be put in its place.
        case trashedNotReplaced
    }

    /// Replaces `target` with `source`: prepare beside it first, then trash the old one, then move the new one in.
    /// A linked copy stays a link (now to `source`), so whatever kept it linked keeps working; a folder gets a copy.
    /// If anything fails the old copy stays, or is in the Trash and the error says so; nothing half-written is left.
    nonisolated static func replace(_ target: Skill, with source: URL, fileManager: FileManager = .default,
                                    trash: (Skill) throws -> Void) throws {
        let destination = URL(fileURLWithPath: target.installCmd)
        let isLink = (try? destination.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true
        let staged = destination.deletingLastPathComponent()
            .appendingPathComponent(".omgskills-match-\(UUID().uuidString)", isDirectory: true)
        do {
            if isLink { try fileManager.createSymbolicLink(at: staged, withDestinationURL: source) }
            else { try fileManager.copyItem(at: source, to: staged) }
        } catch {
            try? fileManager.removeItem(at: staged)
            throw error
        }
        do { try trash(target) } catch {
            try? fileManager.removeItem(at: staged)
            throw error
        }
        do { try fileManager.moveItem(at: staged, to: destination) } catch {
            try? fileManager.removeItem(at: staged)
            throw ReplaceError.trashedNotReplaced
        }
    }

    /// Copies of the skill whose SKILL.md couldn't be read; they are never changed.
    static func unreadable(named name: String, in installations: [Skill]) -> Int {
        SkillRemoval.copies(named: [name], in: installations).filter { $0.skillMdSha?.isEmpty != false }.count
    }
}

@MainActor
@Observable
final class SkillVersionMatchController {
    enum State: Equatable {
        case idle
        case choose(name: String, versions: [SkillVersionMatch.Version])
        case working(name: String)
        case alreadyMatching(name: String)
        case notFound(name: String)
        case done(name: String, message: String)
        case failed(message: String)
    }

    private(set) var state: State = .idle
    var selected: String?
    var onChanged: () -> Void = {}

    @ObservationIgnored private let installations: () -> [Skill]
    @ObservationIgnored private let replace: @Sendable (Skill, URL) throws -> Void

    init(installations: @escaping () -> [Skill], trash: @escaping @Sendable (Skill) throws -> Void,
         replace: (@Sendable (Skill, URL) throws -> Void)? = nil) {
        self.installations = installations
        self.replace = replace ?? { target, source in try SkillVersionMatch.replace(target, with: source, trash: trash) }
    }

    var isActive: Bool { state != .idle }
    var isWorking: Bool { if case .working = state { true } else { false } }

    /// Returns true for any match link, so it never reaches the installer. A newer link replaces an open question.
    func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "omgskills", url.host?.lowercased() == "match" else { return false }
        guard !isWorking else { return true }
        guard let name = SkillVersionMatch.name(from: url) else {
            state = .failed(message: "This link is invalid.")
            return true
        }
        let versions = SkillVersionMatch.versions(named: name, in: installations())
        selected = versions.first?.sha
        state = versions.isEmpty ? .notFound(name: name)
            : versions.count == 1 ? .alreadyMatching(name: name) : .choose(name: name, versions: versions)
        return true
    }

    /// File work runs off the main thread so a large skill never freezes the menu bar.
    func confirm() async {
        guard case .choose(let name, let asked) = state, let keep = selected else { return }
        // Read again: only replace copies that were shown and are still there; never touch anything new.
        let shown = Set(asked.flatMap(\.copies).map(SkillRemoval.location))
        let now = SkillVersionMatch.versions(named: name, in: installations())
        guard let chosen = now.first(where: { $0.sha == keep }),
              let source = chosen.copies.first.map({ URL(fileURLWithPath: $0.installCmd).resolvingSymlinksInPath() })
        else { state = .failed(message: "That version is no longer on this Mac. Nothing was changed."); return }
        let targets = now.filter { $0.sha != keep }.flatMap(\.copies).filter { shown.contains(SkillRemoval.location($0)) }
        let skipped = SkillVersionMatch.unreadable(named: name, in: installations())
        state = .working(name: name)
        let replace = self.replace
        let outcome = await Task.detached { () -> (replaced: Int, failed: [String], lost: [String]) in
            var replaced = 0, failed: [String] = [], lost: [String] = []
            for target in targets {
                do { try replace(target, source); replaced += 1 }
                catch SkillVersionMatch.ReplaceError.trashedNotReplaced { lost.append(target.origin ?? "Agent") }
                catch { failed.append(target.origin ?? "Agent") }
            }
            return (replaced, failed, lost)
        }.value
        if outcome.replaced > 0 || !outcome.lost.isEmpty { onChanged() }
        let agents = { (list: [String]) in Set(list).sorted().joined(separator: ", ") }
        if !outcome.lost.isEmpty {
            state = .failed(message: "The old \(agents(outcome.lost)) copy is in the Trash, but the new one couldn't be "
                + "put in its place. Put it back from the Trash.")
        } else if !outcome.failed.isEmpty {
            state = .failed(message: "Couldn't update the \(agents(outcome.failed)) copy. "
                + (outcome.replaced > 0 ? "The others were updated." : "Nothing was changed."))
        } else {
            state = .done(name: name, message: "These copies now have the chosen version. Old copies are in the Trash."
                + (skipped > 0 ? " \(skipped == 1 ? "1 copy" : "\(skipped) copies") without a readable SKILL.md were left alone." : ""))
        }
    }

    func close() {
        guard !isWorking else { return }
        state = .idle
        selected = nil
    }
}

#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI

struct SkillVersionMatchView: View {
    @Bindable var controller: SkillVersionMatchController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch controller.state {
            case .idle:
                EmptyView()
            case .choose(let name, let versions):
                Text("Make \(name) match").font(.headline)
                Text("Pick the version every agent should use. Other copies go to the Trash; linked copies will link to it.")
                    .font(.callout).foregroundStyle(.secondary)
                ForEach(Array(versions.enumerated()), id: \.element.sha) { index, version in
                    Button { controller.selected = version.sha } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: controller.selected == version.sha ? "largecircle.fill.circle" : "circle")
                                .foregroundStyle(controller.selected == version.sha ? Color.accentColor : .secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(SkillRemoval.agents(version.copies)).font(.callout.weight(.semibold))
                                Text(Self.caption(version, newest: index == 0)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }.contentShape(Rectangle())
                    }.buttonStyle(.plain)
                        .help(version.copies.map(\.installCmd).joined(separator: "\n"))
                }
                VStack(spacing: 6) {
                    Button { Task { await controller.confirm() } } label: { Text("Use this version").frame(maxWidth: .infinity) }
                        .keyboardShortcut(.defaultAction)
                    Button { controller.close() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                        .keyboardShortcut(.cancelAction)
                }
            case .working(let name):
                ProgressView("Updating \(name)…").controlSize(.small)
            case .alreadyMatching(let name):
                Text("\(name) already matches").font(.headline)
                Text("Every copy on this Mac has the same version.").font(.callout).foregroundStyle(.secondary)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .notFound(let name):
                Text("\(name) isn't on this Mac.").font(.headline)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .done(let name, let message):
                Text("Updated \(name)").font(.headline)
                Text(message).font(.callout).foregroundStyle(.secondary)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .failed(let message):
                Text(message).font(.callout).foregroundStyle(.red)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            }
        }
    }

    static func caption(_ version: SkillVersionMatch.Version, newest: Bool) -> String {
        let date = version.modified.map { "Changed " + $0.formatted(date: .abbreviated, time: .omitted) } ?? "Date unknown"
        return newest ? date + " · newest" : date
    }
}
#endif
