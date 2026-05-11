import Foundation

struct TrendingEntry: Codable, Hashable, Sendable {
    let id: String
    let installs: Int
    let trendingRank: Int
    let trendingSource: String
}

struct Skill: Codable, Identifiable, Hashable, Sendable {
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
    let installs: Int?
    let trendingRank: Int?
    let trendingSource: String?
    let origin: String?  // "Claude" | "Codex" | "Agents" — set for installed skills only
    let isSymlink: Bool?
    let isLocalOnly: Bool?
    var sourceTag: String? = nil
    var sourceUrl: String? = nil
    var tweetUrl: String? = nil
    var tweetLikes: Int? = nil
    var tweetRetweets: Int? = nil
    var tweetReplies: Int? = nil
    var tweetViews: Int? = nil
    var tweetAuthorHandle: String? = nil
    var tweetAuthorName: String? = nil
    var tweetPostedAt: String? = nil
    var tweetText: String? = nil
}

extension Skill {
    func withTrending(_ entry: TrendingEntry) -> Skill {
        Skill(
            id: id,
            name: name,
            description: description,
            githubUrl: githubUrl,
            installCmd: installCmd,
            authorHandle: authorHandle,
            tags: tags,
            readmeSnippet: readmeSnippet,
            stars: stars,
            lastUpdated: lastUpdated,
            firstSeen: firstSeen,
            skillMdSha: skillMdSha,
            installs: entry.installs,
            trendingRank: entry.trendingRank,
            trendingSource: entry.trendingSource,
            origin: origin,
            isSymlink: isSymlink,
            isLocalOnly: isLocalOnly,
            sourceTag: sourceTag,
            sourceUrl: sourceUrl,
            tweetUrl: tweetUrl,
            tweetLikes: tweetLikes,
            tweetRetweets: tweetRetweets,
            tweetReplies: tweetReplies,
            tweetViews: tweetViews,
            tweetAuthorHandle: tweetAuthorHandle,
            tweetAuthorName: tweetAuthorName,
            tweetPostedAt: tweetPostedAt,
            tweetText: tweetText
        )
    }
}
