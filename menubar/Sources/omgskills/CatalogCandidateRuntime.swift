import CoreFoundation
import Foundation

enum CatalogCandidateRuntime {
    static let enabledKey = "OMGSkillsCatalogCandidate"
    static let websiteKey = "OMGSkillsCatalogCandidateWebsite"
    static let updateKey = "OMGSkillsCatalogCandidateUpdatePublicKey"
    static let bundleID = "com.jonslimak.omgskills"
    static let origin = URL(string: "https://omgskills-setup-test-f3b.netlify.app")!
    static let website = origin.appendingPathComponent("app", isDirectory: true)
    static let updateBase = origin.absoluteString + "/updates/catalog-candidate/"
    static let feedURL = updateBase + "appcast.xml"
    static let updatePolicy: [String: Bool] = [
        "SUEnableAutomaticChecks": false, "SUAutomaticallyUpdate": false,
        "SUAllowsAutomaticUpdates": false, "SUEnableSystemProfiling": false,
        "SUVerifyUpdateBeforeExtraction": true, "SURequireSignedFeed": true,
    ]

    static var buildRequested: Bool {
        #if OMGSKILLS_CATALOG_CANDIDATE
        true
        #else
        false
        #endif
    }

    static var buildAllowed: Bool {
        #if OMGSKILLS_CATALOG_CANDIDATE && !OMGSKILLS_SETUP_TEST
        true
        #else
        false
        #endif
    }

    enum Mode: Equatable, Sendable {
        case disabled
        case enabled(Configuration)
        case invalid(String)
    }

    struct Configuration: Equatable, Sendable {
        let home: URL
        let connected: ConnectedCandidateConfiguration?
        var paths: SkillFilesystemPaths {
            SkillFilesystemPaths(homeDirectory: home,
                legacyRepoCacheRoot: stateRoot.appendingPathComponent("repos", isDirectory: true))
        }
        var stateRoot: URL { home.appendingPathComponent("Library/Application Support/omgskills", isDirectory: true) }
        var managedRoot: URL { stateRoot.appendingPathComponent("managed", isDirectory: true) }
        fileprivate init(home: URL, connected: ConnectedCandidateConfiguration?) {
            self.home = home
            self.connected = connected
        }
    }

    static func mode(info: [String: Any] = Bundle.main.infoDictionary ?? [:],
                     home: URL = FileManager.default.homeDirectoryForCurrentUser,
                     allowed: Bool = buildAllowed,
                     connectedAllowed: Bool = ConnectedCandidateConfiguration.buildAllowed) -> Mode {
        let connected: ConnectedCandidateConfiguration?
        switch ConnectedCandidateConfiguration.mode(info: info, allowed: connectedAllowed) {
        case .disabled: connected = nil
        case .enabled(let configuration): connected = configuration
        case .invalid: return .invalid("Invalid connected candidate configuration.")
        }
        guard allowed || buildRequested || connected != nil || info[enabledKey] != nil || info[websiteKey] != nil || info[updateKey] != nil
        else { return .disabled }
        let updateKeys = Set(info.keys.filter { $0.hasPrefix("SU") })
        let expectedKeys = Set(updatePolicy.keys).union(["SUFeedURL", "SUPublicEDKey", "SUSignedFeedFailureExpirationInterval"])
        guard allowed, boolean(info[enabledKey]) == true,
              info["CFBundleIdentifier"] as? String == bundleID,
              let types = info["CFBundleURLTypes"] as? [[String: Any]], types.count == 1,
              types[0]["CFBundleURLSchemes"] as? [String] == ["omgskills"],
              info[websiteKey] as? String == website.absoluteString,
              info["LSMinimumSystemVersion"] as? String == "14.0",
              boolean(info["LSUIElement"]) == true, boolean(info["LSMultipleInstancesProhibited"]) == true,
              info[AppRuntimeConfiguration.f1RootKey] == nil, info[AppRuntimeConfiguration.f1WebsiteKey] == nil,
              info[AppRuntimeConfiguration.catalogInstallEnabledKey] == nil,
              info[SetupTestRuntime.websiteKey] == nil, info[SetupTestUpdateConfiguration.enabledKey] == nil,
              boolean(info[AppRuntimeConfiguration.skillGroupsAuthEnabledKey]) != true,
              let version = info["CFBundleShortVersionString"] as? String,
              let build = info["CFBundleVersion"] as? String, validVersion(version, build: build),
              updateKeys == expectedKeys, info["SUFeedURL"] as? String == feedURL,
              let key = info[updateKey] as? String, info["SUPublicEDKey"] as? String == key,
              let bytes = Data(base64Encoded: key), bytes.count == 32,
              bytes.contains(where: { $0 != 0 }), bytes.base64EncodedString() == key,
              let expiration = info["SUSignedFeedFailureExpirationInterval"] as? NSNumber,
              CFGetTypeID(expiration) != CFBooleanGetTypeID(), expiration == 0,
              updatePolicy.allSatisfy({ boolean(info[$0.key]) == $0.value })
        else { return .invalid("Invalid catalog candidate build, identity or update configuration.") }
        guard home.isFileURL, home.path != "/", home.standardizedFileURL == home,
              home.resolvingSymlinksInPath().path == home.path,
              (try? FileManager.default.attributesOfItem(atPath: home.path)[.type] as? FileAttributeType) == .typeDirectory
        else { return .invalid("The catalog candidate home is unavailable or redirected.") }
        return .enabled(Configuration(home: home, connected: connected))
    }

    static func acceptsArchive(url: URL?, build: String, version: String, installationType: String, isDelta: Bool) -> Bool {
        validVersion(version, build: build) && installationType == "application" && !isDelta
            && url?.absoluteString == updateBase + "OMGSkills-Catalog-Candidate-\(version)-\(build)-arm64.zip"
    }

    private static func validVersion(_ version: String, build: String) -> Bool {
        version.range(of: "^[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}$", options: .regularExpression) != nil
            && build.range(of: "^[1-9][0-9]{0,8}$", options: .regularExpression) != nil
    }

    private static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }
}
