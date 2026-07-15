import CryptoKit
import Foundation

struct CanonicalShaEntry: Codable, Equatable, Sendable {
    let skillId: String
    let confidence: String
    let reason: String
}

struct ShaHistoryAsset: Codable, Sendable {
    let version: Int
    let generatedAt: String?
    let shaToSkillIds: [String: [String]]
    let canonicalBySha: [String: CanonicalShaEntry]?

    init(
        version: Int,
        generatedAt: String?,
        shaToSkillIds: [String: [String]],
        canonicalBySha: [String: CanonicalShaEntry]? = nil
    ) {
        self.version = version
        self.generatedAt = generatedAt
        self.shaToSkillIds = shaToSkillIds
        self.canonicalBySha = canonicalBySha
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        shaToSkillIds = try container.decode([String: [String]].self, forKey: .shaToSkillIds)
        canonicalBySha = try? container.decodeIfPresent(
            [String: CanonicalShaEntry].self,
            forKey: .canonicalBySha
        )
    }
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

    var totalInstalled: Int {
        resolvedByProvenance + resolvedByGit + resolvedBySha + ambiguous + localOnly
    }
}

struct SkillIdentityResolver: Sendable {
    private let catalogIds: Set<String>
    private let catalogByNormalizedRepoAndPath: [String: [String]]
    private let catalogByNormalizedRepoAndName: [String: [String]]
    private let shaHistory: [String: [String]]
    private let canonicalSkillIdBySha: [String: String]

    init(catalogSkills: [Skill], shaHistory: ShaHistoryAsset?) {
        let catalogIds = Set(catalogSkills.map(\.id))
        self.catalogIds = catalogIds

        var byRepoAndPath: [String: Set<String>] = [:]
        var byRepoAndName: [String: Set<String>] = [:]
        for skill in catalogSkills {
            guard let repo = Self.normalizedRepo(from: skill.githubUrl) else { continue }
            let path = Self.normalizedRelativePath(Self.catalogRelativePath(from: skill.id))
            let name = Self.normalizedName(skill.name)
            byRepoAndPath["\(repo):\(path)", default: []].insert(skill.id)
            byRepoAndName["\(repo):\(name)", default: []].insert(skill.id)
        }
        catalogByNormalizedRepoAndPath = byRepoAndPath.mapValues { $0.sorted() }
        catalogByNormalizedRepoAndName = byRepoAndName.mapValues { $0.sorted() }

        var validShaHistory: [String: [String]] = [:]
        for (sha, ids) in shaHistory?.shaToSkillIds ?? [:] {
            let liveIds = ids.filter { catalogIds.contains($0) }.sorted()
            if !liveIds.isEmpty {
                validShaHistory[sha.lowercased()] = liveIds
            }
        }
        self.shaHistory = validShaHistory

        var catalogShaById: [String: String] = [:]
        for skill in catalogSkills {
            if let sha = skill.skillMdSha?.lowercased() {
                catalogShaById[skill.id] = sha
            }
        }
        var validCanonicalIds: [String: String] = [:]
        for (sha, entry) in shaHistory?.canonicalBySha ?? [:] {
            guard Self.isGitBlobSHA(sha),
                  entry.confidence == "high",
                  entry.reason == "same-repo",
                  shaHistory?.shaToSkillIds[sha]?.contains(entry.skillId) == true,
                  catalogIds.contains(entry.skillId),
                  catalogShaById[entry.skillId] == sha else {
                continue
            }
            validCanonicalIds[sha] = entry.skillId
        }
        canonicalSkillIdBySha = validCanonicalIds
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

        var ambiguousGitIds: [String] = []
        if let repo = Self.normalizedRepo(from: skill.githubUrl) {
            if let relativePath = skill.gitRelativePath {
                let pathKey = "\(repo):\(Self.normalizedRelativePath(relativePath))"
                let pathMatches = catalogByNormalizedRepoAndPath[pathKey] ?? []
                if pathMatches.count == 1, let id = pathMatches.first {
                    return (id, .resolved(method: .git))
                }
                if !pathMatches.isEmpty {
                    ambiguousGitIds = pathMatches
                }
            }

            if ambiguousGitIds.isEmpty {
                let nameKey = "\(repo):\(Self.normalizedName(skill.name))"
                let nameMatches = catalogByNormalizedRepoAndName[nameKey] ?? []
                if nameMatches.count == 1, let id = nameMatches.first {
                    return (id, .resolved(method: .git))
                }
                ambiguousGitIds = nameMatches
            }
        }

        if let sha = skill.skillMdSha?.lowercased(),
           let ids = shaHistory[sha] {
            let compatibleIds: [String]
            if ambiguousGitIds.isEmpty {
                compatibleIds = ids
            } else {
                let gitIds = Set(ambiguousGitIds)
                compatibleIds = ids.filter(gitIds.contains)
            }

            if compatibleIds.count == 1, let id = compatibleIds.first {
                return (id, .resolved(method: .sha))
            }
            if compatibleIds.count > 1 {
                if let canonicalId = canonicalSkillIdBySha[sha],
                   compatibleIds.contains(canonicalId) {
                    return (canonicalId, .resolved(method: .sha))
                }
                return (nil, .ambiguous(skillIds: compatibleIds))
            }
        }

        if !ambiguousGitIds.isEmpty {
            return (nil, .ambiguous(skillIds: ambiguousGitIds))
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

    private static func isGitBlobSHA(_ value: String) -> Bool {
        value.utf8.count == 40 && value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (97...102).contains(byte)
        }
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

    static func catalogRelativePath(from catalogSkillId: String) -> String {
        guard let separator = catalogSkillId.firstIndex(of: ":") else { return "." }
        return String(catalogSkillId[catalogSkillId.index(after: separator)...])
    }

    static func normalizedRelativePath(_ value: String) -> String {
        var path = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if path.hasPrefix("./") {
            path.removeFirst(2)
        }
        while path.count > 1, path.hasSuffix("/") {
            path.removeLast()
        }
        return path.isEmpty ? "." : path.lowercased()
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
            gitRelativePath: gitRelativePath,
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
