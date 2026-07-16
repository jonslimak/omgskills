import CryptoKit
import Foundation

enum InstalledSkillGrouper {
    static func group(
        installations: [Skill],
        equivalence: SkillEquivalenceIndex
    ) -> [InstalledSkillDisplayItem] {
        var catalogGroups: [String: [Skill]] = [:]
        var equivalenceGroups: [String: SkillEquivalenceGroup] = [:]
        var localInstallations: [Skill] = []

        for installation in installations {
            guard let catalogSkillId = installation.catalogSkillId else {
                localInstallations.append(installation)
                continue
            }

            if let equivalenceGroup = equivalence.group(containing: catalogSkillId) {
                let key = "equivalence:\(equivalenceGroup.id)"
                catalogGroups[key, default: []].append(installation)
                equivalenceGroups[key] = equivalenceGroup
            } else {
                catalogGroups["catalog:\(catalogSkillId)", default: []].append(installation)
            }
        }

        let authoritativeItems: [InstalledSkillDisplayItem] = catalogGroups.compactMap { key, members in
            makeItem(
                id: key,
                members: members,
                equivalenceGroup: equivalenceGroups[key]
            )
        }
        let localItems: [InstalledSkillDisplayItem] = localGroups(from: localInstallations).compactMap { members in
            guard let firstMember = members.first else { return nil }
            let id = members.count == 1
                ? firstMember.id
                : "local:\(stableGroupHash(memberIds: members.map(\.id)))"
            return makeItem(id: id, members: members, equivalenceGroup: nil)
        }

        return (authoritativeItems + localItems).sorted {
            let nameOrder = $0.displayName.localizedCompare($1.displayName)
            if nameOrder != .orderedSame {
                return nameOrder == .orderedAscending
            }
            return $0.id < $1.id
        }
    }

    private static func localGroups(from installations: [Skill]) -> [[Skill]] {
        var groups: [[Skill]] = []

        for installation in installations {
            let skillName = normalizedSkillText(installation.name)
            let matchingIndex = groups.firstIndex { group in
                guard let firstSkill = group.first,
                      normalizedSkillText(firstSkill.name) == skillName else {
                    return false
                }
                if !installation.githubUrl.isEmpty,
                   !firstSkill.githubUrl.isEmpty,
                   installation.githubUrl == firstSkill.githubUrl {
                    return true
                }
                return group.contains {
                    descriptionsMatch($0.description, installation.description)
                }
            }

            if let matchingIndex {
                groups[matchingIndex].append(installation)
            } else {
                groups.append([installation])
            }
        }

        return groups
    }

    private static func makeItem(
        id: String,
        members: [Skill],
        equivalenceGroup: SkillEquivalenceGroup?
    ) -> InstalledSkillDisplayItem? {
        guard !members.isEmpty else { return nil }
        let stableMembers = members.sorted(by: stableMemberOrder)
        let representativeCandidates: [Skill]
        if let representativeSkillId = equivalenceGroup?.representativeSkillId {
            representativeCandidates = stableMembers.filter {
                $0.catalogSkillId == representativeSkillId
            }
        } else {
            representativeCandidates = []
        }
        guard let representative = chooseRepresentative(
            representativeCandidates.isEmpty ? stableMembers : representativeCandidates
        ) else {
            return nil
        }
        let displayDescription = stableMembers
            .map(\.description)
            .max { lhs, rhs in
                if lhs.count != rhs.count {
                    return lhs.count < rhs.count
                }
                return lhs > rhs
            } ?? representative.description

        return InstalledSkillDisplayItem(
            id: id,
            representative: representative,
            members: stableMembers,
            displayDescription: displayDescription
        )
    }

    private static func chooseRepresentative(_ members: [Skill]) -> Skill? {
        if let codex = members.first(where: {
            ($0.origin ?? "").lowercased().contains("codex")
        }) {
            return codex
        }
        if let github = members.first(where: { !$0.githubUrl.isEmpty }) {
            return github
        }
        return members.sorted { lhs, rhs in
            let sourceOrder = (lhs.origin ?? "").localizedCompare(rhs.origin ?? "")
            if sourceOrder != .orderedSame {
                return sourceOrder == .orderedAscending
            }
            return stableMemberOrder(lhs, rhs)
        }.first
    }

    private static func normalizedSkillText(_ value: String) -> String {
        value
            .lowercased()
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    private static func normalizedDescriptionWords(_ value: String) -> Set<String> {
        let normalized = normalizedSkillText(value)
        let scalars = normalized.unicodeScalars.map { scalar -> Character in
            let value = scalar.value
            let isLowercaseLetter = (97...122).contains(value)
            let isDigit = (48...57).contains(value)
            return isLowercaseLetter || isDigit || scalar == " " ? Character(scalar) : " "
        }
        return Set(String(scalars).split(separator: " ").map(String.init).filter { $0.count > 2 })
    }

    private static func descriptionsMatch(_ lhs: String, _ rhs: String) -> Bool {
        let normalizedLHS = normalizedSkillText(lhs)
        let normalizedRHS = normalizedSkillText(rhs)

        if normalizedLHS == normalizedRHS {
            return true
        }
        guard !normalizedLHS.isEmpty, !normalizedRHS.isEmpty else {
            return false
        }
        if min(normalizedLHS.utf16.count, normalizedRHS.utf16.count) >= 35,
           normalizedLHS.contains(normalizedRHS) || normalizedRHS.contains(normalizedLHS) {
            return true
        }

        let lhsWords = normalizedDescriptionWords(normalizedLHS)
        let rhsWords = normalizedDescriptionWords(normalizedRHS)
        let smallerSize = min(lhsWords.count, rhsWords.count)
        let sharedCount = lhsWords.intersection(rhsWords).count

        if smallerSize >= 3, smallerSize < 5 {
            return Double(sharedCount) / Double(smallerSize) >= 0.8
        }
        if smallerSize < 5 {
            return false
        }
        return Double(sharedCount) / Double(smallerSize) >= 0.72
    }

    private static func stableMemberOrder(_ lhs: Skill, _ rhs: Skill) -> Bool {
        if lhs.id != rhs.id {
            return lhs.id < rhs.id
        }
        return lhs.installCmd < rhs.installCmd
    }

    private static func stableGroupHash(memberIds: [String]) -> String {
        let payload = memberIds.sorted().joined(separator: "\n")
        return SHA256.hash(data: Data(payload.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}
