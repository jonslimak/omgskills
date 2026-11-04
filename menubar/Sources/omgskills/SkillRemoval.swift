import Foundation
import Observation

/// "Delete from my Mac" on the website opens `omgskills://remove?name=<skill>`. The app finds every copy of
/// that skill in the agent folders, asks first, and moves them to the Trash. A link alone never deletes anything.
enum SkillRemoval {
    /// One skill per name, the same rule the web and the skill count use.
    nonisolated static func normalizedName(_ name: String) -> String {
        name.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// The skill name in a removal link, or nil for anything that is not exactly one.
    static func name(from url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "omgskills",
              components.host?.lowercased() == "remove",
              components.path.isEmpty, components.fragment == nil,
              components.user == nil, components.password == nil, components.port == nil,
              let items = components.queryItems, items.count == 1, items[0].name == "name",
              let name = items[0].value?.trimmingCharacters(in: .whitespaces),
              !name.isEmpty, name.count <= 200,
              name.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
        else { return nil }
        return name
    }

    /// This Mac's copies of the skill; links go first so a linked folder is never emptied under them.
    static func copies(named name: String, in installations: [Skill]) -> [Skill] {
        let target = normalizedName(name)
        return installations.filter { normalizedName($0.name) == target }
            .sorted { ($0.isSymlink == true ? 0 : 1, $0.installCmd) < ($1.isSymlink == true ? 0 : 1, $1.installCmd) }
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
        case confirm(name: String, copies: [Skill])
        case notFound(name: String)
        case done(name: String, message: String)
        case failed(name: String, message: String)
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
    func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "omgskills", url.host?.lowercased() == "remove" else { return false }
        if case .confirm = state { return true }
        guard let name = SkillRemoval.name(from: url) else {
            state = .failed(name: "", message: "This delete link is invalid.")
            return true
        }
        let copies = SkillRemoval.copies(named: name, in: installations())
        state = copies.isEmpty ? .notFound(name: name) : .confirm(name: name, copies: copies)
        return true
    }

    func confirm() {
        guard case .confirm(let name, let copies) = state else { return }
        var removed = 0, failures: [String] = []
        for copy in copies {
            do { _ = try trash(copy); removed += 1 }
            catch { failures.append(copy.origin ?? "Agent") }
        }
        if removed > 0 { onRemoved() }
        state = failures.isEmpty
            ? .done(name: name, message: "Moved to the Trash. To undo, put it back from the Trash.")
            : .failed(name: name, message: "Couldn't delete the \(failures.sorted().joined(separator: ", ")) copy. "
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
            case .confirm(let name, let copies):
                Text("Delete \(name) from this Mac?").font(.headline)
                Text("Moves \(copies.count == 1 ? "1 copy" : "\(copies.count) copies") (\(SkillRemoval.agents(copies))) to the Trash.")
                    .font(.callout).foregroundStyle(.secondary)
                HStack {
                    Button("Cancel") { controller.close() }.keyboardShortcut(.cancelAction)
                        .frame(maxWidth: .infinity)
                    Button("Move to Trash", role: .destructive) { controller.confirm() }
                        .frame(maxWidth: .infinity)
                }
            case .notFound(let name):
                Text("\(name) isn't on this Mac.").font(.headline)
                Text("It may already be deleted, or be on another Mac.").font(.callout).foregroundStyle(.secondary)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .done(let name, let message):
                Text("Deleted \(name)").font(.headline)
                Text(message).font(.callout).foregroundStyle(.secondary)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .failed(_, let message):
                Text(message).font(.callout).foregroundStyle(.red)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            }
        }
    }
}
#endif
