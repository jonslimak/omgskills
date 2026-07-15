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
    let gitRelativePath: String?
    let publisherHandle: String?
    let publisherRepo: String?
    let provenanceType: String?
    let authorConfidence: String?
    let catalogSkillId: String?
    let identityStatus: SkillIdentityStatus?
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

    init(
        id: String,
        name: String,
        description: String,
        githubUrl: String,
        installCmd: String,
        authorHandle: String,
        tags: [String],
        readmeSnippet: String?,
        stars: Int,
        lastUpdated: String,
        firstSeen: String,
        skillMdSha: String?,
        installs: Int?,
        trendingRank: Int?,
        trendingSource: String?,
        origin: String?,
        isSymlink: Bool?,
        isLocalOnly: Bool?,
        gitRelativePath: String? = nil,
        publisherHandle: String? = nil,
        publisherRepo: String? = nil,
        provenanceType: String? = nil,
        authorConfidence: String? = nil,
        catalogSkillId: String? = nil,
        identityStatus: SkillIdentityStatus? = nil,
        sourceTag: String? = nil,
        sourceUrl: String? = nil,
        tweetUrl: String? = nil,
        tweetLikes: Int? = nil,
        tweetRetweets: Int? = nil,
        tweetReplies: Int? = nil,
        tweetViews: Int? = nil,
        tweetAuthorHandle: String? = nil,
        tweetAuthorName: String? = nil,
        tweetPostedAt: String? = nil,
        tweetText: String? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.githubUrl = githubUrl
        self.installCmd = installCmd
        self.authorHandle = authorHandle
        self.tags = tags
        self.readmeSnippet = readmeSnippet
        self.stars = stars
        self.lastUpdated = lastUpdated
        self.firstSeen = firstSeen
        self.skillMdSha = skillMdSha
        self.installs = installs
        self.trendingRank = trendingRank
        self.trendingSource = trendingSource
        self.origin = origin
        self.isSymlink = isSymlink
        self.isLocalOnly = isLocalOnly
        self.gitRelativePath = gitRelativePath
        self.publisherHandle = publisherHandle
        self.publisherRepo = publisherRepo
        self.provenanceType = provenanceType
        self.authorConfidence = authorConfidence
        self.catalogSkillId = catalogSkillId
        self.identityStatus = identityStatus
        self.sourceTag = sourceTag
        self.sourceUrl = sourceUrl
        self.tweetUrl = tweetUrl
        self.tweetLikes = tweetLikes
        self.tweetRetweets = tweetRetweets
        self.tweetReplies = tweetReplies
        self.tweetViews = tweetViews
        self.tweetAuthorHandle = tweetAuthorHandle
        self.tweetAuthorName = tweetAuthorName
        self.tweetPostedAt = tweetPostedAt
        self.tweetText = tweetText
    }
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
            gitRelativePath: gitRelativePath,
            publisherHandle: publisherHandle,
            publisherRepo: publisherRepo,
            provenanceType: provenanceType,
            authorConfidence: authorConfidence,
            catalogSkillId: catalogSkillId,
            identityStatus: identityStatus,
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

    var hasResolvedAuthor: Bool {
        !authorHandle.isEmpty
    }

    var shouldShowPublisherFallback: Bool {
        guard !hasResolvedAuthor,
              let publisherHandle,
              !publisherHandle.isEmpty,
              let provenanceType else {
            return false
        }
        return provenanceType == "catalog" || provenanceType == "repackaged"
    }

    var isCollectionLike: Bool {
        if provenanceType == "catalog" || provenanceType == "repackaged" {
            return true
        }
        guard let publisherRepo else { return false }
        return Self.collectionLikePublisherRepos.contains(publisherRepo.lowercased())
    }

    var searchQualityPenalty: Int {
        var penalty = isCollectionLike ? 250 : 0
        if hasCJKHeavyDescription {
            penalty += 100
        }
        return penalty
    }

    var discoverAttributionText: String? {
        if hasResolvedAuthor {
            return "by @\(authorHandle)"
        }
        if shouldShowPublisherFallback, let publisherHandle {
            return "via @\(publisherHandle)"
        }
        return nil
    }

    private static let collectionLikePublisherRepos: Set<String> = [
        "affaan-m/ecc",
        "affaan-m/everything-claude-code",
        "aiskillstore/marketplace",
        "francostino/opencode-skills-collection",
        "neversight/learn-skills.dev",
        "openclaw/openclaw",
        "openclaw/skills",
        "orcaqubits/agentic-commerce-skills-plugins",
        "sickn33/antigravity-awesome-skills",
    ]

    private var hasCJKHeavyDescription: Bool {
        var letterCount = 0
        var cjkCount = 0

        for scalar in description.unicodeScalars where scalar.properties.isAlphabetic {
            letterCount += 1
            if Self.isCJKScalar(scalar) {
                cjkCount += 1
            }
        }

        guard letterCount >= 20 else { return false }
        return Double(cjkCount) / Double(letterCount) >= 0.4
    }

    private static func isCJKScalar(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x3040...0x30FF, // Hiragana + Katakana
             0x3400...0x9FFF, // CJK unified ideographs
             0xAC00...0xD7AF, // Hangul syllables
             0xF900...0xFAFF: // CJK compatibility ideographs
            return true
        default:
            return false
        }
    }
}

enum SkillIdentityStatus: Codable, Hashable, Sendable {
    case resolved(method: SkillIdentityResolutionMethod)
    case ambiguous(skillIds: [String])
    case localOnly
}

enum SkillIdentityResolutionMethod: String, Codable, Hashable, Sendable {
    case provenance
    case git
    case sha
}
