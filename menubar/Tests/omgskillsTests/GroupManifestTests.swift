import Foundation
import Testing
@testable import omgskills

struct GroupManifestTests {
    @Test func decodesSharedServerClientFixture() throws {
        let manifest = try decode(fixtureData())

        #expect(manifest.type == GroupManifest.expectedType)
        #expect(manifest.version == GroupManifest.supportedVersion)
        #expect(manifest.group.revision == 7)
        #expect(manifest.items.count == 13)
        #expect(manifest.items.map(\.position) == Array(0..<13))

        guard case let .installable(source, release) = manifest.items[0].installability else {
            Issue.record("Expected catalog item to be installable")
            return
        }
        #expect(source == .catalog(
            id: "20000000-0000-4000-8000-000000000001",
            catalogSkillID: "openai/codex:code-review",
            normalizedRoot: "skills/code-review"
        ))
        #expect(release.coordinates == SkillPackageCoordinates(
            commitSha: String(repeating: "1", count: 40),
            treeSha: String(repeating: "2", count: 40),
            skillMdSha: String(repeating: "3", count: 40)
        ))

        let reasons = manifest.items.compactMap { item -> GroupManifestMetadataOnlyReason? in
            guard case let .metadataOnly(reason) = item.installability else { return nil }
            return reason
        }
        #expect(Set(reasons) == Set(GroupManifestMetadataOnlyReason.allCases))
    }

    @Test func acceptsUnknownAdditiveFields() throws {
        var object = try fixtureObject()
        object["futureField"] = ["nested": true]
        var group = try #require(object["group"] as? [String: Any])
        group["futureGroupField"] = "value"
        object["group"] = group

        #expect(try decode(JSONSerialization.data(withJSONObject: object)).items.count == 13)
    }

    @Test func rejectsUnsupportedTypeAndVersion() throws {
        var wrongType = try fixtureObject()
        wrongType["type"] = "other.manifest"
        #expect(throws: GroupManifestValidationError.unexpectedType("other.manifest")) {
            try decode(JSONSerialization.data(withJSONObject: wrongType))
        }

        var wrongVersion = try fixtureObject()
        wrongVersion["version"] = 3
        #expect(throws: GroupManifestValidationError.unsupportedVersion(3)) {
            try decode(JSONSerialization.data(withJSONObject: wrongVersion))
        }
    }

    @Test func rejectsUnknownContractEnums() throws {
        for (existing, replacement) in [
            ("\"kind\": \"catalog\"", "\"kind\": \"unknown\""),
            ("\"status\": \"installable\"", "\"status\": \"unknown\""),
            ("\"reason\": \"release_unavailable\"", "\"reason\": \"unknown\"")
        ] {
            let text = try #require(String(data: fixtureData(), encoding: .utf8))
            let data = Data(text.replacingOccurrences(of: existing, with: replacement).utf8)
            #expect(throws: DecodingError.self) {
                try decode(data)
            }
        }
    }

    @Test func rejectsMalformedCoordinates() throws {
        let text = try #require(String(data: fixtureData(), encoding: .utf8))
        let data = Data(text.replacingOccurrences(
            of: String(repeating: "1", count: 40),
            with: "not-a-sha"
        ).utf8)

        #expect(throws: GroupManifestValidationError.invalidField("release.commitSha")) {
            try decode(data)
        }
    }

    @Test func rejectsDuplicateIDsAndInvalidOrdering() throws {
        var duplicate = try fixtureObject()
        var duplicateItems = try #require(duplicate["items"] as? [[String: Any]])
        duplicateItems[1]["id"] = duplicateItems[0]["id"]
        duplicate["items"] = duplicateItems
        let duplicateID = try #require(duplicateItems[0]["id"] as? String)
        #expect(throws: GroupManifestValidationError.duplicateItemID(duplicateID)) {
            try decode(JSONSerialization.data(withJSONObject: duplicate))
        }

        var unordered = try fixtureObject()
        var unorderedItems = try #require(unordered["items"] as? [[String: Any]])
        unorderedItems[1]["position"] = 4
        unordered["items"] = unorderedItems
        #expect(throws: GroupManifestValidationError.invalidPosition(expected: 1, actual: 4)) {
            try decode(JSONSerialization.data(withJSONObject: unordered))
        }
    }

    @Test func rejectsExcessiveItemCount() throws {
        var object = try fixtureObject()
        let baseItem = try #require((object["items"] as? [[String: Any]])?.last)
        var items: [[String: Any]] = []
        for position in 0...GroupManifest.maximumItemCount {
            var item = baseItem
            item["id"] = "item-\(position)"
            item["position"] = position
            items.append(item)
        }
        object["items"] = items

        #expect(throws: GroupManifestValidationError.tooManyItems(1_001)) {
            try decode(JSONSerialization.data(withJSONObject: object))
        }
    }

    @Test func routeNormalizesValidSegmentsAndRejectsUnsafeValues() throws {
        #expect(
            try DeviceGroupManifestRoute(handle: " OpenAI ", groupSlug: "Team-Skills")
                == DeviceGroupManifestRoute(handle: "openai", groupSlug: "team-skills")
        )

        for handle in ["", "two words", "owner/repo", "-owner", "owner-"] {
            #expect(throws: DeviceGroupManifestRouteError.invalidHandle) {
                try DeviceGroupManifestRoute(handle: handle, groupSlug: "team-skills")
            }
        }
        #expect(throws: DeviceGroupManifestRouteError.invalidGroupSlug) {
            try DeviceGroupManifestRoute(handle: "owner", groupSlug: "../private")
        }
    }

    private func decode(_ data: Data) throws -> GroupManifest {
        try JSONDecoder().decode(GroupManifest.self, from: data)
    }

    private func fixtureObject() throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: fixtureData()) as? [String: Any])
    }

    private func fixtureData() throws -> Data {
        let url = try #require(Bundle.module.url(
            forResource: "group-manifest-v2",
            withExtension: "json",
            subdirectory: "Fixtures"
        ))
        return try Data(contentsOf: url)
    }
}
