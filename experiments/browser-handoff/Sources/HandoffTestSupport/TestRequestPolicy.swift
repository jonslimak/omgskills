import HandoffCore

extension HandoffRequestPolicy {
    public static let test = HandoffRequestPolicy(scheme: "omgskills-helper-test", skills: publicSkills)
    package static let discovery = HandoffRequestPolicy(scheme: "omgskills-helper-test",
                                                       skills: [DiscoveryFixture.id: "OMGSkills discovery check"])
}

extension HandoffRequest {
    package static func parseTest(_ raw: String, discoveryOnly: Bool = false) -> HandoffRequest? {
        parse(raw, policy: discoveryOnly ? .discovery : .test)
    }
}
