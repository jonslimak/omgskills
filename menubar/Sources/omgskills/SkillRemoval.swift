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

    /// What Delete everywhere does, said before it happens.
    static func everywhereWarning(count: Int, sets: Int?) -> String {
        let them = count == 1 ? "it" : "them"
        var text = "Takes \(them) out of My skills and your account. This can't be undone. "
            + "Copies here move to the Trash; copies on other Macs stay there but stop syncing."
        if let sets, sets > 0 {
            // Counts add up per skill, so for several skills one Set may be counted twice; don't give a number.
            text += count == 1
                ? " It's also taken out of \(sets == 1 ? "1 Set" : "\(sets) Sets"); people keep what they installed."
                : " They're also taken out of the Sets they're in; people keep what they installed."
        }
        return text
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
        /// Delete everywhere, asked a second time; `sets` is how many Sets share them, once known.
        case confirmEverywhere(names: [String], copies: [Skill], sets: Int?)
        case working(title: String)
        case notFound(names: [String])
        case done(title: String, message: String)
        case failed(message: String)
    }

    private(set) var state: State = .idle
    var onRemoved: () -> Void = {}
    /// Removes the skills from My skills and the account (saved keys, then added library skills).
    /// Without it, this Mac can only remove its own copies.
    var forget: ((_ keys: [String], _ catalogIDs: [String]) async throws -> Void)?
    /// How many Sets share any of these saved skills, or nil when unknown.
    var setCount: ((_ keys: [String]) async -> Int?)?
    /// The account's saved skills, read now, so keys are right even before this Mac's first cloud save pass.
    var savedRecords: (() async -> [CloudSaveKeys.Record]?)?
    /// Whether this Mac may delete from the account now (connected, with permission to change content).
    var mayForget: () -> Bool = { true }

    @ObservationIgnored private let installations: () -> [Skill]
    @ObservationIgnored private let trash: (Skill) throws -> InstalledSkillUninstaller.Result
    @ObservationIgnored private var attempt = UUID()

    init(installations: @escaping () -> [Skill],
         trash: @escaping (Skill) throws -> InstalledSkillUninstaller.Result) {
        self.installations = installations
        self.trash = trash
    }

    var isActive: Bool { state != .idle }
    var canDeleteEverywhere: Bool { forget != nil && mayForget() }
    var isWorking: Bool { if case .working = state { true } else { false } }

    /// Returns true for any removal link, so it never reaches the installer.
    /// A newer link replaces any question still open, so the panel always asks about the skill last clicked.
    func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "omgskills", url.host?.lowercased() == "remove" else { return false }
        guard !isWorking else { return true }
        attempt = UUID()
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

    /// Remove from this Mac: every copy here goes to the Trash; My skills keeps it.
    func confirm() {
        guard case .confirm(let names, let asked, _) = state else { return }
        guard let outcome = trashShown(names: names, asked: asked) else { return }
        state = outcome.failures.isEmpty
            ? .done(title: "Removed \(SkillRemoval.title(outcome.removed))",
                    message: "Moved to the Trash. To undo, put \(outcome.removed.count == 1 ? "it" : "them") back from the Trash.")
            : Self.partialFailure(outcome)
    }

    /// Asks again before deleting everywhere, with how many Sets would lose the skills.
    func chooseEverywhere() {
        guard canDeleteEverywhere, case .confirm(let names, let copies, _) = state else { return }
        let id = UUID()
        attempt = id
        state = .confirmEverywhere(names: names, copies: copies, sets: nil)
        guard let setCount else { return }
        let installed = installations()
        Task {
            let keys = Self.keys(copies, among: installed, records: await savedRecords?())
            let sets = await setCount(keys)
            guard attempt == id, case .confirmEverywhere(let names, let copies, nil) = state else { return }
            state = .confirmEverywhere(names: names, copies: copies, sets: sets)
        }
    }

    /// Delete everywhere: the copies here go to the Trash, then My skills and the account forget them.
    /// Other Macs keep their copies, but they no longer sync.
    func confirmEverywhere() async {
        guard let forget, case .confirmEverywhere(let names, let asked, _) = state else { return }
        // Nothing goes to the Trash unless the account can forget it too.
        guard mayForget() else {
            state = .failed(message: "Reconnect this Mac to your account to remove from My skills. Nothing was deleted.")
            return
        }
        let id = UUID()
        attempt = id
        // Keys come from everything installed before anything moves to the Trash.
        let installed = installations()
        let records = await savedRecords?()
        guard attempt == id else { return }
        guard let outcome = trashShown(names: names, asked: asked, reportRemoved: false) else { return }
        // A copy still here would be left out of sync, not deleted; the account keeps everything until all are gone.
        guard outcome.failures.isEmpty else {
            if !outcome.removed.isEmpty { onRemoved() }
            state = Self.partialFailure(outcome, kept: true)
            return
        }
        state = .working(title: "Deleting \(SkillRemoval.title(outcome.removed))…")
        let gone = outcome.copies.filter { outcome.removed.map(SkillRemoval.normalizedName).contains(SkillRemoval.normalizedName($0.name)) }
        var forgotten = true
        do { try await forget(Self.keys(gone, among: installed, records: records), Array(Set(gone.compactMap(\.catalogSkillId))).sorted()) }
        catch { forgotten = false }
        // The next sync runs after the account forgot them, so it doesn't save them back.
        onRemoved()
        guard attempt == id else { return }
        if !forgotten {
            state = .failed(message: "Moved to the Trash, but couldn't remove \(SkillRemoval.title(outcome.removed)) from My skills. "
                + "Delete it on the web.")
        } else {
            state = .done(title: "Removed \(SkillRemoval.title(outcome.removed)) from My skills",
                          message: "Copies here moved to the Trash. Copies on other Macs stay there.")
        }
    }

    func close() {
        guard !isWorking else { return }
        attempt = UUID()
        state = .idle
    }

    private struct Outcome {
        let copies: [Skill]
        let removed: [String]
        let failures: [String]
    }

    /// Trashes the copies that are still there and were shown; anything new since the question is left alone.
    /// Returns nil when none are left.
    private func trashShown(names: [String], asked: [Skill], reportRemoved: Bool = true) -> Outcome? {
        let shown = Set(asked.map(SkillRemoval.location))
        let copies = SkillRemoval.copies(named: names, in: installations()).filter { shown.contains(SkillRemoval.location($0)) }
        guard !copies.isEmpty else { state = .notFound(names: names); return nil }
        var failures: [String] = [], removedNames = Set<String>()
        for copy in copies {
            do { _ = try trash(copy); removedNames.insert(SkillRemoval.normalizedName(copy.name)) }
            catch {
                // Already gone (e.g. trashed through a linked folder) is what was asked for.
                if (try? FileManager.default.attributesOfItem(atPath: copy.installCmd)) == nil {
                    removedNames.insert(SkillRemoval.normalizedName(copy.name))
                } else { failures.append(copy.origin ?? "Agent") }
            }
        }
        let removed = names.filter { removedNames.contains(SkillRemoval.normalizedName($0)) }
        if reportRemoved && !removedNames.isEmpty { onRemoved() }
        return Outcome(copies: copies, removed: removed, failures: failures)
    }

    private static func partialFailure(_ outcome: Outcome, kept: Bool = false) -> State {
        let count = outcome.failures.count
        return .failed(message: "Couldn't delete \(count == 1 ? "1 copy" : "\(count) copies") (\(Set(outcome.failures).sorted().joined(separator: ", "))). "
            + (outcome.removed.isEmpty ? "Nothing was deleted." : "Other copies were moved to the Trash.")
            + (kept ? " My skills still has it." : ""))
    }

    /// The account's keys for these copies: their folder names, unless another skill shares the folder name.
    static func keys(_ copies: [Skill], among installations: [Skill], records: [CloudSaveKeys.Record]? = nil) -> [String] {
        let keys = CloudSaveKeys.current(for: installations + copies, records: records)
        return Array(Set(copies.compactMap { keys[$0.installCmd] })).sorted()
    }
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
                Text("Remove \(SkillRemoval.title(names)) from this Mac?").font(.headline)
                Text(controller.canDeleteEverywhere ? "Every copy here moves to the Trash. If synced, My skills keeps \(names.count == 1 ? "it" : "them")."
                     : "Every copy moves to the Trash.").font(.callout).foregroundStyle(.secondary)
                let skills = SkillRemoval.grouped(names: names, copies: copies)
                let list = VStack(alignment: .leading, spacing: 8) {
                    ForEach(skills, id: \.name) { skill in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(skill.name).font(.callout.weight(.semibold)).lineLimit(1).truncationMode(.middle)
                            Text(SkillRemoval.agents(skill.copies)).font(.caption).foregroundStyle(.secondary)
                        }.help(skill.copies.map(\.installCmd).joined(separator: "\n"))
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                // Short lists sit in the panel; long ones scroll so the buttons stay in view.
                if skills.count > 5 { ScrollView { list }.frame(height: 200) } else { list }
                if !missing.isEmpty {
                    Text("Not on this Mac: \(missing.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
                        .lineLimit(3)
                }
                VStack(spacing: 6) {
                    Button(role: .destructive) { controller.confirm() } label: {
                        Text("Remove from this Mac").frame(maxWidth: .infinity)
                    }
                    if controller.canDeleteEverywhere {
                        Button(role: .destructive) { controller.chooseEverywhere() } label: {
                            Text("Remove from My skills…").frame(maxWidth: .infinity)
                        }
                    }
                    Button { controller.close() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                        .keyboardShortcut(.cancelAction)
                }
            case .confirmEverywhere(let names, _, let sets):
                Text("Remove \(SkillRemoval.title(names)) from My skills?").font(.headline)
                Text(SkillRemoval.everywhereWarning(count: names.count, sets: sets))
                    .font(.callout).foregroundStyle(.secondary)
                VStack(spacing: 6) {
                    Button(role: .destructive) { Task { await controller.confirmEverywhere() } } label: {
                        Text("Remove from My skills").frame(maxWidth: .infinity)
                    }
                    Button { controller.close() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                        .keyboardShortcut(.cancelAction)
                }
            case .working(let title):
                ProgressView(title).controlSize(.small)
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
