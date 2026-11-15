import Foundation
import Observation

/// "+" (add to another agent) on the website, for a skill this Mac has in only one agent, opens
/// `omgskills://add-agent?name=<skill>`. The app asks which missing agent gets it, then links that agent's skills
/// folder to the copy already here (the newest one, if there are several), like "Install for Codex" in the app.
/// A link alone changes nothing, and it never replaces a folder already there.
enum SkillAddAgent {
    /// The skill name in an add-agent link, or nil for anything that is not exactly one.
    static func name(from url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "omgskills", components.host?.lowercased() == "add-agent",
              components.path.isEmpty, components.fragment == nil,
              components.user == nil, components.password == nil, components.port == nil,
              let items = components.queryItems, items.count == 1, items[0].name == "name",
              let name = items[0].value?.trimmingCharacters(in: .whitespaces), !name.isEmpty, name.count <= 200,
              name.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
        else { return nil }
        return name
    }

    /// Claude and Codex, without the agents that already have the skill.
    static func missing(_ copies: [Skill]) -> [SkillInstaller.Target] {
        let have = Set(copies.compactMap(\.origin))
        return [SkillInstaller.Target.claude, .codex].filter { !have.contains($0.rawValue) }
    }

    /// The copy to link to: one with a readable SKILL.md, the newest if there are several.
    static func source(_ copies: [Skill], modified: (Skill) -> Date? = SkillVersionMatch.modified) -> Skill? {
        copies.filter { $0.skillMdSha?.isEmpty == false }
            .max { (modified($0) ?? .distantPast) < (modified($1) ?? .distantPast) }
    }
}

@MainActor
@Observable
final class SkillAddAgentController {
    enum State: Equatable {
        case idle
        case choose(name: String, have: String, targets: [SkillInstaller.Target])
        case working(name: String)
        case everywhere(name: String)
        case notFound(name: String)
        case done(name: String, message: String)
        case failed(message: String)
    }

    private(set) var state: State = .idle
    var onChanged: () -> Void = {}

    @ObservationIgnored private let installations: () -> [Skill]
    @ObservationIgnored private let install: @Sendable (Skill, SkillInstaller.Target) throws -> LocalSkillCrossInstaller.InstallResult

    init(installations: @escaping () -> [Skill],
         install: @escaping @Sendable (Skill, SkillInstaller.Target) throws -> LocalSkillCrossInstaller.InstallResult) {
        self.installations = installations
        self.install = install
    }

    var isActive: Bool { state != .idle }
    var isWorking: Bool { if case .working = state { true } else { false } }

    /// Returns true for any add-agent link, so it never reaches the installer. A newer link replaces an open question.
    func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "omgskills", url.host?.lowercased() == "add-agent" else { return false }
        guard !isWorking else { return true }
        guard let name = SkillAddAgent.name(from: url) else {
            state = .failed(message: "This link is invalid.")
            return true
        }
        let copies = SkillRemoval.copies(named: [name], in: installations())
        guard !copies.isEmpty, SkillAddAgent.source(copies) != nil else { state = .notFound(name: name); return true }
        let targets = SkillAddAgent.missing(copies)
        state = targets.isEmpty ? .everywhere(name: name)
            : .choose(name: copies[0].name, have: SkillRemoval.agents(copies), targets: targets)
        return true
    }

    /// File work runs off the main thread. Reads the skill again first: only adds where it is still missing.
    func add(to target: SkillInstaller.Target) async {
        guard case .choose(let name, _, let targets) = state, targets.contains(target) else { return }
        let copies = SkillRemoval.copies(named: [name], in: installations())
        guard let source = SkillAddAgent.source(copies) else {
            state = .failed(message: "\(name) is no longer on this Mac. Nothing was changed.")
            return
        }
        guard SkillAddAgent.missing(copies).contains(target) else {
            state = .done(name: name, message: "It's already in \(target.rawValue).")
            return
        }
        state = .working(name: name)
        let install = self.install
        let result = await Task.detached { () -> Result<LocalSkillCrossInstaller.InstallResult, Error> in
            Result { try install(source, target) }
        }.value
        switch result {
        case .success:
            onChanged()
            state = .done(name: name, message: "Added to \(target.rawValue).")
        case .failure(LocalSkillCrossInstaller.InstallError.targetExists):
            state = .failed(message: "\(target.rawValue) already has a folder named \(name). Nothing was changed.")
        case .failure:
            state = .failed(message: "Couldn't add \(name) to \(target.rawValue). Nothing was changed.")
        }
    }

    func close() {
        guard !isWorking else { return }
        state = .idle
    }
}

#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI

struct SkillAddAgentView: View {
    let controller: SkillAddAgentController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch controller.state {
            case .idle:
                EmptyView()
            case .choose(let name, let have, let targets):
                Text("Add \(name) to another agent?").font(.headline)
                Text("It's in \(have). The new agent uses that same copy.")
                    .font(.callout).foregroundStyle(.secondary)
                VStack(spacing: 6) {
                    ForEach(Array(targets.enumerated()), id: \.element.rawValue) { index, target in
                        if index == 0 {
                            Button { Task { await controller.add(to: target) } } label: {
                                Text("Add to \(target.rawValue)").frame(maxWidth: .infinity)
                            }.keyboardShortcut(.defaultAction)
                        } else {
                            Button { Task { await controller.add(to: target) } } label: {
                                Text("Add to \(target.rawValue)").frame(maxWidth: .infinity)
                            }
                        }
                    }
                    Button { controller.close() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                        .keyboardShortcut(.cancelAction)
                }
            case .working(let name):
                ProgressView("Adding \(name)…").controlSize(.small)
            case .everywhere(let name):
                Text("\(name) is already in Claude and Codex").font(.headline)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .notFound(let name):
                Text("\(name) isn't on this Mac.").font(.headline)
                Button("Done") { controller.close() }.keyboardShortcut(.defaultAction)
            case .done(let name, let message):
                Text(name).font(.headline)
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
