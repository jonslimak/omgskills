import CryptoKit
import Foundation

struct ShaHistoryAsset: Codable, Sendable {
    let version: Int
    let generatedAt: String?
    let shaToSkillIds: [String: [String]]
}

struct SkillInstallProvenance: Codable, Equatable, Sendable {
    let catalogSkillId: String
    let githubUrl: String
    let installedAt: String
}

struct SkillIdentityMeasurement: Equatable, Sendable {
    var resolvedByProvenance = 0
    var resolvedByGit = 0
    var resolvedBySha = 0
    var ambiguous = 0
    var localOnly = 0
}

struct SkillIdentityResolver: Sendable {
    private let catalogIds: Set<String>
    private let catalogByNormalizedRepoAndName: [String: Skill]
    private let shaHistory: [String: [String]]

    init(catalogSkills: [Skill], shaHistory: ShaHistoryAsset?) {
        let catalogIds = Set(catalogSkills.map(\.id))
        self.catalogIds = catalogIds

        var byRepoAndName: [String: Skill] = [:]
        for skill in catalogSkills {
            guard let repo = Self.normalizedRepo(from: skill.githubUrl) else { continue }
            let name = Self.normalizedName(skill.name)
            byRepoAndName["\(repo):\(name)"] = skill
        }
        catalogByNormalizedRepoAndName = byRepoAndName

        var validShaHistory: [String: [String]] = [:]
        for (sha, ids) in shaHistory?.shaToSkillIds ?? [:] {
            let liveIds = ids.filter { catalogIds.contains($0) }.sorted()
            if !liveIds.isEmpty {
                validShaHistory[sha.lowercased()] = liveIds
            }
        }
        self.shaHistory = validShaHistory
    }

    func resolve(_ skills: [Skill]) -> (skills: [Skill], measurement: SkillIdentityMeasurement) {
        var measurement = SkillIdentityMeasurement()
        let resolved = skills.map { skill in
            let result = resolve(skill)
            switch result.status {
            case .resolved(let method):
                switch method {
                case .provenance: measurement.resolvedByProvenance += 1
                case .git: measurement.resolvedByGit += 1
                case .sha: measurement.resolvedBySha += 1
                }
            case .ambiguous:
                measurement.ambiguous += 1
            case .localOnly:
                measurement.localOnly += 1
            }
            return skill.withIdentity(catalogSkillId: result.catalogSkillId, identityStatus: result.status)
        }
        return (resolved, measurement)
    }

    func resolve(_ skill: Skill) -> (catalogSkillId: String?, status: SkillIdentityStatus) {
        if let catalogSkillId = skill.catalogSkillId,
           catalogIds.contains(catalogSkillId) {
            return (catalogSkillId, .resolved(method: .provenance))
        }

        if let repo = Self.normalizedRepo(from: skill.githubUrl) {
            let key = "\(repo):\(Self.normalizedName(skill.name))"
            if let matched = catalogByNormalizedRepoAndName[key] {
                return (matched.id, .resolved(method: .git))
            }
        }

        if let sha = skill.skillMdSha?.lowercased(),
           let ids = shaHistory[sha] {
            if ids.count == 1, let id = ids.first {
                return (id, .resolved(method: .sha))
            }
            return (nil, .ambiguous(skillIds: ids))
        }

        return (nil, .localOnly)
    }

    static func gitBlobSHA(for data: Data) -> String {
        let header = Data("blob \(data.count)\0".utf8)
        var blob = Data()
        blob.append(header)
        blob.append(data)
        return Insecure.SHA1.hash(data: blob).map { String(format: "%02x", $0) }.joined()
    }

    static func normalizedRepo(from githubURL: String) -> String? {
        guard let url = URL(string: githubURL) else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count >= 2 else { return nil }
        var repo = parts[1]
        if repo.hasSuffix(".git") { repo.removeLast(4) }
        guard !parts[0].isEmpty, !repo.isEmpty else { return nil }
        return "\(parts[0])/\(repo)".lowercased()
    }

    static func normalizedName(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

private extension Skill {
    func withIdentity(catalogSkillId: String?, identityStatus: SkillIdentityStatus) -> Skill {
        Skill(
            id: id,
            name: name,
            description: description,
            githubUrl: githubUrl,
            installCmd: installCmd,
            authorHandle: authorHandle,
            tags: tags,
            readmeSnippet: readmeSnippet,
            stars: stars,
            lastUpdated: lastUpdated,
            firstSeen: firstSeen,
            skillMdSha: skillMdSha,
            installs: installs,
            trendingRank: trendingRank,
            trendingSource: trendingSource,
            origin: origin,
            isSymlink: isSymlink,
            isLocalOnly: isLocalOnly,
            publisherHandle: publisherHandle,
            publisherRepo: publisherRepo,
            provenanceType: provenanceType,
            authorConfidence: authorConfidence,
            catalogSkillId: catalogSkillId,
            identityStatus: identityStatus,
            sourceTag: sourceTag,
            sourceUrl: sourceUrl,
            tweetUrl: tweetUrl,
            tweetLikes: tweetLikes,
            tweetRetweets: tweetRetweets,
            tweetReplies: tweetReplies,
            tweetViews: tweetViews,
            tweetAuthorHandle: tweetAuthorHandle,
            tweetAuthorName: tweetAuthorName,
            tweetPostedAt: tweetPostedAt,
            tweetText: tweetText
        )
    }
}
