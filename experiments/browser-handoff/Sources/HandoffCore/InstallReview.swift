import Foundation

public struct InstallReview: Identifiable, Equatable, Sendable {
    public enum Action: String, Sendable { case install, update, restore, unchanged }
    public let id: UUID
    public let action: Action
    public let skillID: String
    public let destination: String
    public let fromCommit: String?
    public let toCommit: String
    public let fileCount: Int
    public let canRestore: Bool
    public let changes: [Change]

    public struct Change: Identifiable, Equatable, Sendable {
        public var id: String { path }
        public let path: String
        public let kind: String
        public let oldMode: String?
        public let newMode: String?
        public let diff: String
    }
}

enum PackageReview {
    // Compare file bytes, not Swift's canonically equivalent String values.
    // Newline metadata is rendered separately so real content cannot impersonate it.
    private struct Line: Equatable {
        let bytes: Data
        let endsWithNewline: Bool

        func render(_ prefix: String) -> String {
            prefix + String(decoding: bytes, as: UTF8.self)
                + (endsWithNewline ? "" : "\n\\ No newline at end of file")
        }
    }

    static func changes(from old: SkillPackage?, to new: SkillPackage) throws -> [InstallReview.Change] {
        let before = Dictionary(uniqueKeysWithValues: (old?.entries ?? []).map { ($0.path, $0) })
        let after = Dictionary(uniqueKeysWithValues: new.entries.map { ($0.path, $0) })
        var changes: [InstallReview.Change] = []
        var total = 0
        for path in Set(before.keys).union(after.keys).sorted() {
            let a = before[path], b = after[path]
            if a?.data == b?.data, a?.mode == b?.mode { continue }
            let left = try lines(a?.data ?? Data()), right = try lines(b?.data ?? Data())
            total += (a?.data.count ?? 0) + (b?.data.count ?? 0)
            guard total <= 128 * 1024 else { throw InstallFailure.unreviewable }
            let difference = right.difference(from: left)
            var removed = Set<Int>(), inserted = Set<Int>()
            for change in difference {
                switch change {
                case .remove(let offset, _, _): removed.insert(offset)
                case .insert(let offset, _, _): inserted.insert(offset)
                }
            }
            var output: [String] = [], i = 0, j = 0
            while i < left.count || j < right.count {
                if i < left.count, removed.contains(i) { output.append(left[i].render("-")); i += 1 }
                else if j < right.count, inserted.contains(j) { output.append(right[j].render("+")); j += 1 }
                else {
                    guard i < left.count, j < right.count, left[i] == right[j] else { throw InstallFailure.unreviewable }
                    output.append(left[i].render(" ")); i += 1; j += 1
                }
            }
            let diff = output.joined(separator: "\n")
            guard diff.utf8.count <= 256 * 1024 else { throw InstallFailure.unreviewable }
            changes.append(.init(path: path, kind: a == nil ? "Added" : b == nil ? "Removed" : "Changed",
                                 oldMode: a?.mode, newMode: b?.mode, diff: diff))
        }
        return changes
    }

    private static func lines(_ data: Data) throws -> [Line] {
        guard data.count <= 64 * 1024, let text = String(data: data, encoding: .utf8),
              text.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) || $0 == "\n" || $0 == "\t" }) else {
            throw InstallFailure.unreviewable
        }
        if data.isEmpty { return [] }
        let finalNewline = data.last == 0x0a
        var parts = data.split(separator: 0x0a, omittingEmptySubsequences: false)
        if finalNewline { parts.removeLast() }
        guard parts.count <= 2000 else { throw InstallFailure.unreviewable }
        return parts.enumerated().map { index, bytes in
            Line(bytes: Data(bytes), endsWithNewline: index < parts.count - 1 || finalNewline)
        }
    }
}
