import Foundation
import Testing
@testable import HandoffCore

struct PackageReviewTests {
    private func package(_ text: String, mode: String = "100644") -> SkillPackage {
        let data = Data(text.utf8)
        return SkillPackage(
            coordinates: .init(commitSha: String(repeating: "a", count: 40),
                               treeSha: String(repeating: "b", count: 40),
                               skillMdSha: SkillIdentityResolver.gitBlobSHA(for: data)),
            entries: [.init(path: "SKILL.md", mode: mode, data: data,
                            blobSha: SkillIdentityResolver.gitBlobSHA(for: data))]
        )
    }

    @Test(arguments: [false, true])
    func newlineAnnotationCannotHideLiteralFileContent(_ reverse: Bool) throws {
        let short = "safe", withMarker = "safe\n\\ No newline at end of file\n"
        let changes = try PackageReview.changes(from: package(reverse ? withMarker : short),
                                                to: package(reverse ? short : withMarker))
        let change = try #require(changes.first)
        #expect(changes.count == 1 && change.kind == "Changed")
        let expected = reverse
            ? "-safe\n-\\ No newline at end of file\n+safe\n\\ No newline at end of file"
            : "-safe\n\\ No newline at end of file\n+safe\n+\\ No newline at end of file"
        #expect(Data(change.diff.utf8) == Data(expected.utf8))
    }

    @Test(arguments: [false, true])
    func canonicallyEquivalentUnicodeStillShowsByteChanges(_ reverse: Bool) throws {
        let composed = "caf\u{00e9}", decomposed = "cafe\u{0301}"
        let before = reverse ? decomposed : composed, after = reverse ? composed : decomposed
        #expect(before == after)
        #expect(Data(before.utf8) != Data(after.utf8))
        let changes = try PackageReview.changes(from: package(before + "\n"), to: package(after + "\n"))
        let change = try #require(changes.first)
        #expect(Data(change.diff.utf8) == Data("-\(before)\n+\(after)".utf8))
    }

    @Test(arguments: [
        ("last", "last\n", "-last\n\\ No newline at end of file\n+last"),
        ("last\n", "last", "-last\n+last\n\\ No newline at end of file"),
        ("", "\n", "+"),
        ("\n", "", "-"),
        ("", "last", "+last\n\\ No newline at end of file"),
        ("last", "", "-last\n\\ No newline at end of file"),
        ("same\nold\nend", "same\nnew\nend", " same\n-old\n+new\n end\n\\ No newline at end of file"),
        ("same\n\n", "same\n", " same\n-"),
    ])
    func preservesNewlinesAndContext(_ before: String, _ after: String, _ expected: String) throws {
        let changes = try PackageReview.changes(from: package(before), to: package(after))
        let change = try #require(changes.first)
        #expect(Data(change.diff.utf8) == Data(expected.utf8))
    }

    @Test func unchangedContentAndModeOnlyChangesRemainDistinct() throws {
        let original = package("same")
        #expect(try PackageReview.changes(from: original, to: original).isEmpty)
        let changes = try PackageReview.changes(from: original, to: package("same", mode: "100755"))
        let change = try #require(changes.first)
        #expect(change.oldMode == "100644" && change.newMode == "100755")
        #expect(change.diff == " same\n\\ No newline at end of file")
    }
}
