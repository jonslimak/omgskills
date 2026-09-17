import Foundation

enum AppRuntimeConfiguration {
    static let bundledLibraryPreviewKey = "OMGSkillsBundledLibraryPreview"
    static let skillGroupsAuthEnabledKey = "OMGSkillsSkillGroupsAuthEnabled"
    static let skillGroupsAuthPreviewEnvironmentKey = "OMGSKILLS_SKILLGROUPS_AUTH_ENABLED"
    static let debugReleaseConfigurationURLEnvironmentKey = "OMGSKILLS_DEBUG_RELEASE_CONFIG_URL"
    static let debugGroupInstallRootEnvironmentKey = "OMGSKILLS_DEBUG_GROUP_INSTALL_ROOT"
    static let debugGroupInstallRootInfoKey = "OMGSkillsDebugGroupInstallRoot"
    static let productionReleaseConfigurationURL = URL(
        string: "https://omgskills.com/app/release-config.json"
    )!

    static var usesBundledLibraryPreview: Bool {
        usesBundledLibraryPreview(infoDictionary: Bundle.main.infoDictionary ?? [:])
    }

    static func usesBundledLibraryPreview(
        infoDictionary: [String: Any]
    ) -> Bool {
        infoDictionary[bundledLibraryPreviewKey] as? Bool == true
    }

    static var skillGroupsAuthSupported: Bool {
        skillGroupsAuthSupported(
            infoDictionary: Bundle.main.infoDictionary ?? [:],
            environment: ProcessInfo.processInfo.environment
        )
    }

    static func skillGroupsAuthSupported(
        infoDictionary: [String: Any],
        environment: [String: String]
    ) -> Bool {
        if environment[skillGroupsAuthPreviewEnvironmentKey] == "1" {
            return true
        }
        return infoDictionary[skillGroupsAuthEnabledKey] as? Bool == true
    }

    static var skillGroupsReleaseConfigurationURL: URL {
        skillGroupsReleaseConfigurationURL(environment: ProcessInfo.processInfo.environment)
    }

    static func skillGroupsReleaseConfigurationURL(
        environment: [String: String]
    ) -> URL {
        #if OMGSKILLS_DEBUG_RELEASE_CONFIG_OVERRIDE
        if let rawValue = environment[debugReleaseConfigurationURLEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !rawValue.isEmpty,
           let url = URL(string: rawValue),
           let scheme = url.scheme?.lowercased(),
           scheme == "https" || (scheme == "http" && url.host?.lowercased() == "localhost")
                || (scheme == "http" && url.host == "127.0.0.1") {
            return url
        }
        #endif
        return productionReleaseConfigurationURL
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
