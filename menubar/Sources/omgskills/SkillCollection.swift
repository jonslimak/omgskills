import Foundation

enum CollectionType: String, Codable, Sendable {
    case author
    case topic
}

struct SkillCollection: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let type: CollectionType
    let title: String
    let subtitle: String
    let authorHandle: String?
    let imageUrl: String?
    let featuredSkillIds: [String]
    let skillIds: [String]?
    let description: String?
}

struct CollectionsAsset: Codable, Sendable {
    let version: Int
    let generatedAt: String?
    let collections: [SkillCollection]
}
