import Foundation

/// The "Update automatically" option. On by default: the app checks when it opens, hourly and after the Mac wakes,
/// downloads a signed update quietly and restarts on it once no skill work is in progress.
enum AutomaticAppUpdates {
    static let defaultsKey = "OMGSkillsAutomaticAppUpdates"
    static let interval: TimeInterval = 60 * 60
    static let launchDelay: TimeInterval = 10

    static func enabled(in defaults: UserDefaults) -> Bool {
        defaults.object(forKey: defaultsKey) as? Bool ?? true
    }

    static var enabled: Bool {
        get { enabled(in: .standard) }
        set { UserDefaults.standard.set(newValue, forKey: defaultsKey) }
    }
}
