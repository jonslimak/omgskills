import Foundation

enum AppRuntimeConfiguration {
    static let bundledLibraryPreviewKey = "OMGSkillsBundledLibraryPreview"
    static let skillGroupsAuthEnabledKey = "OMGSkillsSkillGroupsAuthEnabled"
    static let skillGroupsAuthPreviewEnvironmentKey = "OMGSKILLS_SKILLGROUPS_AUTH_ENABLED"

    static var usesBundledLibraryPreview: Bool {
        usesBundledLibraryPreview(infoDictionary: Bundle.main.infoDictionary ?? [:])
    }

    static func usesBundledLibraryPreview(
        infoDictionary: [String: Any]
    ) -> Bool {
        infoDictionary[bundledLibraryPreviewKey] as? Bool == true
    }

    static var skillGroupsAuthEnabled: Bool {
        skillGroupsAuthEnabled(
            infoDictionary: Bundle.main.infoDictionary ?? [:],
            environment: ProcessInfo.processInfo.environment
        )
    }

    static func skillGroupsAuthEnabled(
        infoDictionary: [String: Any],
        environment: [String: String]
    ) -> Bool {
        if environment[skillGroupsAuthPreviewEnvironmentKey] == "1" {
            return true
        }
        return infoDictionary[skillGroupsAuthEnabledKey] as? Bool == true
    }
}
