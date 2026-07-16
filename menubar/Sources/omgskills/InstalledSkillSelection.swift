import Foundation

enum InstalledSkillSelectionResolver {
    struct Anchor: Equatable, Sendable {
        let itemId: String
        let memberSkillIds: Set<String>
    }

    struct Resolution: Equatable, Sendable {
        let item: InstalledSkillDisplayItem
        let skill: Skill
    }

    static func resolve(
        items: [InstalledSkillDisplayItem],
        selectedSkillId: String?,
        anchor: Anchor?
    ) -> Resolution? {
        if let selectedSkillId,
           let item = items.first(where: { $0.contains(skillId: selectedSkillId) }),
           let skill = item.member(skillId: selectedSkillId) {
            return Resolution(item: item, skill: skill)
        }

        if let anchor,
           let item = items.first(where: { $0.id == anchor.itemId }) {
            return Resolution(item: item, skill: item.representative)
        }

        guard let anchor else { return nil }
        let matchingItem = items
            .map { item in
                (
                    item: item,
                    overlap: anchor.memberSkillIds.intersection(item.members.map(\.id)).count
                )
            }
            .filter { $0.overlap > 0 }
            .sorted { lhs, rhs in
                if lhs.overlap != rhs.overlap {
                    return lhs.overlap > rhs.overlap
                }
                return lhs.item.id < rhs.item.id
            }
            .first?
            .item

        guard let matchingItem else { return nil }
        return Resolution(item: matchingItem, skill: matchingItem.representative)
    }
}
