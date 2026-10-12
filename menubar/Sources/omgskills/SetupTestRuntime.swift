import Foundation

enum SetupTestRuntime {
    static let bundleID = "com.jonslimak.omgskills.setuptest"
    static let websiteKey = "OMGSkillsSetupTestWebsite"
    static var buildAllowed: Bool {
        #if OMGSKILLS_SETUP_TEST
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
        let website: URL
        var stateRoot: URL { home.appendingPathComponent("Library/Application Support/OMGSkills Setup Test", isDirectory: true) }
        var managedRoot: URL { stateRoot.appendingPathComponent("managed", isDirectory: true) }
        var paths: SkillFilesystemPaths {
            SkillFilesystemPaths(homeDirectory: home, legacyRepoCacheRoot: stateRoot.appendingPathComponent("unused-repos"))
        }

        // Only candidate state is created on launch. Skill directories belong to the reviewed writer.
        func prepareStorage() throws {
            try validateStorage()
            try FileManager.default.createDirectory(at: stateRoot, withIntermediateDirectories: true)
            try validateStorage()
        }

        func validateStorage() throws {
            let fm = FileManager.default
            guard home.isFileURL, home.path != "/", home.standardizedFileURL == home,
                  home.resolvingSymlinksInPath().path == home.path,
                  (try fm.attributesOfItem(atPath: home.path)[.type] as? FileAttributeType) == .typeDirectory else {
                throw PublicSkillReviewError.destinationConflict
            }
            var path = home
            for part in ["Library", "Application Support", "OMGSkills Setup Test", "managed"] {
                path.appendPathComponent(part, isDirectory: true)
                if fm.fileExists(atPath: path.path) || (try? fm.destinationOfSymbolicLink(atPath: path.path)) != nil {
                    guard (try fm.attributesOfItem(atPath: path.path)[.type] as? FileAttributeType) == .typeDirectory else {
                        throw PublicSkillReviewError.destinationConflict
                    }
                }
            }
        }
    }

    static func mode(info: [String: Any] = Bundle.main.infoDictionary ?? [:],
                     home: URL = FileManager.default.homeDirectoryForCurrentUser,
                     allowed: Bool = buildAllowed) -> Mode {
        let requested = allowed || info["CFBundleIdentifier"] as? String == bundleID || info[websiteKey] != nil
        guard requested else { return .disabled }
        guard allowed, info["CFBundleIdentifier"] as? String == bundleID,
              let types = info["CFBundleURLTypes"] as? [[String: Any]], types.count == 1,
              types[0]["CFBundleURLSchemes"] as? [String] == [PublicSkillInstallClient.setupTest.rawValue],
              info[AppRuntimeConfiguration.f1RootKey] == nil, info[AppRuntimeConfiguration.f1WebsiteKey] == nil,
              info["SUFeedURL"] == nil, info["SUPublicEDKey"] == nil,
              let rawWebsite = info[websiteKey] as? String,
              let website = URL(string: rawWebsite), website.user == nil, website.password == nil,
              website.fragment == nil,
              (website.scheme == "https" && website.port == nil
                && (website.host == "omgskills.com"
                    || rawWebsite == "https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/"))
                || (website.scheme == "http" && ["127.0.0.1", "localhost"].contains(website.host ?? "") && website.port != nil) else {
            return .invalid("Invalid setup-test build, identity or website configuration.")
        }
        let configuration = Configuration(home: home.standardizedFileURL, website: website)
        do { try configuration.validateStorage() }
        catch { return .invalid("The setup-test storage is unavailable or redirected.") }
        return .enabled(configuration)
    }
}
