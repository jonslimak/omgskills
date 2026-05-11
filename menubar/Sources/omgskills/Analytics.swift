import Foundation
import TelemetryDeck

enum Analytics {
    private static let appID = "9641DEC0-3FCD-47DA-872C-4325CE6A561B"
    private static let namespace = "com.omgskills"
    private static let installTrackedKey = "com.omgskills.telemetry.installTracked"

    static func start() {
        let config = TelemetryDeck.Config(appID: appID, namespace: namespace)
        TelemetryDeck.initialize(config: config)
        trackFirstInstallIfNeeded()
        signal("app.launched")
    }

    static func signal(_ name: String, parameters: [String: String] = [:]) {
        TelemetryDeck.signal(name, parameters: parameters)
        TelemetryDeck.requestImmediateSync()
    }

    private static func trackFirstInstallIfNeeded() {
        guard !UserDefaults.standard.bool(forKey: installTrackedKey) else { return }

        signal("app.installed")
        UserDefaults.standard.set(true, forKey: installTrackedKey)
    }
}
