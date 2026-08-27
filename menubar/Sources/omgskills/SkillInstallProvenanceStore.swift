import Foundation

enum SkillInstallProvenanceStore {
    static func metadataURL(targetRoot: URL, targetName: String) -> URL {
        targetRoot
            .appendingPathComponent(".omgskills", isDirectory: true)
            .appendingPathComponent("\(targetName).json")
    }

    static func read(targetRoot: URL, targetName: String) -> SkillInstallProvenance? {
        let url = metadataURL(targetRoot: targetRoot, targetName: targetName)
        if let data = try? Data(contentsOf: url),
           let provenance = try? JSONDecoder().decode(SkillInstallProvenance.self, from: data) {
            return provenance
        }

        let installationURL = targetRoot.appendingPathComponent(targetName, isDirectory: true)
        guard let managedURL = managedMetadataURL(for: installationURL),
              let data = try? Data(contentsOf: managedURL)
        else { return nil }
        return try? JSONDecoder().decode(SkillInstallProvenance.self, from: data)
    }

    static func skillMdSha(at skillFileURL: URL) throws -> String {
        let data = try Data(contentsOf: skillFileURL)
        return SkillIdentityResolver.gitBlobSHA(for: data)
    }

    static func write(
        catalogSkillId: String,
        githubUrl: String,
        skillMdSha: String,
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
            installedAt: formatter.string(from: Date()),
            skillMdSha: skillMdSha
        )
        try write(provenance, to: metadataURL(targetRoot: targetRoot, targetName: targetName))
    }

    static func write(_ provenance: SkillInstallProvenance, to url: URL) throws {
        let data = try JSONEncoder().encode(provenance)
        try data.write(to: url, options: .atomic)
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

    private static func managedMetadataURL(for installationURL: URL) -> URL? {
        guard let destination = try? FileManager.default.destinationOfSymbolicLink(
            atPath: installationURL.path
        ) else { return nil }

        let destinationURL: URL
        if destination.hasPrefix("/") {
            destinationURL = URL(fileURLWithPath: destination, isDirectory: true)
        } else {
            destinationURL = installationURL.deletingLastPathComponent()
                .appendingPathComponent(destination, isDirectory: true)
        }
        guard destinationURL.lastPathComponent == "content" else { return nil }
        return destinationURL.deletingLastPathComponent()
            .appendingPathComponent("provenance.json")
    }
}
