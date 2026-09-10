import Foundation

enum AppRuntimeConfiguration {
    static let bundledLibraryPreviewKey = "OMGSkillsBundledLibraryPreview"
    static let skillGroupsAuthEnabledKey = "OMGSkillsSkillGroupsAuthEnabled"
    static let skillGroupsAuthPreviewEnvironmentKey = "OMGSKILLS_SKILLGROUPS_AUTH_ENABLED"
    static let debugGroupInstallRootEnvironmentKey = "OMGSKILLS_DEBUG_GROUP_INSTALL_ROOT"
    static let debugGroupInstallRootInfoKey = "OMGSkillsDebugGroupInstallRoot"

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

    static func groupInstallRuntimePaths(
        infoDictionary: [String: Any] = Bundle.main.infoDictionary ?? [:],
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> GroupInstallRuntimePaths {
        #if OMGSKILLS_DEBUG_GROUP_INSTALL_ROOT_OVERRIDE
        let configuredRoot = environment[debugGroupInstallRootEnvironmentKey]
            ?? infoDictionary[debugGroupInstallRootInfoKey] as? String
        if let rawRoot = configuredRoot?.trimmingCharacters(in: .whitespacesAndNewlines),
           !rawRoot.isEmpty,
           rawRoot.hasPrefix("/") {
            let root = URL(fileURLWithPath: rawRoot, isDirectory: true).standardizedFileURL
            return GroupInstallRuntimePaths(
                homeDirectory: root.appendingPathComponent("home", isDirectory: true),
                managedRoot: root.appendingPathComponent("managed", isDirectory: true),
                pathAnchor: root.appendingPathComponent("home", isDirectory: true)
            )
        }
        #endif
        return .production
    }
}

struct GroupInstallRuntimePaths: Equatable, Sendable {
    let homeDirectory: URL
    let managedRoot: URL
    let pathAnchor: URL

    static let production = GroupInstallRuntimePaths(
        homeDirectory: FileManager.default.homeDirectoryForCurrentUser,
        managedRoot: ManagedSkillInstaller.defaultManagedRoot,
        pathAnchor: FileManager.default.homeDirectoryForCurrentUser
    )
}
