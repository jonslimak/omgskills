import Testing
@testable import omgskills

struct AnalyticsTests {
    @Test func appVersionParametersIncludeVersionAndBuild() {
        let parameters = Analytics.appVersionParameters()

        #expect(parameters["app_version"]?.isEmpty == false)
        #expect(parameters["build_number"]?.isEmpty == false)
    }
}
