import Foundation

enum SkillInstallPolicy: Equatable, Sendable { case existingBehavior, newOnly }

enum CatalogInstallFilesystem {
    static func exists(_ url: URL) -> Bool {
        (try? FileManager.default.attributesOfItem(atPath: url.path)) != nil
    }

    static func requireDirectoryChain(_ url: URL, under anchor: URL) throws {
        let root = anchor.standardizedFileURL
        let path = url.standardizedFileURL
        guard path == root || path.path.hasPrefix(root.path + "/") else {
            throw SkillInstaller.InstallError.destinationConflict
        }
        var current = root
        let suffix = path.path.dropFirst(root.path.count)
        for part in [""] + suffix.split(separator: "/").map(String.init) {
            if !part.isEmpty { current.appendPathComponent(part) }
            if exists(current) {
                let attributes = try FileManager.default.attributesOfItem(atPath: current.path)
                guard attributes[.type] as? FileAttributeType == .typeDirectory else {
                    throw SkillInstaller.InstallError.destinationConflict
                }
            }
        }
    }

    static func requireVacant(root: URL, name: String) throws {
        guard !exists(root.appendingPathComponent(name)),
              !exists(SkillInstallProvenanceStore.metadataURL(targetRoot: root, targetName: name)) else {
            throw SkillInstaller.InstallError.destinationConflict
        }
    }

    static func identity(_ url: URL) throws -> [UInt64] {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let inode = attributes[.systemFileNumber] as? NSNumber,
              let device = attributes[.systemNumber] as? NSNumber else {
            throw SkillInstaller.InstallError.destinationConflict
        }
        return [device.uint64Value, inode.uint64Value]
    }
}
