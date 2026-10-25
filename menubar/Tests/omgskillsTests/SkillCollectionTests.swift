import Foundation
import Testing
@testable import omgskills

struct SkillCollectionTests {
    @Test(arguments: [nil, true, false] as [Bool?])
    func decodesOptionalCompanyFlag(isCompany: Bool?) throws {
        let collection = try decodeCollection(id: "author-new", isCompany: isCompany)

        #expect(collection.isCompany == isCompany)
        #expect(collection.isCompanyForPresentation == (isCompany ?? false))
    }

    @Test(arguments: [nil, true, false] as [Bool?])
    func explicitFlagOverridesLegacyGrouping(isCompany: Bool?) throws {
        let collection = try decodeCollection(id: "author-openai", isCompany: isCompany)

        #expect(collection.isCompany == isCompany)
        #expect(collection.isCompanyForPresentation == (isCompany ?? true))
    }

    @Test(arguments: [
        "author-anthropics", "author-automattic", "author-browser-use",
        "author-clickhouse", "author-cloudflare", "author-cursor",
        "author-everyinc", "author-expo", "author-facebook",
        "author-firebase", "author-firecrawl", "author-flutter",
        "author-getsentry", "author-github", "author-google-gemini",
        "author-google-labs-code", "author-googleworkspace", "author-heygen-com",
        "author-higgsfield-ai", "author-huggingface", "author-langchain-ai",
        "author-lobehub", "author-microsoft", "author-n8n-io",
        "author-nousresearch", "author-openai", "author-paperclipai",
        "author-posthog", "author-pytorch", "author-react",
        "author-shadcn", "author-stripe", "author-supabase",
        "author-trailofbits", "author-vercel", "author-vercel-labs",
        "author-warpdotdev"
    ])
    func missingFlagPreservesEveryLegacyCompany(id: String) throws {
        let collection = try decodeCollection(id: id)

        #expect(collection.isCompany == nil)
        #expect(collection.isCompanyForPresentation)
    }

    @Test func legacyInitializerDoesNotRequireCompanyFlag() {
        let collection = SkillCollection(
            id: "author-openai",
            type: .author,
            title: "OpenAI",
            subtitle: "Test collection",
            authorHandle: "openai",
            imageUrl: nil,
            featuredSkillIds: [],
            skillIds: nil,
            description: nil
        )

        #expect(collection.isCompany == nil)
        #expect(collection.isCompanyForPresentation)
    }

    @Test(arguments: [true, false])
    func initializerAcceptsExplicitCompanyFlag(isCompany: Bool) {
        let collection = SkillCollection(
            id: "author-openai",
            type: .author,
            title: "OpenAI",
            subtitle: "Test collection",
            authorHandle: "openai",
            imageUrl: nil,
            featuredSkillIds: [],
            skillIds: nil,
            description: nil,
            isCompany: isCompany
        )

        #expect(collection.isCompany == isCompany)
        #expect(collection.isCompanyForPresentation == isCompany)
    }

    @Test(arguments: [nil, true, false] as [Bool?])
    func companyFlagSurvivesCodableRoundTrip(isCompany: Bool?) throws {
        let collection = try decodeCollection(id: "author-openai", isCompany: isCompany)
        let encoded = try JSONEncoder().encode(collection)
        let decoded = try JSONDecoder().decode(SkillCollection.self, from: encoded)

        #expect(decoded == collection)
        #expect(decoded.isCompany == isCompany)
    }

    private func decodeCollection(id: String, isCompany: Bool? = nil) throws -> SkillCollection {
        var json: [String: Any] = [
            "id": id,
            "type": "author",
            "title": "Test author",
            "subtitle": "Test collection",
            "featuredSkillIds": [] as [String]
        ]
        if let isCompany {
            json["isCompany"] = isCompany
        }
        let data = try JSONSerialization.data(withJSONObject: json)
        return try JSONDecoder().decode(SkillCollection.self, from: data)
    }
}
