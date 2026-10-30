import Testing
import Foundation
@testable import omgskills

struct SkillSyncServiceTests {
    @Test func setOriginIsOptionalBoundedAndIncludedInBothReportFormats() throws {
        for (name, expected) in [(nil, nil), (" Team Skills ", "Team Skills"),
                                 (String(repeating: "x", count: 201), nil)] as [(String?, String?)] {
            let skill = makeSkill(name: "review", githubUrl: "", installCmd: "/tmp/skills/review",
                origin: "Codex", isLocalOnly: true, installedFromSet: name)
            let legacy = SkillSyncService.payloadSkill(skill)
            let presence = try SkillSyncService.presencePayloadSkill(skill)
            #expect(legacy.installedFromSet == expected)
            #expect(presence.installedFromSet == expected)
            let encoded = try JSONEncoder().encode(presence)
            let json = try #require(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
            #expect(json["installedFromSet"] as? String == expected)
        }
    }

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

    @Test func endpointPolicyAllowsLoopbackHTTPOnlyWhenExplicitlyEnabled() {
        let localhost = URL(string: "http://localhost:8888/api/portal/sync-upload")!
        let remoteHTTP = URL(string: "http://example.com/api/portal/sync-upload")!
        let remoteHTTPS = URL(string: "https://example.com/api/portal/sync-upload")!

        #expect(SkillSyncService.isAllowedEndpoint(localhost, allowLoopbackHTTP: true))
        #expect(!SkillSyncService.isAllowedEndpoint(localhost, allowLoopbackHTTP: false))
        #expect(!SkillSyncService.isAllowedEndpoint(remoteHTTP, allowLoopbackHTTP: true))
        #expect(SkillSyncService.isAllowedEndpoint(remoteHTTPS, allowLoopbackHTTP: false))
    }

    @Test func payloadUsesLocationKeyForGithubSkill() {
        let skill = makeSkill(
            name: "review",
            githubUrl: "https://github.com/acme/review",
            installCmd: "/Users/test/.codex/skills/review",
            origin: "Codex",
            isLocalOnly: false
        )

        let payload = SkillSyncService.payloadSkill(skill)

        #expect(payload.stableKey == "location:v1:codex:review")
        #expect(payload.installationPath == "review")
        #expect(payload.githubUrl == "https://github.com/acme/review")
        #expect(payload.source == "Codex")
        #expect(payload.isLocalOnly == false)
        #expect(payload.identityStatus == "ambiguous")
    }

    @Test func payloadUsesLocationKeyForLocalOnlySkill() {
        let skill = makeSkill(
            name: "local-review",
            githubUrl: "",
            installCmd: "/Users/test/.agents/skills/local-review",
            origin: "Agents",
            isLocalOnly: true
        )

        let payload = SkillSyncService.payloadSkill(skill)

        #expect(payload.stableKey == "location:v1:agents:local-review")
        #expect(payload.installationPath == "local-review")
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
        #expect(payload.isLocalOnly == false)
    }

    @Test func resolvedIdentityOverridesLegacyLocalOnlyFlag() {
        let skill = makeSkill(
            name: "catalog-review",
            githubUrl: "",
            installCmd: "/Users/test/.codex/skills/catalog-review",
            origin: "Codex",
            isLocalOnly: true,
            catalogSkillId: "acme/catalog-review:catalog-review",
            identityStatus: .resolved(method: .sha)
        )

        let payload = SkillSyncService.payloadSkill(skill)

        #expect(payload.identityStatus == "resolved")
        #expect(payload.isLocalOnly == false)
    }

    @Test func legacyCatalogIdentityWithoutStatusRemainsResolved() {
        let skill = makeSkill(
            name: "catalog-review",
            githubUrl: "https://github.com/acme/catalog-review",
            installCmd: "/Users/test/.claude/skills/catalog-review",
            origin: "Claude",
            isLocalOnly: true,
            catalogSkillId: "acme/catalog-review:catalog-review"
        )

        let payload = SkillSyncService.payloadSkill(skill)

        #expect(payload.identityStatus == "resolved")
        #expect(payload.catalogSkillId == "acme/catalog-review:catalog-review")
        #expect(payload.isLocalOnly == false)
    }

