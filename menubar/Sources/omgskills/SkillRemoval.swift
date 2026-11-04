import Foundation
import Observation

/// "Delete from my Mac" on the website opens `omgskills://remove?name=<skill>[&name=<skill>...]`. The app finds
/// every copy of those skills in the agent folders, asks once, and moves them to the Trash. A link alone never
/// deletes anything.
enum SkillRemoval {
    /// One skill per name, the same rule the web and the skill count use.
    nonisolated static func normalizedName(_ name: String) -> String {
        name.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    static let maximumSkills = 200

    /// The skill names in a removal link (duplicates dropped, order kept), or nil if any part is invalid.
    static func names(from url: URL) -> [String]? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "omgskills",
              components.host?.lowercased() == "remove",
              components.path.isEmpty, components.fragment == nil,
              components.user == nil, components.password == nil, components.port == nil,
              let items = components.queryItems, !items.isEmpty, items.count <= maximumSkills
        else { return nil }
        var names: [String] = [], seen = Set<String>()
        for item in items {
            guard item.name == "name", let name = item.value?.trimmingCharacters(in: .whitespaces),
                  !name.isEmpty, name.count <= 200,
                  name.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
            else { return nil }
            if seen.insert(normalizedName(name)).inserted { names.append(name) }
        }
        return names
    }

    /// This Mac's copies of the skills; links go first so a linked folder is never emptied under them.
    /// A folder reached through two agent folders (one agent folder linked to another) counts once.
    static func copies(named names: [String], in installations: [Skill]) -> [Skill] {
        let targets = Set(names.map(normalizedName))
        var seen = Set<String>()
        return installations.filter { targets.contains(normalizedName($0.name)) }
            .sorted { ($0.isSymlink == true ? 0 : 1, $0.installCmd) < ($1.isSymlink == true ? 0 : 1, $1.installCmd) }
            .filter { seen.insert(location($0)).inserted }
    }

    /// Where a copy really is: its folder's resolved parent plus its own name (a linked copy is the link itself).
    static func location(_ copy: Skill) -> String {
        let url = URL(fileURLWithPath: copy.installCmd)
        return url.deletingLastPathComponent().resolvingSymlinksInPath().appendingPathComponent(url.lastPathComponent).path
    }


    /// The copies for each skill, in the order the skills were asked for.
    static func grouped(names: [String], copies: [Skill]) -> [(name: String, copies: [Skill])] {
        names.compactMap { name in
            let target = normalizedName(name)
            let mine = copies.filter { normalizedName($0.name) == target }
            return mine.isEmpty ? nil : (name, mine)
        }
    }

    /// "humanizer" for one skill, "3 skills" for several.
    static func title(_ names: [String]) -> String {
        names.count == 1 ? names[0] : "\(names.count) skills"
    }

    /// Agent names for the copies, e.g. "Agents, Claude, Codex".
    static func agents(_ copies: [Skill]) -> String {
        Set(copies.map { $0.origin ?? "Agent" }).sorted().joined(separator: ", ")
    }
}

@MainActor
@Observable
final class SkillRemovalController {
    enum State: Equatable {
        case idle
        /// `names` are the skills this Mac has; `missing` were asked for but are not here.
        case confirm(names: [String], copies: [Skill], missing: [String])
        case notFound(names: [String])
        case done(title: String, message: String)
        case failed(message: String)
    }

    private(set) var state: State = .idle
    var onRemoved: () -> Void = {}

    @ObservationIgnored private let installations: () -> [Skill]
    @ObservationIgnored private let trash: (Skill) throws -> InstalledSkillUninstaller.Result

    init(installations: @escaping () -> [Skill],
         trash: @escaping (Skill) throws -> InstalledSkillUninstaller.Result) {
        self.installations = installations
        self.trash = trash
    }

    var isActive: Bool { state != .idle }

    /// Returns true for any removal link, so it never reaches the installer.
    /// A newer link replaces any question still open, so the panel always asks about the skill last clicked.
    func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "omgskills", url.host?.lowercased() == "remove" else { return false }
        guard let names = SkillRemoval.names(from: url) else {
            state = .failed(message: "This delete link is invalid.")
            return true
        }
        let copies = SkillRemoval.copies(named: names, in: installations())
        let here = Set(copies.map { SkillRemoval.normalizedName($0.name) })
        let found = names.filter { here.contains(SkillRemoval.normalizedName($0)) }
        let missing = names.filter { !here.contains(SkillRemoval.normalizedName($0)) }
        state = copies.isEmpty ? .notFound(names: names) : .confirm(names: found, copies: copies, missing: missing)
        return true
    }

    func confirm() {
        guard case .confirm(let names, let asked, _) = state else { return }
        // Only copies that are still there and were shown; anything new since the question is left alone.
        let shown = Set(asked.map(SkillRemoval.location))
        let copies = SkillRemoval.copies(named: names, in: installations()).filter { shown.contains(SkillRemoval.location($0)) }
        var removed = 0, failures: [String] = []
        for copy in copies {
            do { _ = try trash(copy); removed += 1 }
            catch {
                // Already gone (e.g. trashed through a linked folder) is what was asked for.
                if (try? FileManager.default.attributesOfItem(atPath: copy.installCmd)) == nil { removed += 1 }
                else { failures.append(copy.origin ?? "Agent") }
            }
        }
        if removed > 0 { onRemoved() }
        state = failures.isEmpty
            ? .done(title: "Deleted \(SkillRemoval.title(names))",
                    message: "Moved to the Trash. To undo, put \(names.count == 1 ? "it" : "them") back from the Trash.")
            : .failed(message: "Couldn't delete \(failures.count == 1 ? "1 copy" : "\(failures.count) copies") (\(Set(failures).sorted().joined(separator: ", "))). "
                + (removed > 0 ? "Other copies were moved to the Trash." : "Nothing was deleted."))
    }

    func close() { state = .idle }
}

#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI

struct SkillRemovalView: View {
    let controller: SkillRemovalController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch controller.state {
            case .idle:
                EmptyView()
            case .confirm(let names, let copies, let missing):
                Text("Delete \(SkillRemoval.title(names)) from this Mac?").font(.headline)
                Text("Every copy moves to the Trash.").font(.callout).foregroundStyle(.secondary)
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(SkillRemoval.grouped(names: names, copies: copies), id: \.name) { skill in
                            VStack(alignment: .leading, spacing: 1) {
                                Text(skill.name).font(.callout.weight(.semibold)).lineLimit(1).truncationMode(.middle)
                                Text(SkillRemoval.agents(skill.copies)).font(.caption).foregroundStyle(.secondary)
                            }.help(skill.copies.map(\.installCmd).joined(separator: "\n"))
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxHeight: 160)
                if !missing.isEmpty {
                    Text("Not on this Mac: \(missing.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
                        .lineLimit(3)
                }
                VStack(spacing: 6) {
                    Button(role: .destructive) { controller.confirm() } label: {
                        Text("Move to Trash").frame(maxWidth: .infinity)
                    }
                    Button { controller.close() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                        .keyboardShortcut(.cancelAction)
                }
            case .notFound(let names):
                Text(names.count == 1 ? "\(names[0]) isn't on this Mac." : "None of these \(names.count) skills are on this Mac.")
                    .font(.headline)
                Text("They may already be deleted, or be on another Mac.").font(.callout).foregroundStyle(.secondary)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .done(let title, let message):
                Text(title).font(.headline)
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
