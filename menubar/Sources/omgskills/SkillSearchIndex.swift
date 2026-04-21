import Foundation
import GRDB

final class SkillSearchIndex: @unchecked Sendable {

    private let db: DatabaseQueue

    init(skills: [Skill]) throws {
        db = try DatabaseQueue()
        try db.write { conn in
            try Self.buildSchema(conn)
            try Self.populate(conn, skills: skills)
        }
    }

    // MARK: - Search

    func search(query: String, in skills: [Skill]) -> [Skill] {
        guard query.count >= 2,
              let pattern = FTS5Pattern(matchingAllPrefixesIn: query) else {
            return skills
        }

        let ids: [String]
        do {
            ids = try db.read { conn in
                // bm25 weights: name=10, tags=3, author=2, description=1
                // bm25 returns negative values — no DESC needed
                try String.fetchAll(conn, sql: """
                    SELECT skill_id
                    FROM skill_fts
                    WHERE skill_fts MATCH ?
                    ORDER BY bm25(skill_fts, 10.0, 3.0, 2.0, 1.0)
                    """, arguments: [pattern])
            }
        } catch {
            let terms = query.lowercased().split(separator: " ").map(String.init)
            return skills.filter { s in
                let blob = "\(s.name) \(s.description) \(s.authorHandle) \(s.tags.joined(separator: " "))".lowercased()
                return terms.allSatisfy { blob.contains($0) }
            }
        }

        let lookup = Dictionary(uniqueKeysWithValues: skills.map { ($0.id, $0) })
        return ids.compactMap { lookup[$0] }
    }

    // MARK: - Schema

    private static func buildSchema(_ db: Database) throws {
        try db.execute(sql: """
            CREATE TABLE skills (
                row_id    INTEGER PRIMARY KEY,
                skill_id  TEXT NOT NULL,
                name      TEXT NOT NULL,
                tags      TEXT NOT NULL,
                author    TEXT NOT NULL,
                description TEXT NOT NULL
            )
        """)

        try db.create(virtualTable: "skill_fts", using: FTS5()) { t in
            t.tokenizer = .unicode61()
            t.column("name")
            t.column("tags")
            t.column("author")
            t.column("description")
            t.column("skill_id").notIndexed()
            t.content = "skills"
            t.contentRowID = "row_id"
        }
    }

    private static func populate(_ db: Database, skills: [Skill]) throws {
        for (idx, skill) in skills.enumerated() {
            try db.execute(sql: """
                INSERT INTO skills (row_id, skill_id, name, tags, author, description)
                VALUES (?, ?, ?, ?, ?, ?)
                """, arguments: [
                    idx + 1,
                    skill.id,
                    skill.name,
                    skill.tags.joined(separator: " "),
                    skill.authorHandle,
                    skill.description
                ])
        }
        // Sync content= FTS index from the companion table
        try db.execute(sql: "INSERT INTO skill_fts(skill_fts) VALUES ('rebuild')")
    }
}
