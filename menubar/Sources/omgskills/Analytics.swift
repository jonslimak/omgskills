import Foundation
import TelemetryDeck

enum Analytics {
    private static let appID = "9641DEC0-3FCD-47DA-872C-4325CE6A561B"
    private static let namespace = "com.omgskills"
    private static let installTrackedKey = "com.omgskills.telemetry.installTracked"
    private static let installTrackedV2Key = "com.omgskills.telemetry.installTracked.v2"
    static let identityResolutionSignalName = "identity.resolution_snapshot"

    static func start() {
        let config = TelemetryDeck.Config(appID: appID, namespace: namespace)
        TelemetryDeck.initialize(config: config)
        trackInstallState()
        signal("app.launched", parameters: appVersionParameters())
        signalPendingUpdateCompletionIfNeeded()
    }

    static func signal(_ name: String, parameters: [String: String] = [:]) {
        TelemetryDeck.signal(name, parameters: parameters)
        TelemetryDeck.requestImmediateSync()
    }

    static func signalIdentityResolution(
        _ measurement: SkillIdentityMeasurement,
        track: LibraryDataTrack
    ) {
        signalIdentityResolution(measurement, track: track) { name, parameters in
            signal(name, parameters: parameters)
        }
    }

    static func signalIdentityResolution(
        _ measurement: SkillIdentityMeasurement,
        track: LibraryDataTrack,
        emit: (_ name: String, _ parameters: [String: String]) -> Void
    ) {
        emit(
            identityResolutionSignalName,
            identityResolutionParameters(measurement, track: track)
        )
    }

    static func identityResolutionParameters(
        _ measurement: SkillIdentityMeasurement,
        track: LibraryDataTrack
    ) -> [String: String] {
        var parameters = appVersionParameters()
        parameters["track"] = track.rawValue
        parameters["total_installed"] = String(measurement.totalInstalled)
        parameters["resolved_by_provenance"] = String(measurement.resolvedByProvenance)
        parameters["resolved_by_git"] = String(measurement.resolvedByGit)
        parameters["resolved_by_sha"] = String(measurement.resolvedBySha)
        parameters["ambiguous"] = String(measurement.ambiguous)
        parameters["local_only"] = String(measurement.localOnly)
        return parameters
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

    static func appVersionParameters() -> [String: String] {
        [
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            "build_number": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"
        ]
    }

    static func updateParameters(
        appVersionParameters: [String: String] = appVersionParameters(),
        targetVersion: String?,
        targetBuild: String?
    ) -> [String: String] {
        var parameters = appVersionParameters
        parameters["target_version"] = targetVersion ?? "unknown"
        parameters["target_build"] = targetBuild ?? "unknown"
        return parameters
    }

    @discardableResult
    static func signalPendingUpdateCompletionIfNeeded(
        pendingStore: PendingUpdateInstallStore = PendingUpdateInstallStore(),
        currentVersion: String = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
        currentBuild: String = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown",
        emit: (_ name: String, _ parameters: [String: String]) -> Void = { name, parameters in
            signal(name, parameters: parameters)
        }
    ) -> Bool {
        guard let pending = pendingStore.load() else { return false }

        var parameters: [String: String] = [
            "app_version": currentVersion,
            "build_number": currentBuild,
            "source_version": pending.sourceVersion ?? "unknown",
            "source_build": pending.sourceBuild ?? "unknown",
            "target_version": pending.targetVersion ?? "unknown",
            "target_build": pending.targetBuild ?? "unknown"
        ]

        if pending.matches(currentVersion: currentVersion, currentBuild: currentBuild) {
            emit("app.update_completed", parameters)
        } else {
            parameters["reason"] = "launched_version_mismatch"
            emit("error.update_failed", parameters)
        }

        pendingStore.clear()
        return true
    }
}

extension PendingUpdateInstall {
    func matches(currentVersion: String, currentBuild: String) -> Bool {
        if let targetBuild {
            return targetBuild == currentBuild
        }

        if let targetVersion {
            return targetVersion == currentVersion
        }

        return false
    }
}