    @Test func payloadPreservesEveryResolvedInstallation() {
        let claude = makeSkill(
            name: "catalog-review",
            githubUrl: "https://github.com/acme/catalog-review",
            installCmd: "/Users/test/.claude/skills/catalog-review",
            origin: "Claude",
            isLocalOnly: false,
            catalogSkillId: "acme/catalog-review:catalog-review",
            identityStatus: .resolved(method: .provenance)
        )
        let codex = makeSkill(
            name: "catalog-review",
            githubUrl: "https://github.com/acme/catalog-review",
            installCmd: "/Users/test/.codex/skills/catalog-review",
            origin: "Codex",
            isLocalOnly: false,
            catalogSkillId: "acme/catalog-review:catalog-review",
            identityStatus: .resolved(method: .git)
        )

        let payload = SkillSyncService.payload(token: " token ", installations: [claude, codex])

        #expect(payload.token == "token")
        #expect(payload.skills.count == 2)
        #expect(payload.skills.map(\.source) == ["Claude", "Codex"])
        #expect(payload.skills.map(\.stableKey) == [
            "location:v1:claude:catalog-review",
            "location:v1:codex:catalog-review"
        ])
        #expect(payload.skills.allSatisfy { $0.catalogSkillId == "acme/catalog-review:catalog-review" })
        #expect(payload.skills.allSatisfy { $0.identityStatus == "resolved" })
    }

    @Test func invalidTokenResponseHasActionableError() {
        #expect(throws: SkillSyncError.invalidOrExpiredToken) {
            try SkillSyncService.validateStatusCode(401)
        }
    }

    @Test func successfulResponseStatusDoesNotThrow() throws {
        try SkillSyncService.validateStatusCode(200)
    }

    @Test func presenceJSONContainsOnlyA1FactsForEveryAgent() throws {
        let installations = ["Claude", "Codex", "Agents"].map { source in
            makeSkill(name: "Review", githubUrl: "git@github.com:Owner/Repo.git",
                installCmd: "/private/test/\(source)/review", origin: source, isLocalOnly: false,
                skillMdSha: String(repeating: "A", count: 40), catalogSkillId: "owner/repo:skills/review",
                identityStatus: .resolved(method: .provenance), gitRelativePath: "skills/review")
        }
        let payload = try SkillSyncService.presencePayload(installations: installations)
        let data = try JSONEncoder().encode(payload)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let skills = try #require(json["skills"] as? [[String: Any]])
        #expect(Set(json.keys) == ["reportVersion", "skills"])
        #expect(json["reportVersion"] as? Int == 2)
        #expect(payload.skills.map(\.source) == ["claude", "codex", "agents"])
        #expect(skills.allSatisfy { Set($0.keys) == ["source", "installationPath", "name", "description", "skillMdSha", "githubUrl", "gitRelativePath", "catalogSkillIdHint"] })
        #expect(payload.skills.allSatisfy { $0.installationPath == "review" && $0.githubUrl == "https://github.com/owner/repo" })
        #expect(payload.skills.allSatisfy { $0.skillMdSha == String(repeating: "a", count: 40) })
        #expect(!String(decoding: data, as: UTF8.self).contains("/private/test"))
    }

    @Test func presenceOmitsUnsafeOptionalHintsWithoutDroppingInstallation() throws {
        for remote in ["https://user:secret@github.com/o/r", "https://github.com/o/r?token=secret",
                       "https://github.com/o/r#secret", "https://notgithub.com/o/r", "http://github.com/o/r"] {
            let skill = makeSkill(name: "Local", githubUrl: remote, installCmd: "/tmp/local", origin: "Codex",
                isLocalOnly: false, skillMdSha: "bad-hash", gitRelativePath: "../private")
            let payload = try SkillSyncService.presencePayload(installations: [skill])
            #expect(payload.skills.count == 1)
            #expect(payload.skills[0].githubUrl == nil)
            #expect(payload.skills[0].gitRelativePath == nil)
            #expect(payload.skills[0].skillMdSha == nil)
            #expect(!String(decoding: try JSONEncoder().encode(payload), as: UTF8.self).contains("secret"))
        }
    }

    @Test func presenceNormalizesRepositoryRootAndAcceptsSafeHTTPS() throws {
        let skill = makeSkill(name: "Local", githubUrl: "https://GitHub.com/Owner/Repo.git/",
            installCmd: "/tmp/local", origin: "Agents", isLocalOnly: false, gitRelativePath: ".")
        let row = try #require(SkillSyncService.presencePayload(installations: [skill]).skills.first)
        #expect(row.githubUrl == "https://github.com/owner/repo")
        #expect(row.gitRelativePath == "")
    }

    @Test func presenceRefusesLimitsAndDuplicateLocationsWithoutTruncating() throws {
        let skill = makeSkill(name: "Local", githubUrl: "", installCmd: "/tmp/local", origin: "Codex", isLocalOnly: true)
        #expect(throws: PresenceSyncError.tooManyInstallations) {
            try SkillSyncService.presencePayload(installations: Array(repeating: skill, count: 1001))
        }
        #expect(throws: PresenceSyncError.duplicateLocation) {
            try SkillSyncService.presencePayload(installations: [skill, skill])
        }
        #expect(try SkillSyncService.presencePayload(installations: []).skills.isEmpty)
        let invalid = makeSkill(name: "Local", githubUrl: "", installCmd: "/tmp/local", origin: "Unknown", isLocalOnly: true)
        #expect(throws: PresenceSyncError.invalidInstallation) { try SkillSyncService.presencePayload(installations: [invalid]) }
    }

    @Test func presenceDoesNotChangeLegacyOneTimePayloadJSON() throws {
        let skill = makeSkill(name: "Local", githubUrl: "", installCmd: "/tmp/local", origin: "Codex", isLocalOnly: true)
        let data = try JSONEncoder().encode(SkillSyncService.payload(token: " old-token ", installations: [skill]))
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let rows = try #require(body["skills"] as? [[String: Any]])
        #expect(Set(body.keys) == ["token", "skills"])
        #expect(body["token"] as? String == "old-token")
        #expect(rows[0]["stableKey"] as? String == "location:v1:codex:local")
        #expect(rows[0]["identityStatus"] as? String == "localOnly")
    }

    @Test func reconciliationEncodesExplicitNullRevisionAndOnlyCoverageFacts() throws {
        let roots: [InventoryRootCoverage] = [
            .init(source: "claude", state: .complete, reason: nil),
            .init(source: "codex", state: .incomplete, reason: .changed),
            .init(source: "agents", state: .unavailable, reason: .missing)
        ]
        let scan = InstalledSkillsScanner.ScanResult(skills: [], installations: [], summary: .init(), roots: roots)
        let report = try SkillSyncService.reconciliationPayload(baseRevision: nil, scan: scan)
        let body = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(report)) as? [String: Any])
        #expect(Set(body.keys) == ["reportVersion", "baseRevision", "roots", "skills"])
        #expect(body["reportVersion"] as? Int == 3)
        #expect(body["baseRevision"] is NSNull)
        let rows = try #require(body["roots"] as? [[String: Any]])
        #expect(Set(rows[0].keys) == ["source", "state"])
        #expect(rows[2]["reason"] as? String == "missing")
        let revision = UUID().uuidString
        #expect(try SkillSyncService.reconciliationPayload(baseRevision: revision, scan: scan).baseRevision == revision.lowercased())
        #expect(throws: PresenceSyncError.invalidRevision) {
            try SkillSyncService.reconciliationPayload(baseRevision: "not-a-revision", scan: scan)
        }
    }

    @Test func reconciliationRejectsInvalidOrIncompleteCoverageContracts() throws {
        let complete: [InventoryRootCoverage] = ["claude", "codex", "agents"].map { .init(source: $0, state: .complete, reason: nil) }
        for roots in [Array(complete.dropLast()), [complete[0], complete[0], complete[2]],
            [.init(source: "unknown", state: .complete, reason: nil), complete[1], complete[2]],
            [.init(source: "claude", state: .complete, reason: .missing), complete[1], complete[2]],
            [.init(source: "claude", state: .incomplete, reason: .missing), complete[1], complete[2]],
            [.init(source: "claude", state: .unavailable, reason: nil), complete[1], complete[2]]] {
            let scan = InstalledSkillsScanner.ScanResult(skills: [], installations: [], summary: .init(), roots: roots)
            #expect(throws: PresenceSyncError.invalidCoverage) { try SkillSyncService.reconciliationPayload(baseRevision: nil, scan: scan) }
        }
        let broken = InstalledSkillsScanner.ScanResult(skills: [], installations: [], summary: .init(),
            issues: [.skippedSkill(source: "Codex", folder: "bad")], roots: complete)
        #expect(throws: PresenceSyncError.invalidCoverage) { try SkillSyncService.reconciliationPayload(baseRevision: nil, scan: broken) }
    }

    @Test func reconciliationNeverTruncatesDuplicateInvalidOrOversizeObservations() throws {
        let roots: [InventoryRootCoverage] = ["claude", "codex", "agents"].map { .init(source: $0, state: .complete, reason: nil) }
        let skill = makeSkill(name: "Local", githubUrl: "", installCmd: "/tmp/local", origin: "Codex", isLocalOnly: true)
        for (skills, error) in [(Array(repeating: skill, count: 1001), PresenceSyncError.tooManyInstallations),
            ([skill, skill], .duplicateLocation),
            ([makeSkill(name: "", githubUrl: "", installCmd: "/tmp/local", origin: "Codex", isLocalOnly: true)], .invalidInstallation)] {
            let scan = InstalledSkillsScanner.ScanResult(skills: skills, installations: skills, summary: .init(), roots: roots)
            #expect(throws: error) { try SkillSyncService.reconciliationPayload(baseRevision: nil, scan: scan) }
        }
        let legacy = try SkillSyncService.presencePayload(installations: [skill])
        #expect(legacy.reportVersion == 2)
    }

    @Test func inventoryComparisonIgnoresOrderAndRevisionButComparesEveryReportedField() {
        let roots: [InventoryRootCoverage] = ["claude", "codex", "agents"].map { .init(source: $0, state: .complete, reason: nil) }
        let original = PresenceSyncSkill(source: "codex", installationPath: "fixture", name: "Fixture", description: "Description",
            skillMdSha: nil, githubUrl: nil, gitRelativePath: nil, catalogSkillIdHint: nil)
        let other = PresenceSyncSkill(source: "claude", installationPath: "fixture", name: "Other", description: "",
            skillMdSha: nil, githubUrl: nil, gitRelativePath: nil, catalogSkillIdHint: nil)
        let baseline = ReconciliationSyncPayload(baseRevision: nil, roots: roots, skills: [original, other])
        #expect(baseline.hasSameInventory(as: .init(baseRevision: UUID().uuidString,
            roots: roots.reversed(), skills: [other, original])))
        let changes: [PresenceSyncSkill] = [
            .init(source: "agents", installationPath: original.installationPath, name: original.name, description: original.description,
                skillMdSha: nil, githubUrl: nil, gitRelativePath: nil, catalogSkillIdHint: nil),
            .init(source: original.source, installationPath: "renamed", name: original.name, description: original.description,
                skillMdSha: nil, githubUrl: nil, gitRelativePath: nil, catalogSkillIdHint: nil),
            .init(source: original.source, installationPath: original.installationPath, name: "Renamed", description: original.description,
                skillMdSha: nil, githubUrl: nil, gitRelativePath: nil, catalogSkillIdHint: nil),
            .init(source: original.source, installationPath: original.installationPath, name: original.name, description: "Changed",
                skillMdSha: nil, githubUrl: nil, gitRelativePath: nil, catalogSkillIdHint: nil),
            .init(source: original.source, installationPath: original.installationPath, name: original.name, description: original.description,
                skillMdSha: String(repeating: "a", count: 64), githubUrl: nil, gitRelativePath: nil, catalogSkillIdHint: nil),
            .init(source: original.source, installationPath: original.installationPath, name: original.name, description: original.description,
                skillMdSha: nil, githubUrl: "https://github.com/a/b", gitRelativePath: nil, catalogSkillIdHint: nil),
            .init(source: original.source, installationPath: original.installationPath, name: original.name, description: original.description,
                skillMdSha: nil, githubUrl: nil, gitRelativePath: "", catalogSkillIdHint: nil),
            .init(source: original.source, installationPath: original.installationPath, name: original.name, description: original.description,
                skillMdSha: nil, githubUrl: nil, gitRelativePath: nil, catalogSkillIdHint: "catalog:a/b")]
        for changed in changes {
            let modified = ReconciliationSyncPayload(baseRevision: nil, roots: roots, skills: [changed, other])
            #expect(!baseline.hasSameInventory(as: modified))
            #expect(!modified.hasSameInventory(as: baseline))
        }
        #expect(!baseline.hasSameInventory(as: .init(baseRevision: nil, roots: roots, skills: [original])))
        var changedRoots = roots
        changedRoots[0] = .init(source: "claude", state: .unavailable, reason: .missing)
        let partial = ReconciliationSyncPayload(baseRevision: nil, roots: changedRoots, skills: baseline.skills)
        #expect(!baseline.hasSameInventory(as: partial))
        changedRoots[0].reason = .unreadable
        #expect(!partial.hasSameInventory(as: .init(baseRevision: nil, roots: changedRoots, skills: baseline.skills)))
    }

    @Test func canceledReconciliationEncodingSubmitsNothing() async {
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            let scan = InstalledSkillsScanner.ScanResult(skills: [], installations: [], summary: .init())
            return try SkillSyncService.reconciliationPayload(baseRevision: nil, scan: scan)
        }
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    private func makeSkill(
        name: String,
        githubUrl: String,
        installCmd: String,
        origin: String,
        isLocalOnly: Bool,
        skillMdSha: String? = nil,
        catalogSkillId: String? = nil,
        identityStatus: SkillIdentityStatus? = nil,
        gitRelativePath: String? = nil,
        installedFromSet: String? = nil
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
            gitRelativePath: gitRelativePath,
            catalogSkillId: catalogSkillId,
            identityStatus: identityStatus,
            installedFromSet: installedFromSet
        )
    }
}

private final class EmptyBundleMarker {}
