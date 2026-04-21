import Foundation

struct Skill: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let githubUrl: String
    let installCmd: String
    let authorHandle: String
    let tags: [String]
    let readmeSnippet: String?
    let stars: Int
    let lastUpdated: String
    let firstSeen: String
    let skillMdSha: String?
    let origin: String?  // "Claude" | "Codex" | "Agents" — set for installed skills only
}
