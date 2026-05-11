import Foundation

enum AppResource {
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
}
