import Foundation

enum SkillInstallProvenanceStore {
    static func metadataURL(targetRoot: URL, targetName: String) -> URL {
        targetRoot
            .appendingPathComponent(".omgskills", isDirectory: true)
            .appendingPathComponent("\(targetName).json")
    }

    static func read(targetRoot: URL, targetName: String) -> SkillInstallProvenance? {
        let url = metadataURL(targetRoot: targetRoot, targetName: targetName)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(SkillInstallProvenance.self, from: data)
    }

    static func write(
        catalogSkillId: String,
        githubUrl: String,
        targetRoot: URL,
        targetName: String
    ) throws {
        let metadataRoot = targetRoot.appendingPathComponent(".omgskills", isDirectory: true)
        try FileManager.default.createDirectory(at: metadataRoot, withIntermediateDirectories: true)

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let provenance = SkillInstallProvenance(
            catalogSkillId: catalogSkillId,
            githubUrl: githubUrl,
            installedAt: formatter.string(from: Date())
        )
        let data = try JSONEncoder().encode(provenance)
        try data.write(
            to: metadataURL(targetRoot: targetRoot, targetName: targetName),
            options: .atomic
        )
    }

    @discardableResult
    static func removeIfOrphaned(
        targetRoot: URL,
        targetName: String,
        installationURL: URL,
        fileManager: FileManager = .default
    ) throws -> Bool {
        let skillFile = installationURL.appendingPathComponent("SKILL.md")
        guard !fileManager.fileExists(atPath: skillFile.path) else { return false }

        let url = metadataURL(targetRoot: targetRoot, targetName: targetName)
        guard fileManager.fileExists(atPath: url.path) else { return false }
        try fileManager.removeItem(at: url)
        return true
    }
}
