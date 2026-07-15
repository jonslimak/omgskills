import Testing
@testable import omgskills

struct AnalyticsTests {
    @Test func appVersionParametersIncludeVersionAndBuild() {
        let parameters = Analytics.appVersionParameters()

        #expect(parameters["app_version"]?.isEmpty == false)
        #expect(parameters["build_number"]?.isEmpty == false)
    }

    @Test func identityResolutionSignalUsesOnlyPrivacySafeAggregateParameters() throws {
        let measurement = SkillIdentityMeasurement(
            resolvedByProvenance: 1,
            resolvedByGit: 2,
            resolvedBySha: 3,
            ambiguous: 4,
            localOnly: 5
        )
        var emittedName: String?
        var emittedParameters: [String: String]?

        Analytics.signalIdentityResolution(measurement, track: .crawl4) { name, parameters in
            emittedName = name
            emittedParameters = parameters
        }

        let parameters = try #require(emittedParameters)
        let allowedKeys: Set<String> = [
            "app_version",
            "build_number",
            "track",
            "total_installed",
            "resolved_by_provenance",
            "resolved_by_git",
            "resolved_by_sha",
            "ambiguous",
            "local_only"
        ]
        let bucketKeys = [
            "resolved_by_provenance",
            "resolved_by_git",
            "resolved_by_sha",
            "ambiguous",
            "local_only"
        ]
        let bucketValues = bucketKeys.compactMap { key in
            parameters[key].flatMap(Int.init)
        }

        #expect(emittedName == "identity.resolution_snapshot")
        #expect(Set(parameters.keys) == allowedKeys)
        #expect(parameters["track"] == LibraryDataTrack.crawl4.rawValue)
        #expect(parameters["total_installed"] == "15")
        #expect(parameters["resolved_by_provenance"] == "1")
        #expect(parameters["resolved_by_git"] == "2")
        #expect(parameters["resolved_by_sha"] == "3")
        #expect(parameters["ambiguous"] == "4")
        #expect(parameters["local_only"] == "5")
        #expect(bucketValues.count == bucketKeys.count)
        #expect(bucketValues.reduce(0, +) == measurement.totalInstalled)
    }
}
