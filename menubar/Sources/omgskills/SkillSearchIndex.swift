import Foundation

final class SkillSearchIndex: @unchecked Sendable {
    private let documentsById: [String: SearchDocument]

    init(skills: [Skill]) throws {
        documentsById = Dictionary(
            uniqueKeysWithValues: skills.map { ($0.id, SearchDocument(skill: $0)) }
        )
    }

    // MARK: - Search

    func search(query: String, in skills: [Skill]) -> [Skill] {
        let tokens = Self.queryTokens(query)
        guard !tokens.isEmpty else {
            return skills
        }

        return skills
            .compactMap { skill -> RankedSkill? in
                guard let document = documentsById[skill.id] else { return nil }
                let rank = Self.rank(document, tokens: tokens)
                guard rank.score > 0 else { return nil }
                return RankedSkill(skill: skill, rank: rank)
            }
            .sorted { lhs, rhs in
                if lhs.rank.matchedAll != rhs.rank.matchedAll {
                    return lhs.rank.matchedAll && !rhs.rank.matchedAll
                }
                if lhs.rank.score != rhs.rank.score {
                    return lhs.rank.score > rhs.rank.score
                }
                if lhs.skill.stars != rhs.skill.stars {
                    return lhs.skill.stars > rhs.skill.stars
                }
                return lhs.skill.name.localizedCompare(rhs.skill.name) == .orderedAscending
            }
            .map(\.skill)
    }

    // MARK: - Ranking

    private struct RankedSkill {
        let skill: Skill
        let rank: Rank
    }

    private struct Rank {
        let score: Double
        let matchedAll: Bool
    }

    private struct SearchDocument {
        let skill: Skill
        let name: SearchField
        let tags: SearchField
        let author: SearchField
        let description: SearchField

        init(skill: Skill) {
            self.skill = skill
            name = SearchField(skill.name)
            tags = SearchField(skill.tags.joined(separator: " "))
            author = SearchField(skill.authorHandle)
            description = SearchField(skill.description)
        }
    }

    private struct SearchField {
        let normalized: String
        let tokens: Set<String>

        init(_ value: String) {
            normalized = normalize(value)
            tokens = Set(normalized.split(separator: " ").map(String.init))
        }
    }

    private static let stopWords = Set(["skill", "skills", "claude", "agent", "agents", "code"])

    private static func queryTokens(_ query: String) -> [String] {
        let rawTokens = tokenize(query)
        let meaningful = rawTokens.filter { !stopWords.contains($0) }
        return meaningful.isEmpty ? rawTokens : meaningful
    }

    private static func rank(_ document: SearchDocument, tokens: [String]) -> Rank {
        var score = 0.0
        var primaryMatched = 0
        var unmatchedTokens: [String] = []

        for token in tokens {
            let primaryScore = [
                fieldScore(token, in: document.name, exact: 100, partial: 75),
                fieldScore(token, in: document.tags, exact: 60, partial: 45),
                fieldScore(token, in: document.author, exact: 30, partial: 20),
                fieldScore(token, in: document.description, exact: 25, partial: 12),
            ].max() ?? 0

            if primaryScore > 0 {
                primaryMatched += 1
                score += Double(primaryScore)
            } else {
                unmatchedTokens.append(token)
            }
        }

        guard primaryMatched > 0 else {
            return Rank(score: 0, matchedAll: false)
        }

        let matchedAll = primaryMatched == tokens.count
        if matchedAll {
            score += 1_000
        } else {
            score -= Double(tokens.count - primaryMatched) * 50
        }

        score += log10(Double(document.skill.stars + 1)) * 20
        if document.skill.stars <= 3 {
            score -= 150
        }
        return Rank(score: score, matchedAll: matchedAll)
    }

    private static func fieldScore(_ token: String, in field: SearchField, exact: Int, partial: Int) -> Int {
        if field.tokens.contains(token) { return exact }
        guard token.count >= 3 else { return 0 }
        if field.normalized.contains(token) { return partial }
        return 0
    }

    private static func tokenize(_ value: String) -> [String] {
        normalize(value)
            .split(separator: " ")
            .map(String.init)
            .filter { !$0.isEmpty }
    }

    private static func normalize(_ value: String) -> String {
        value
            .lowercased()
            .replacingOccurrences(of: #"app[\s-]*store"#, with: "appstore", options: .regularExpression)
            .replacingOccurrences(of: #"[^a-z0-9]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
