import Testing
import Foundation
@testable import omgskills

struct SkillSyncServiceTests {
    @Test func defaultEndpointUsesProductionSiteAPI() {
        #expect(SkillSyncService.defaultEndpoint.absoluteString == "https://omgskills.com/api/portal/sync-upload")
    }

    @Test func configuredEndpointUsesBundleInfoPlistValue() throws {
        let bundleURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("PreviewSyncEndpoint-\(UUID().uuidString).bundle")
        let contentsURL = bundleURL.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contentsURL, withIntermediateDirectories: true)
        try """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>CFBundleIdentifier</key>
            <string>com.jonslimak.omgskills.tests.preview-endpoint</string>
            <key>OMGSkillsSyncEndpoint</key>
            <string>https://codex-skillgroups-mvp--omgskills.netlify.app/api/portal/sync-upload</string>
        </dict>
        </plist>
        """.write(to: contentsURL.appendingPathComponent("Info.plist"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: bundleURL) }
        let bundle = try #require(Bundle(url: bundleURL))

        let endpoint = SkillSyncService.configuredEndpoint(bundle: bundle)

        #expect(endpoint.absoluteString == "https://codex-skillgroups-mvp--omgskills.netlify.app/api/portal/sync-upload")
    }

    @Test func configuredEndpointFallsBackToProductionWhenMissing() {
        let endpoint = SkillSyncService.configuredEndpoint(bundle: Bundle(for: EmptyBundleMarker.self))

        #expect(endpoint == SkillSyncService.defaultEndpoint)
    }

    @Test func payloadUsesGithubUrlAndNameForGithubStableKey() {
        let skill = makeSkill(
            name: "review",
            githubUrl: "https://github.com/acme/review",
            installCmd: "/Users/test/.codex/skills/review",
            origin: "Codex",
            isLocalOnly: false
        )

        let payload = SkillSyncService.payloadSkill(skill)

        #expect(payload.stableKey == "https://github.com/acme/review#review")
        #expect(payload.githubUrl == "https://github.com/acme/review")
        #expect(payload.source == "Codex")
        #expect(payload.isLocalOnly == false)
        #expect(payload.identityStatus == "ambiguous")
    }

    @Test func payloadUsesOriginAndPathForLocalOnlyStableKey() {
        let skill = makeSkill(
            name: "local-review",
            githubUrl: "",
            installCmd: "/Users/test/.agents/skills/local-review",
            origin: "Agents",
            isLocalOnly: true
        )

        let payload = SkillSyncService.payloadSkill(skill)

        #expect(payload.stableKey == "Agents:/Users/test/.agents/skills/local-review")
        #expect(payload.githubUrl == nil)
        #expect(payload.isLocalOnly == true)
        #expect(payload.identityStatus == "localOnly")
    }

    @Test func payloadIncludesResolvedCatalogIdentity() {
        let skill = makeSkill(
            name: "catalog-review",
            githubUrl: "https://github.com/acme/catalog-review",
            installCmd: "/Users/test/.codex/skills/catalog-review",
            origin: "Codex",
            isLocalOnly: false,
            skillMdSha: "abc123",
            catalogSkillId: "acme/catalog-review:catalog-review",
            identityStatus: .resolved(method: .git)
        )

        let payload = SkillSyncService.payloadSkill(skill)

        #expect(payload.skillMdSha == "abc123")
        #expect(payload.catalogSkillId == "acme/catalog-review:catalog-review")
        #expect(payload.identityStatus == "resolved")
    }

    @Test func invalidTokenResponseHasActionableError() {
        #expect(throws: SkillSyncError.invalidOrExpiredToken) {
            try SkillSyncService.validateStatusCode(401)
        }
    }

    @Test func successfulResponseStatusDoesNotThrow() throws {
        try SkillSyncService.validateStatusCode(200)
    }

    private func makeSkill(
        name: String,
        githubUrl: String,
        installCmd: String,
        origin: String,
        isLocalOnly: Bool,
        skillMdSha: String? = nil,
        catalogSkillId: String? = nil,
        identityStatus: SkillIdentityStatus? = nil
    ) -> Skill {
        Skill(
            id: "installed:\(installCmd)",
            name: name,
            description: "Example skill",
            githubUrl: githubUrl,
            installCmd: installCmd,
            authorHandle: "",
            tags: [],
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: "2026-06-23T00:00:00Z",
            firstSeen: "",
            skillMdSha: skillMdSha,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: origin,
            isSymlink: false,
            isLocalOnly: isLocalOnly,
            catalogSkillId: catalogSkillId,
            identityStatus: identityStatus
        )
    }
}

private final class EmptyBundleMarker {}
