import CoreFoundation
import Foundation
import HandoffCore

package enum HelperUpdateConfiguration {
    // Reserved for the helper. Creating or hosting this feed is a separate release gate.
    package static let feed = "https://omgskills.com/helper/updates/appcast.xml"

    package static func validate(_ info: [String: Any]) throws -> Bool {
        guard info["CFBundleIdentifier"] as? String == HelperIdentity.bundleID else { throw ConfigurationFailure.invalid }
        for (key, expected) in ["SUEnableAutomaticChecks": false, "SUAutomaticallyUpdate": false,
                                "SUAllowsAutomaticUpdates": false, "SUEnableSystemProfiling": false,
                                "SUVerifyUpdateBeforeExtraction": true, "SURequireSignedFeed": true] {
            guard boolean(info[key]) == expected else { throw ConfigurationFailure.invalid }
        }
        guard let expiration = info["SUSignedFeedFailureExpirationInterval"] as? NSNumber,
              CFGetTypeID(expiration) != CFBooleanGetTypeID(), expiration == 0,
              info["SUDefaultsDomain"] == nil,
              info["SUFeedURL"] == nil || info["SUFeedURL"] as? String == feed,
              let enabled = boolean(info["OMGSkillsHelperUpdatesEnabled"]) else { throw ConfigurationFailure.invalid }
        if !enabled {
            guard info["SUFeedURL"] == nil, info["SUPublicEDKey"] == nil else { throw ConfigurationFailure.invalid }
            return false
        }
        guard info["SUFeedURL"] as? String == feed,
              let key = info["SUPublicEDKey"] as? String,
              let data = Data(base64Encoded: key), data.count == 32,
              data.contains(where: { $0 != 0 }), data.base64EncodedString() == key else { throw ConfigurationFailure.invalid }
        return true
    }

    private static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }
}

private enum ConfigurationFailure: Error { case invalid }
