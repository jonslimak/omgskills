import Foundation

struct PinnedSkillInstallMetadata: Equatable, Sendable {
    let repositorySlug: String
    let skillMDPath: String
    let packageRoot: String
    let coordinates: SkillPackageCoordinates
    let targetName: String
}

enum PinnedSkillInstallMetadataState: Equatable, Sendable {
    case legacy
    case complete(PinnedSkillInstallMetadata)
    case invalid
}

extension Skill {
    var pinnedInstallMetadataState: PinnedSkillInstallMetadataState {
        let newFields: [String?] = [repoSlug, repoCommitSha, skillTreeSha, installTargetName]
        guard newFields.contains(where: { $0 != nil }) else {
            return .legacy
        }

        guard let repositorySlug = repoSlug?.trimmingCharacters(in: .whitespacesAndNewlines),
              GitHubRepositorySlug.normalized(repositorySlug) == repositorySlug,
              let skillMDPath = skillMdPath?.trimmingCharacters(in: .whitespacesAndNewlines),
              let packageRoot = Self.packageRoot(from: skillMDPath),
              let commitSHA = Self.normalizedGitSHA(repoCommitSha),
              let treeSHA = Self.normalizedGitSHA(skillTreeSha),
              let skillMDSHA = Self.normalizedGitSHA(skillMdSha),
              let targetName = installTargetName?.trimmingCharacters(in: .whitespacesAndNewlines),
              targetName.range(
                of: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                options: .regularExpression
              ) != nil,
              targetName != ".",
              targetName != ".."
        else {
            return .invalid
        }

        return .complete(PinnedSkillInstallMetadata(
            repositorySlug: repositorySlug,
            skillMDPath: skillMDPath,
            packageRoot: packageRoot,
            coordinates: SkillPackageCoordinates(
                commitSha: commitSHA,
                treeSha: treeSHA,
                skillMdSha: skillMDSHA
            ),
            targetName: targetName
        ))
    }

    var installModeTelemetryValue: String {
        switch pinnedInstallMetadataState {
        case .legacy: return "legacy"
        case .complete: return "pinned"
        case .invalid: return "invalid"
        }
    }

    private static func packageRoot(from skillMDPath: String) -> String? {
        guard !skillMDPath.isEmpty,
              !skillMDPath.hasPrefix("/"),
              !skillMDPath.contains("\\"),
              !skillMDPath.unicodeScalars.contains(where: {
                  CharacterSet.controlCharacters.contains($0)
              })
        else {
            return nil
        }

        let components = skillMDPath.split(separator: "/", omittingEmptySubsequences: false)
        guard components.last == "SKILL.md",
              components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." })
        else {
            return nil
        }
        return components.count == 1
            ? "."
            : components.dropLast().joined(separator: "/")
    }

    private static func normalizedGitSHA(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              value.utf8.count == 40,
              value.utf8.allSatisfy({ byte in
                  (48...57).contains(byte) || (65...70).contains(byte) || (97...102).contains(byte)
              })
        else {
            return nil
        }
        return value.lowercased()
    }
}
