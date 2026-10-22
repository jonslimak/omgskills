import CoreFoundation
import Foundation

enum SetupTestUpdateConfiguration {
    static let enabledKey = "OMGSkillsSetupTestUpdatesEnabled"
    static let baseURL = "https://omgskills-setup-test-f3b.netlify.app/updates/f3d/"
    static let feedURL = baseURL + "appcast.xml"
    static let versions = ["2": "0.1.1", "3": "0.1.2"]
    static let policy: [String: Bool] = [
        "SUEnableAutomaticChecks": false, "SUAutomaticallyUpdate": false,
        "SUAllowsAutomaticUpdates": false, "SUEnableSystemProfiling": false,
        "SUVerifyUpdateBeforeExtraction": true, "SURequireSignedFeed": true,
    ]

    static func validate(_ info: [String: Any]) throws -> Bool {
        let updateKeys = Set(info.keys.filter { $0.hasPrefix("SU") })
        guard info[enabledKey] != nil else {
            guard updateKeys.isEmpty else { throw InvalidConfiguration() }
            return false
        }
        let expectedKeys = Set(policy.keys).union(["SUFeedURL", "SUPublicEDKey", "SUSignedFeedFailureExpirationInterval"])
        guard info["CFBundleIdentifier"] as? String == SetupTestRuntime.bundleID,
              boolean(info[enabledKey]) == true, updateKeys == expectedKeys,
              info["SUFeedURL"] as? String == feedURL,
              let build = info["CFBundleVersion"] as? String,
              let version = versions[build], info["CFBundleShortVersionString"] as? String == version,
              let key = info["SUPublicEDKey"] as? String, let bytes = Data(base64Encoded: key),
              bytes.count == 32, bytes.contains(where: { $0 != 0 }), bytes.base64EncodedString() == key,
              let expiration = info["SUSignedFeedFailureExpirationInterval"] as? NSNumber,
              CFGetTypeID(expiration) != CFBooleanGetTypeID(), expiration == 0,
              policy.allSatisfy({ boolean(info[$0.key]) == $0.value }) else { throw InvalidConfiguration() }
        return true
    }

    static func acceptsArchive(url: URL?, build: String, version: String, installationType: String, isDelta: Bool) -> Bool {
        versions[build] == version && installationType == "application" && !isDelta
            && url?.absoluteString == baseURL + "OMGSkills-Setup-Test-\(version)-arm64.zip"
    }

    private static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    private struct InvalidConfiguration: Error {}
}
