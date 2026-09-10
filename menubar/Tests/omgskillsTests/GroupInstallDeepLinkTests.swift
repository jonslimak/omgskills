import Foundation
import Testing
@testable import omgskills

struct GroupInstallDeepLinkTests {
    @Test func parsesTheCanonicalPublicGroupURL() throws {
        let url = try #require(URL(string:
            "omgskills://group?url=https%3A%2F%2Fomgskills.com%2Fu%2FJon%2Fsets%2FTeam-Skills"
        ))

        #expect(
            GroupInstallDeepLink.route(from: url)
                == (try DeviceGroupManifestRoute(handle: "jon", groupSlug: "team-skills"))
        )
    }

    @Test func rejectsUntrustedOrAmbiguousLinks() throws {
        let invalidLinks = [
            "https://omgskills.com/u/jon/sets/team-skills",
            "omgskills://pair?url=https%3A%2F%2Fomgskills.com%2Fu%2Fjon%2Fsets%2Fteam-skills",
            "omgskills://group?url=https%3A%2F%2Fevil.example%2Fu%2Fjon%2Fsets%2Fteam-skills",
            "omgskills://group?url=http%3A%2F%2Fomgskills.com%2Fu%2Fjon%2Fsets%2Fteam-skills",
            "omgskills://group?url=https%3A%2F%2Fomgskills.com%2Fu%2Fjon%2Fsets%2Fteam-skills%3Fx%3D1",
            "omgskills://group?url=https%3A%2F%2Fomgskills.com%2Fu%2Fjon%2Fsets%2Fteam-skills%2F",
            "omgskills://group?url=https%3A%2F%2Fomgskills.com%2Fu%2Fjon%2Fsets%2Fteam-skills&extra=1",
            "omgskills://group?url=https%3A%2F%2Fomgskills.com%2Fu%2Fjon%2Fsets%2Fteam-skills&url=https%3A%2F%2Fomgskills.com%2Fu%2Fjon%2Fsets%2Fother",
        ]

        for rawValue in invalidLinks {
            let url = try #require(URL(string: rawValue))
            #expect(GroupInstallDeepLink.route(from: url) == nil)
        }
    }

    @Test func classifiesGroupPairingAndUnsupportedURLsWithoutOverlap() throws {
        let groupURL = try #require(URL(string:
            "omgskills://group?url=https%3A%2F%2Fomgskills.com%2Fu%2Fjon%2Fsets%2Fteam-skills"
        ))
        let pairingURL = try #require(URL(string: "omgskills://pair?state=state&code=pair_value"))
        let unsupportedURL = try #require(URL(string: "omgskills://unknown"))

        #expect(GroupInstallDeepLink.classify(groupURL) == .group(
            try DeviceGroupManifestRoute(handle: "jon", groupSlug: "team-skills")
        ))
        #expect(GroupInstallDeepLink.classify(pairingURL) == .pairing(pairingURL))
        #expect(GroupInstallDeepLink.classify(unsupportedURL) == .unsupported)
    }
}
