import Foundation

struct InstalledSkillDisplayItem: Identifiable, Equatable, Sendable {
    struct SourceGroup: Identifiable, Equatable, Sendable {
        let source: String
        let members: [Skill]

        var id: String {
            source.lowercased()
        }

        var badgeTitle: String {
            members.count == 1 ? source : "\(source) \(members.count)"
        }
    }

    let id: String
    let representative: Skill
    let members: [Skill]
    let displayDescription: String
    let sourceGroups: [SourceGroup]
    private let searchText: String

    init(
        id: String,
        representative: Skill,
        members: [Skill],
        displayDescription: String
    ) {
        self.id = id
        self.representative = representative
        self.members = members
        self.displayDescription = displayDescription
        sourceGroups = Self.makeSourceGroups(from: members)
        searchText = members.map { skill in
            [
                skill.name,
                skill.description,
                skill.authorHandle,
                skill.tags.joined(separator: " "),
                skill.githubUrl
            ].joined(separator: " ")
        }.joined(separator: " ")
    }

    var displayName: String {
        representative.name
    }

    var installationSummary: String {
        guard members.count > 1 else {
            return "Installed in \(sourceGroups.first?.source ?? "this location")"
        }
        let sourceSummary = sourceGroups.map { group in
            "\(group.members.count) \(group.source)"
        }.joined(separator: ", ")
        return "\(members.count) installations: \(sourceSummary)"
    }

    var selectionAnchor: InstalledSkillSelectionResolver.Anchor {
        InstalledSkillSelectionResolver.Anchor(
            itemId: id,
            memberSkillIds: Set(members.map(\.id))
        )
    }

    func contains(skillId: String?) -> Bool {
        guard let skillId else { return false }
        return members.contains { $0.id == skillId }
    }

    func member(skillId: String) -> Skill? {
        members.first { $0.id == skillId }
    }

    func matches(query: String) -> Bool {
        let terms = query.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !terms.isEmpty else { return true }
        return terms.allSatisfy { searchText.localizedStandardContains($0) }
    }

    private static func makeSourceGroups(from members: [Skill]) -> [SourceGroup] {
        let grouped = Dictionary(grouping: members) { skill in
            let source = skill.origin?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return source.isEmpty ? "Other" : source
        }

        return grouped.map { source, members in
            SourceGroup(
                source: source,
                members: members.sorted(by: stableMemberOrder)
            )
        }.sorted { lhs, rhs in
            let lhsRank = sourceRank(lhs.source)
            let rhsRank = sourceRank(rhs.source)
            if lhsRank != rhsRank {
                return lhsRank < rhsRank
            }
            return lhs.source.localizedCompare(rhs.source) == .orderedAscending
        }
    }

    private static func sourceRank(_ source: String) -> Int {
        switch source.lowercased() {
        case "claude": return 0
        case "codex": return 1
        case "agents": return 2
        default: return 3
        }
    }

    private static func stableMemberOrder(_ lhs: Skill, _ rhs: Skill) -> Bool {
        if lhs.installCmd != rhs.installCmd {
            return lhs.installCmd < rhs.installCmd
        }
        return lhs.id < rhs.id
    }
}
