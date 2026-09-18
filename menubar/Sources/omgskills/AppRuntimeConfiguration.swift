import Foundation

enum AppRuntimeConfiguration {
    static let bundledLibraryPreviewKey = "OMGSkillsBundledLibraryPreview"
    static let skillGroupsAuthEnabledKey = "OMGSkillsSkillGroupsAuthEnabled"
    static let skillGroupsAuthPreviewEnvironmentKey = "OMGSKILLS_SKILLGROUPS_AUTH_ENABLED"
    static let debugReleaseConfigurationURLEnvironmentKey = "OMGSKILLS_DEBUG_RELEASE_CONFIG_URL"
    static let debugGroupInstallRootEnvironmentKey = "OMGSKILLS_DEBUG_GROUP_INSTALL_ROOT"
    static let debugCatalogPathEnvironmentKey = "OMGSKILLS_DEBUG_CATALOG_PATH"
    static let productionReleaseConfigurationURL = URL(
        string: "https://omgskills.com/app/release-config.json"
    )!

    enum CatalogTestMode: Equatable, Sendable {
        case disabled
        case enabled(root: URL, catalog: URL)
        case invalid(String)
    }

    struct RuntimeContext: Equatable, Sendable {
        let catalogTestMode: CatalogTestMode
        let usesBundledLibraryPreview: Bool
        let testCatalogURL: URL?
        let skillFilesystemPaths: SkillFilesystemPaths
        let groupInstallRuntimePaths: GroupInstallRuntimePaths
    }

    static var runtimeContext: RuntimeContext {
        runtimeContext(
            infoDictionary: Bundle.main.infoDictionary ?? [:],
            environment: ProcessInfo.processInfo.environment
        )
    }

    static var usesBundledLibraryPreview: Bool {
        runtimeContext.usesBundledLibraryPreview
    }

    static func usesBundledLibraryPreview(
        infoDictionary: [String: Any],
        environment: [String: String] = [:],
        fileManager: FileManager = .default,
        debugOverridesAllowed: Bool = buildAllowsCatalogTestMode
    ) -> Bool {
        runtimeContext(
            infoDictionary: infoDictionary,
            environment: environment,
            fileManager: fileManager,
            debugOverridesAllowed: debugOverridesAllowed
        ).usesBundledLibraryPreview
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
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        debugOverridesAllowed: Bool = buildAllowsCatalogTestMode
    ) -> GroupInstallRuntimePaths {
        runtimeContext(
            infoDictionary: infoDictionary,
            environment: environment,
            fileManager: fileManager,
            debugOverridesAllowed: debugOverridesAllowed
        ).groupInstallRuntimePaths
    }

    static func runtimeContext(
        infoDictionary: [String: Any],
        environment: [String: String],
        fileManager: FileManager = .default,
        debugOverridesAllowed: Bool = buildAllowsCatalogTestMode
    ) -> RuntimeContext {
        let productionFilesystemPaths = SkillFilesystemPaths.production(fileManager: fileManager)
        let testMode = catalogTestMode(
            environment: environment,
            fileManager: fileManager,
            debugOverridesAllowed: debugOverridesAllowed
        )
        let bundledPreview = infoDictionary[bundledLibraryPreviewKey] as? Bool == true

        switch testMode {
        case .enabled(let root, let catalog):
            let filesystemPaths = SkillFilesystemPaths.isolated(testRoot: root)
            return RuntimeContext(
                catalogTestMode: testMode,
                usesBundledLibraryPreview: true,
                testCatalogURL: catalog,
                skillFilesystemPaths: filesystemPaths,
                groupInstallRuntimePaths: GroupInstallRuntimePaths(
                    homeDirectory: filesystemPaths.homeDirectory,
                    managedRoot: root.appendingPathComponent("managed", isDirectory: true),
                    pathAnchor: filesystemPaths.homeDirectory
                )
            )
        case .disabled, .invalid:
            return RuntimeContext(
                catalogTestMode: testMode,
                usesBundledLibraryPreview: bundledPreview,
                testCatalogURL: nil,
                skillFilesystemPaths: productionFilesystemPaths,
                groupInstallRuntimePaths: .production(fileManager: fileManager)
            )
        }
    }

    private static func catalogTestMode(
        environment: [String: String],
        fileManager: FileManager,
        debugOverridesAllowed: Bool
    ) -> CatalogTestMode {
        guard debugOverridesAllowed else { return .disabled }

        let rawRoot = environment[debugGroupInstallRootEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let rawCatalog = environment[debugCatalogPathEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let requested = rawRoot?.isEmpty == false || rawCatalog?.isEmpty == false
        guard requested else { return .disabled }
        guard let rawRoot, !rawRoot.isEmpty, let rawCatalog, !rawCatalog.isEmpty else {
            return .invalid("Both the test root and test catalog are required")
        }
        guard rawRoot.hasPrefix("/"), rawCatalog.hasPrefix("/") else {
            return .invalid("The test root and test catalog must use absolute paths")
        }

        let root = URL(fileURLWithPath: rawRoot, isDirectory: true).standardizedFileURL
        let catalog = URL(fileURLWithPath: rawCatalog, isDirectory: false).standardizedFileURL
        let resolvedRoot = root.resolvingSymlinksInPath()
        let productionHome = fileManager.homeDirectoryForCurrentUser.resolvingSymlinksInPath()
        guard resolvedRoot.path != "/",
              resolvedRoot != productionHome,
              !resolvedRoot.path.hasPrefix(productionHome.path + "/")
        else {
            return .invalid("The test root cannot be the filesystem root or inside the user home")
        }

        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: catalog.path, isDirectory: &isDirectory),
              !isDirectory.boolValue,
              let data = try? Data(contentsOf: catalog)
        else {
            return .invalid("The test catalog must be an existing local file")
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let skills = try? decoder.decode([Skill].self, from: data), !skills.isEmpty else {
            return .invalid("The test catalog must contain at least one valid skill")
        }
        return .enabled(root: resolvedRoot, catalog: catalog)
    }

    private static var buildAllowsCatalogTestMode: Bool {
        #if OMGSKILLS_DEBUG_GROUP_INSTALL_ROOT_OVERRIDE
        true
        #else
        false
        #endif
    }
}

struct GroupInstallRuntimePaths: Equatable, Sendable {
    let homeDirectory: URL
    let managedRoot: URL
    let pathAnchor: URL

    static var production: GroupInstallRuntimePaths {
        production(fileManager: .default)
    }

    static func production(fileManager: FileManager) -> GroupInstallRuntimePaths {
        GroupInstallRuntimePaths(
            homeDirectory: fileManager.homeDirectoryForCurrentUser,
            managedRoot: ManagedSkillInstaller.defaultManagedRoot,
            pathAnchor: fileManager.homeDirectoryForCurrentUser
        )
    }
}
