import Foundation

struct PublicSkillInstallReview: Identifiable, Equatable, Sendable {
    enum Action: String, Sendable { case install, update, unchanged }
    struct Change: Identifiable, Equatable, Sendable {
        enum Kind: String, Sendable { case added, removed, changed }
        var id: String { path }
        let path: String
        let kind: Kind
        let oldMode: String?
        let newMode: String?
        let diff: String
    }

    let id: UUID
    let action: Action
    let source: PublicSkillInstallRequest
    let destination: URL
    let fromCoordinates: SkillPackageCoordinates?
    let toCoordinates: SkillPackageCoordinates
    let changes: [Change]
}

enum PublicSkillReviewError: LocalizedError, Equatable {
    case unreviewable
    case staleReview
    case ownershipConflict
    case localChanges
    case destinationConflict

    var errorDescription: String? {
        switch self {
        case .unreviewable: "This package is too large or contains content this review cannot display."
        case .staleReview: "The installation changed. Open a new review before applying."
        case .ownershipConflict: "This skill is managed by a different source or install flow."
        case .localChanges: "The installed files have changed. Your files were left untouched."
        case .destinationConflict: "Another skill or redirected folder already uses this destination."
        }
    }
}

// Adapted from HandoffCore's bounded byte-based diff; no helper writer or store dependency.
enum PublicSkillPackageReview {
    private struct Line: Equatable {
        let bytes: Data
        let endsWithNewline: Bool

        func render(_ prefix: String) -> String {
            prefix + String(decoding: bytes, as: UTF8.self)
                + (endsWithNewline ? "" : "\n\\ No newline at end of file")
        }
    }

    static func changes(from old: SkillPackage?, to new: SkillPackage) throws -> [PublicSkillInstallReview.Change] {
        let before = Dictionary(uniqueKeysWithValues: (old?.entries ?? []).map { ($0.path, $0) })
        let after = Dictionary(uniqueKeysWithValues: new.entries.map { ($0.path, $0) })
        var changes: [PublicSkillInstallReview.Change] = []
        var total = 0
        for path in Set(before.keys).union(after.keys).sorted() {
            try Task.checkCancellation()
            let a = before[path], b = after[path]
            if a?.data == b?.data, a?.mode == b?.mode { continue }
            total += (a?.data.count ?? 0) + (b?.data.count ?? 0)
            guard total <= 128 * 1024 else { throw PublicSkillReviewError.unreviewable }
            let left = try lines(a?.data ?? Data()), right = try lines(b?.data ?? Data())
            var removed = Set<Int>(), inserted = Set<Int>()
            for change in right.difference(from: left) {
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
                    guard i < left.count, j < right.count, left[i] == right[j] else {
                        throw PublicSkillReviewError.unreviewable
                    }
                    output.append(left[i].render(" ")); i += 1; j += 1
                }
            }
            let diff = output.joined(separator: "\n")
            guard diff.utf8.count <= 256 * 1024 else { throw PublicSkillReviewError.unreviewable }
            changes.append(.init(
                path: path, kind: a == nil ? .added : b == nil ? .removed : .changed,
                oldMode: a?.mode, newMode: b?.mode, diff: diff
            ))
        }
        return changes
    }

    private static func lines(_ data: Data) throws -> [Line] {
        guard data.count <= 64 * 1024, let text = String(data: data, encoding: .utf8),
              text.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) || $0 == "\n" || $0 == "\t" }) else {
            throw PublicSkillReviewError.unreviewable
        }
        if data.isEmpty { return [] }
        let finalNewline = data.last == 0x0a
        var parts = data.split(separator: 0x0a, omittingEmptySubsequences: false)
        if finalNewline { parts.removeLast() }
        guard parts.count <= 2000 else { throw PublicSkillReviewError.unreviewable }
        return parts.enumerated().map { index, bytes in
            Line(bytes: Data(bytes), endsWithNewline: index < parts.count - 1 || finalNewline)
        }
    }
}
