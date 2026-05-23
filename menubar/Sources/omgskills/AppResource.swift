import Foundation

enum AppResource {
    static let inspectableShadowSkillsFilename = "skills.inspectable.shadow.json"

    static func url(forResource name: String, withExtension ext: String) -> URL? {
        let filename = "\(name).\(ext)"
        let bundleURL = Bundle.main.bundleURL
        let resourceURL = Bundle.main.resourceURL

        let candidates: [URL?] = [
            Bundle.main.url(forResource: name, withExtension: ext),
            resourceURL?.appendingPathComponent(filename),
            resourceURL?.appendingPathComponent("omgskills_omgskills.bundle/Resources/\(filename)"),
            bundleURL.appendingPathComponent("omgskills_omgskills.bundle/Resources/\(filename)"),
            bundleURL.deletingLastPathComponent().appendingPathComponent("omgskills_omgskills.bundle/Resources/\(filename)"),
            URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Resources/\(filename)")
        ]

        return candidates.compactMap { $0 }.first { FileManager.default.fileExists(atPath: $0.path) }
    }

    static func shadowSkillsURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL? {
        if let override = environment["OMGSKILLS_SHADOW_LIBRARY_PATH"], !override.isEmpty {
            let url = URL(fileURLWithPath: override)
            if fileManager.fileExists(atPath: url.path) {
                return url
            }
        }

        return shadowSkillsURLCandidates().first { fileManager.fileExists(atPath: $0.path) }
    }

    static func shadowSkillsURLCandidates() -> [URL] {
        let bundleURL = Bundle.main.bundleURL.standardizedFileURL
        let sourceRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .standardizedFileURL

        return [
            sourceRoot.appendingPathComponent("index/shadow/\(inspectableShadowSkillsFilename)"),
            bundleURL
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("index/shadow/\(inspectableShadowSkillsFilename)")
                .standardizedFileURL,
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("index/shadow/\(inspectableShadowSkillsFilename)")
                .standardizedFileURL
        ]
    }
}
