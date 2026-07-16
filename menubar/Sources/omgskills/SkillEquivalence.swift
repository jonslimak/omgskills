import Foundation

struct SkillEquivalenceAsset: Decodable, Sendable {
    let version: Int
    let generatedAt: String?
    let groups: [SkillEquivalenceGroup]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        groups = try container.decode([SkillEquivalenceGroup].self, forKey: .groups)
        try Self.validate(version: version, groups: groups)
    }

    private static func validate(version: Int, groups: [SkillEquivalenceGroup]) throws {
        guard version == 1 else {
            throw SkillEquivalenceValidationError.unsupportedVersion(version)
        }

        var groupIds: Set<String> = []
        var claimedMemberIds: Set<String> = []

        for group in groups {
            guard !group.id.isEmpty, groupIds.insert(group.id).inserted else {
                throw SkillEquivalenceValidationError.duplicateOrEmptyGroupId(group.id)
            }

            let memberIds = Set(group.memberSkillIds)
            guard group.memberSkillIds.count >= 2,
                  memberIds.count == group.memberSkillIds.count,
                  memberIds.allSatisfy({ !$0.isEmpty }) else {
                throw SkillEquivalenceValidationError.invalidMembers(group.id)
            }
            guard claimedMemberIds.isDisjoint(with: memberIds) else {
                throw SkillEquivalenceValidationError.overlappingMembers(group.id)
            }
            guard memberIds.contains(group.representativeSkillId) else {
                throw SkillEquivalenceValidationError.invalidRepresentative(group.id)
            }
            guard group.preferredSkillIds.allSatisfy({
                !$0.key.isEmpty && memberIds.contains($0.value)
            }) else {
                throw SkillEquivalenceValidationError.invalidPreferredSkill(group.id)
            }

            claimedMemberIds.formUnion(memberIds)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case version
        case generatedAt
        case groups
    }
}

struct SkillEquivalenceGroup: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let memberSkillIds: [String]
    let representativeSkillId: String
    let preferredSkillIds: [String: String]
    let confidence: String
    let evidence: [String]

    func preferredSkillId(for agent: String) -> String {
        preferredSkillIds[agent.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()]
            ?? representativeSkillId
    }
}

struct SkillEquivalenceIndex: Equatable, Sendable {
    static let empty = SkillEquivalenceIndex(
        groups: [],
        groupsById: [:],
        groupsByMemberSkillId: [:]
    )

    let groups: [SkillEquivalenceGroup]
    private let groupsById: [String: SkillEquivalenceGroup]
    private let groupsByMemberSkillId: [String: SkillEquivalenceGroup]

    init(asset: SkillEquivalenceAsset, liveSkillIds: Set<String>) {
        let liveGroups = asset.groups.compactMap { group -> SkillEquivalenceGroup? in
            let liveMemberIds = group.memberSkillIds
                .filter { liveSkillIds.contains($0) }
                .sorted(by: Self.codePointLessThan)
            guard liveMemberIds.count >= 2 else { return nil }

            let representativeSkillId = liveSkillIds.contains(group.representativeSkillId)
                ? group.representativeSkillId
                : liveMemberIds[0]
            let preferredSkillIds = group.preferredSkillIds.filter {
                liveMemberIds.contains($0.value)
            }

            return SkillEquivalenceGroup(
                id: group.id,
                memberSkillIds: liveMemberIds,
                representativeSkillId: representativeSkillId,
                preferredSkillIds: preferredSkillIds,
                confidence: group.confidence,
                evidence: group.evidence
            )
        }

        self.init(
            groups: liveGroups,
            groupsById: Dictionary(uniqueKeysWithValues: liveGroups.map { ($0.id, $0) }),
            groupsByMemberSkillId: Dictionary(
                uniqueKeysWithValues: liveGroups.flatMap { group in
                    group.memberSkillIds.map { ($0, group) }
                }
            )
        )
    }

    func group(id: String) -> SkillEquivalenceGroup? {
        groupsById[id]
    }

    func group(containing skillId: String) -> SkillEquivalenceGroup? {
        groupsByMemberSkillId[skillId]
    }

    private static func codePointLessThan(_ lhs: String, _ rhs: String) -> Bool {
        lhs.unicodeScalars.lexicographicallyPrecedes(rhs.unicodeScalars) {
            $0.value < $1.value
        }
    }

    private init(
        groups: [SkillEquivalenceGroup],
        groupsById: [String: SkillEquivalenceGroup],
        groupsByMemberSkillId: [String: SkillEquivalenceGroup]
    ) {
        self.groups = groups
        self.groupsById = groupsById
        self.groupsByMemberSkillId = groupsByMemberSkillId
    }
}

private enum SkillEquivalenceValidationError: Error {
    case unsupportedVersion(Int)
    case duplicateOrEmptyGroupId(String)
    case invalidMembers(String)
    case overlappingMembers(String)
    case invalidRepresentative(String)
    case invalidPreferredSkill(String)
}
