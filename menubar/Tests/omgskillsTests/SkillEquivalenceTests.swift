import Foundation
import Testing
@testable import omgskills

struct SkillEquivalenceTests {
    @Test func validAssetBuildsLookupsAndSupportsFutureAgentKeys() throws {
        let asset = try decodeAsset("""
        {
          "version": 1,
          "generatedAt": "2026-07-16T00:00:00Z",
          "groups": [{
            "id": "group-a",
            "memberSkillIds": ["owner/repo:claude", "owner/repo:codex"],
            "representativeSkillId": "owner/repo:claude",
            "preferredSkillIds": {
              "claude": "owner/repo:claude",
              "future-agent": "owner/repo:codex"
            },
            "confidence": "high",
            "evidence": ["same-repo", "exact-name"]
          }]
        }
        """)
        let index = SkillEquivalenceIndex(
            asset: asset,
            liveSkillIds: ["owner/repo:claude", "owner/repo:codex"]
        )

        let group = try #require(index.group(containing: "owner/repo:codex"))
        #expect(index.group(id: "group-a") == group)
        #expect(group.preferredSkillId(for: "Claude") == "owner/repo:claude")
        #expect(group.preferredSkillId(for: "future-agent") == "owner/repo:codex")
        #expect(group.preferredSkillId(for: "agents") == "owner/repo:claude")
    }

    @Test func staleMembersDissolveGroupsBelowTwoLiveMembers() throws {
        let asset = try decodeAsset("""
        {
          "version": 1,
          "groups": [{
            "id": "group-a",
            "memberSkillIds": ["owner/repo:a", "owner/repo:b"],
            "representativeSkillId": "owner/repo:a",
            "preferredSkillIds": {},
            "confidence": "high",
            "evidence": ["same-repo"]
          }]
        }
        """)
        let index = SkillEquivalenceIndex(
            asset: asset,
            liveSkillIds: ["owner/repo:b"]
        )

        #expect(index.groups.isEmpty)
        #expect(index.group(containing: "owner/repo:b") == nil)
    }

    @Test func staleRepresentativeUsesFirstSortedLiveMember() throws {
        let asset = try decodeAsset("""
        {
          "version": 1,
          "groups": [{
            "id": "group-a",
            "memberSkillIds": ["owner/repo:c", "owner/repo:b", "owner/repo:a"],
            "representativeSkillId": "owner/repo:c",
            "preferredSkillIds": {
              "claude": "owner/repo:c",
              "codex": "owner/repo:b"
            },
            "confidence": "high",
            "evidence": ["same-repo"]
          }]
        }
        """)
        let index = SkillEquivalenceIndex(
            asset: asset,
            liveSkillIds: ["owner/repo:a", "owner/repo:b"]
        )

        let group = try #require(index.group(id: "group-a"))
        #expect(group.memberSkillIds == ["owner/repo:a", "owner/repo:b"])
        #expect(group.representativeSkillId == "owner/repo:a")
        #expect(group.preferredSkillId(for: "claude") == "owner/repo:a")
        #expect(group.preferredSkillId(for: "codex") == "owner/repo:b")
    }

    @Test func overlappingGroupsRejectTheWholeAsset() {
        #expect(throws: (any Error).self) {
            try decodeAsset("""
            {
              "version": 1,
              "groups": [
                {
                  "id": "group-a",
                  "memberSkillIds": ["owner/repo:a", "owner/repo:b"],
                  "representativeSkillId": "owner/repo:a",
                  "preferredSkillIds": {},
                  "confidence": "high",
                  "evidence": []
                },
                {
                  "id": "group-b",
                  "memberSkillIds": ["owner/repo:b", "owner/repo:c"],
                  "representativeSkillId": "owner/repo:b",
                  "preferredSkillIds": {},
                  "confidence": "high",
                  "evidence": []
                }
              ]
            }
            """)
        }
    }

    @Test func invalidRepresentativeAndPreferenceRejectTheAsset() {
        #expect(throws: (any Error).self) {
            try decodeAsset("""
            {
              "version": 1,
              "groups": [{
                "id": "group-a",
                "memberSkillIds": ["owner/repo:a", "owner/repo:b"],
                "representativeSkillId": "owner/repo:missing",
                "preferredSkillIds": {},
                "confidence": "high",
                "evidence": []
              }]
            }
            """)
        }

        #expect(throws: (any Error).self) {
            try decodeAsset("""
            {
              "version": 1,
              "groups": [{
                "id": "group-a",
                "memberSkillIds": ["owner/repo:a", "owner/repo:b"],
                "representativeSkillId": "owner/repo:a",
                "preferredSkillIds": { "codex": "owner/repo:missing" },
                "confidence": "high",
                "evidence": []
              }]
            }
            """)
        }
    }

    private func decodeAsset(_ json: String) throws -> SkillEquivalenceAsset {
        try JSONDecoder().decode(
            SkillEquivalenceAsset.self,
            from: Data(json.utf8)
        )
    }
}
