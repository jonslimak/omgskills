import Foundation
import TelemetryDeck

enum Analytics {
    private static let appID = "9641DEC0-3FCD-47DA-872C-4325CE6A561B"
    private static let namespace = "com.omgskills"
    private static let installTrackedKey = "com.omgskills.telemetry.installTracked"
    private static let installTrackedV2Key = "com.omgskills.telemetry.installTracked.v2"

    static func start() {
        let config = TelemetryDeck.Config(appID: appID, namespace: namespace)
        TelemetryDeck.initialize(config: config)
        trackInstallState()
        signal("app.launched")
    }

    static func signal(_ name: String, parameters: [String: String] = [:]) {
        TelemetryDeck.signal(name, parameters: parameters)
        TelemetryDeck.requestImmediateSync()
    }

    private static func trackInstallState() {
        let defaults = UserDefaults.standard
        let legacyInstallTracked = defaults.bool(forKey: installTrackedKey)
        let v2InstallTracked = defaults.bool(forKey: installTrackedV2Key)

        signal("app.install_state", parameters: installStateParameters(
            legacyInstallTracked: legacyInstallTracked,
            v2InstallTracked: v2InstallTracked
        ))

        if !legacyInstallTracked && !v2InstallTracked {
            signal("app.first_launch_candidate", parameters: appVersionParameters())
            signal("app.installed", parameters: appVersionParameters())
            signal("app.installed.v2", parameters: appVersionParameters())
            defaults.set(true, forKey: installTrackedKey)
            defaults.set(true, forKey: installTrackedV2Key)
        } else if legacyInstallTracked && !v2InstallTracked {
            defaults.set(true, forKey: installTrackedV2Key)
        } else if !legacyInstallTracked && v2InstallTracked {
            defaults.set(true, forKey: installTrackedKey)
        }
    }

    private static func installStateParameters(
        legacyInstallTracked: Bool,
        v2InstallTracked: Bool
    ) -> [String: String] {
        var parameters = appVersionParameters()
        parameters["legacy_install_tracked"] = legacyInstallTracked ? "true" : "false"
        parameters["v2_install_tracked"] = v2InstallTracked ? "true" : "false"
        return parameters
    }

    private static func appVersionParameters() -> [String: String] {
        [
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            "build_number": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"
        ]
    }
}
