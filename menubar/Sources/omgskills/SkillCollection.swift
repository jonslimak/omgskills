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
    let isCompany: Bool?

    init(
        id: String,
        type: CollectionType,
        title: String,
        subtitle: String,
        authorHandle: String?,
        imageUrl: String?,
        featuredSkillIds: [String],
        skillIds: [String]?,
        description: String?,
        isCompany: Bool? = nil
    ) {
        self.id = id
        self.type = type
        self.title = title
        self.subtitle = subtitle
        self.authorHandle = authorHandle
        self.imageUrl = imageUrl
        self.featuredSkillIds = featuredSkillIds
        self.skillIds = skillIds
        self.description = description
        self.isCompany = isCompany
    }

    // Presentation only; this does not establish vendor or crawler trust.
    var isCompanyForPresentation: Bool {
        isCompany ?? Self.legacyCompanyCollectionIds.contains(id)
    }

    private static let legacyCompanyCollectionIds: Set<String> = [
        "author-anthropics",
        "author-automattic",
        "author-browser-use",
        "author-clickhouse",
        "author-cloudflare",
        "author-cursor",
        "author-everyinc",
        "author-expo",
        "author-facebook",
        "author-firebase",
        "author-firecrawl",
        "author-flutter",
        "author-getsentry",
        "author-github",
        "author-google-gemini",
        "author-google-labs-code",
        "author-googleworkspace",
        "author-heygen-com",
        "author-higgsfield-ai",
        "author-huggingface",
        "author-langchain-ai",
        "author-lobehub",
        "author-microsoft",
        "author-n8n-io",
        "author-nousresearch",
        "author-openai",
        "author-paperclipai",
        "author-posthog",
        "author-pytorch",
        "author-react",
        "author-shadcn",
        "author-stripe",
        "author-supabase",
        "author-trailofbits",
        "author-vercel",
        "author-vercel-labs",
        "author-warpdotdev"
    ]
}

struct CollectionsAsset: Codable, Sendable {
    let version: Int
    let generatedAt: String?
    let collections: [SkillCollection]
}
