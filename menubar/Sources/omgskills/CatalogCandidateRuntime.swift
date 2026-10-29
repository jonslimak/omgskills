import CoreFoundation
import Foundation

enum CatalogRuntimeProfile: Equatable, Sendable {
    case candidate, production

    static var compiled: Self {
        #if OMGSKILLS_CONNECTED_PRODUCTION
        .production
        #else
        .candidate
        #endif
    }
    var origin: URL { URL(string: self == .production ? "https://omgskills.com" : "https://omgskills-setup-test-f3b.netlify.app")! }
    var website: URL { origin.appendingPathComponent("app", isDirectory: true) }
    var catalogPrefix: String { self == .production ? "OMGSkillsCatalogProduction" : "OMGSkillsCatalogCandidate" }
    var connectedPrefix: String { self == .production ? "OMGSkillsConnectedProduction" : "OMGSkillsConnectedCandidate" }
    var catalogKeys: [String] { [catalogPrefix, catalogPrefix + "Website", catalogPrefix + "UpdatePublicKey"] }
    var connectedKeys: [String] { [connectedPrefix, connectedPrefix + "ConnectURL", connectedPrefix + "UploadURL", connectedPrefix + "CredentialService"] }
    var connectURL: URL {
        let base = origin.appendingPathComponent("app/connect")
        return self == .production ? URL(string: base.absoluteString + "?inventory=3")! : base
    }
    var uploadURL: URL { origin.appendingPathComponent("api/portal/sync-upload") }
    var credentialService: String {
        self == .production ? "com.jonslimak.omgskills.connected.inventory" : "com.jonslimak.omgskills.catalog-candidate.inventory"
    }
    var updateBase: String { origin.absoluteString + (self == .production ? "/updates/connected/" : "/updates/catalog-candidate/") }
    var feedURL: String { updateBase + "appcast.xml" }
    var archivePrefix: String { self == .production ? "OMGSkills-Connected" : "OMGSkills-Catalog-Candidate" }
}

enum CatalogCandidateRuntime {
    static let enabledKey = CatalogRuntimeProfile.compiled.catalogKeys[0]
    static let websiteKey = CatalogRuntimeProfile.compiled.catalogKeys[1]
    static let updateKey = CatalogRuntimeProfile.compiled.catalogKeys[2]
    static let bundleID = "com.jonslimak.omgskills"
    static let origin = CatalogRuntimeProfile.compiled.origin
    static let website = origin.appendingPathComponent("app", isDirectory: true)
    static let updateBase = CatalogRuntimeProfile.compiled.updateBase
    static let feedURL = updateBase + "appcast.xml"
    static let updatePolicy: [String: Bool] = [
        "SUEnableAutomaticChecks": false, "SUAutomaticallyUpdate": false,
        "SUAllowsAutomaticUpdates": false, "SUEnableSystemProfiling": false,
        "SUVerifyUpdateBeforeExtraction": true, "SURequireSignedFeed": true,
    ]

    static var buildRequested: Bool {
        #if OMGSKILLS_CATALOG_CANDIDATE || OMGSKILLS_CONNECTED_PRODUCTION
        true
        #else
        false
        #endif
    }

    static var buildAllowed: Bool {
        #if OMGSKILLS_CATALOG_CANDIDATE && !OMGSKILLS_SETUP_TEST && !(OMGSKILLS_CONNECTED_CANDIDATE && OMGSKILLS_CONNECTED_PRODUCTION)
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
        let profile: CatalogRuntimeProfile
        let connected: ConnectedCandidateConfiguration?
        var paths: SkillFilesystemPaths {
            SkillFilesystemPaths(homeDirectory: home,
                legacyRepoCacheRoot: stateRoot.appendingPathComponent("repos", isDirectory: true))
        }
        var stateRoot: URL { home.appendingPathComponent("Library/Application Support/omgskills", isDirectory: true) }
        var managedRoot: URL { stateRoot.appendingPathComponent("managed", isDirectory: true) }
        fileprivate init(home: URL, connected: ConnectedCandidateConfiguration?, profile: CatalogRuntimeProfile) {
            self.home = home
            self.connected = connected
            self.profile = profile
        }
    }

    static func mode(info: [String: Any] = Bundle.main.infoDictionary ?? [:],
                     home: URL = FileManager.default.homeDirectoryForCurrentUser,
                     allowed: Bool = buildAllowed,
                     connectedAllowed: Bool = ConnectedCandidateConfiguration.buildAllowed,
                     profile: CatalogRuntimeProfile = .compiled) -> Mode {
        let enabledKey = profile.catalogKeys[0], websiteKey = profile.catalogKeys[1], updateKey = profile.catalogKeys[2]
        let other: CatalogRuntimeProfile = profile == .production ? .candidate : .production
        guard !(other.catalogKeys + other.connectedKeys).contains(where: { info[$0] != nil })
        else { return .invalid("Mixed production and candidate configuration.") }
        let connected: ConnectedCandidateConfiguration?
        switch ConnectedCandidateConfiguration.mode(info: info, allowed: connectedAllowed, profile: profile) {
        case .disabled: connected = nil
        case .enabled(let configuration): connected = configuration
        case .invalid: return .invalid("Invalid connected candidate configuration.")
        }
        guard allowed || buildRequested || connected != nil || info[enabledKey] != nil || info[websiteKey] != nil || info[updateKey] != nil
        else { return .disabled }
        let updateKeys = Set(info.keys.filter { $0.hasPrefix("SU") })
        let expectedKeys = Set(updatePolicy.keys).union(["SUFeedURL", "SUPublicEDKey", "SUSignedFeedFailureExpirationInterval"])
        guard allowed, profile != .production || connected != nil, boolean(info[enabledKey]) == true,
              info["CFBundleIdentifier"] as? String == bundleID,
              let types = info["CFBundleURLTypes"] as? [[String: Any]], types.count == 1,
              types[0]["CFBundleURLSchemes"] as? [String] == ["omgskills"],
              info[websiteKey] as? String == profile.website.absoluteString,
              info["LSMinimumSystemVersion"] as? String == "14.0",
              boolean(info["LSUIElement"]) == true, boolean(info["LSMultipleInstancesProhibited"]) == true,
              info[AppRuntimeConfiguration.f1RootKey] == nil, info[AppRuntimeConfiguration.f1WebsiteKey] == nil,
              info[AppRuntimeConfiguration.catalogInstallEnabledKey] == nil,
              info[SetupTestRuntime.websiteKey] == nil, info[SetupTestUpdateConfiguration.enabledKey] == nil,
              profile == .production || boolean(info[AppRuntimeConfiguration.skillGroupsAuthEnabledKey]) != true,
              let version = info["CFBundleShortVersionString"] as? String,
              let build = info["CFBundleVersion"] as? String, validVersion(version, build: build),
              updateKeys == expectedKeys, info["SUFeedURL"] as? String == profile.feedURL,
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
        return .enabled(Configuration(home: home, connected: connected, profile: profile))
    }

    static func acceptsArchive(url: URL?, build: String, version: String, installationType: String, isDelta: Bool,
                               profile: CatalogRuntimeProfile = .compiled) -> Bool {
        validVersion(version, build: build) && installationType == "application" && !isDelta
            && url?.absoluteString == profile.updateBase + "\(profile.archivePrefix)-\(version)-\(build)-arm64.zip"
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
