import Foundation
import Testing
@testable import omgskills

struct PublicSkillInstallRequestTests {
    private static let url = "omgskills-f1://review?v=1&id=Owner%2FRepo%3Aexample&repo=Owner%2FRepo&path=skills%2Fexample%2FSKILL.md&agent=codex"

    @Test func parsesBoundedRequestAndDerivesIdentityAndDestination() throws {
        let request = try PublicSkillInstallRequest(url: Self.url)
        #expect(request.repositorySlug == "owner/repo")
        #expect(request.packageRoot == "skills/example")
        #expect(request.sourceID == "github:owner/repo:skills/example")
        #expect(request.targetName == "example")
        #expect(request.commitSha == nil)
        let pinned = try PublicSkillInstallRequest(url: Self.url + "&commit=" + String(repeating: "A", count: 40))
        #expect(pinned.commitSha == String(repeating: "a", count: 40))
        let root = try PublicSkillInstallRequest(catalogID: "owner/repo", repositorySlug: "owner/repo", skillMDPath: "SKILL.md")
        #expect(root.packageRoot == ".")
        #expect(root.targetName == "repo")
    }

    @Test(arguments: [
        "&v=1", "&agent=claude", "&root=/tmp/test", "&commit=main", "&commit=", "&id=x",
        "#fragment", "&token=secret", "&unexpected=%zz", "&repo=other/repo"
    ]) func refusesAmbiguousOrUnsupportedFields(suffix: String) {
        #expect(throws: PublicSkillInstallRequest.RequestError.self) {
            try PublicSkillInstallRequest(url: Self.url + suffix)
        }
    }

    @Test(arguments: ["../SKILL.md", "/SKILL.md", "skills//SKILL.md", "skills/.git/SKILL.md", "skills/../x/SKILL.md", "skills\\x/SKILL.md", "skills/x/README.md", "skills/x\n/SKILL.md"])
    func refusesUnsafePaths(path: String) {
        #expect(throws: PublicSkillInstallRequest.RequestError.self) {
            try PublicSkillInstallRequest(catalogID: "id", repositorySlug: "owner/repo", skillMDPath: path)
        }
    }

    @Test func refusesWrongAuthoritySchemeAgentAndOversize() {
        for url in [
            Self.url.replacingOccurrences(of: "omgskills-f1:", with: "omgskills:"),
            Self.url.replacingOccurrences(of: "//review?", with: "//user@review?"),
            Self.url.replacingOccurrences(of: "//review?", with: "//review:123?"),
            Self.url.replacingOccurrences(of: "agent=codex", with: "agent=claude"),
            Self.url.replacingOccurrences(of: "v=1", with: "v=2"),
            Self.url + String(repeating: "x", count: 4096)
        ] {
            #expect(throws: PublicSkillInstallRequest.RequestError.self) {
                try PublicSkillInstallRequest(url: url)
            }
        }
    }
}

struct PublicSkillPackageReviewTests {
    @Test func reportsByteChangesModesAdditionsAndRemovals() throws {
        let old = package([
            entry("SKILL.md", "cafe\u{301}\nlast"), entry("removed.txt", "old\n"),
            entry("script.sh", "echo ok\n")
        ])
        let new = package([
            entry("SKILL.md", "caf\u{e9}\nlast\n"), entry("added.txt", "new\n"),
            entry("script.sh", "echo ok\n", mode: "100755")
        ])
        let changes = try PublicSkillPackageReview.changes(from: old, to: new)
        #expect(changes.map(\.path) == ["SKILL.md", "added.txt", "removed.txt", "script.sh"])
        #expect(changes.map(\.kind) == [.changed, .added, .removed, .changed])
        #expect(changes[0].diff.contains("\\ No newline at end of file"))
        #expect(changes[0].diff.contains("-cafe\u{301}"))
        #expect(changes[0].diff.contains("+caf\u{e9}"))
        #expect(changes[3].oldMode == "100644")
        #expect(changes[3].newMode == "100755")
    }

    @Test func refusesUnreviewableBytesAndSizeInsteadOfHidingChanges() {
        for data in [Data([0xff]), Data([0]), Data(repeating: 65, count: 65 * 1024)] {
            let value = package([GroupSkillPackageTestSupport.entry(path: "SKILL.md", data: data)])
            #expect(throws: PublicSkillReviewError.unreviewable) {
                try PublicSkillPackageReview.changes(from: nil, to: value)
            }
        }
    }

    private func package(_ entries: [SkillPackageEntry]) -> SkillPackage {
        SkillPackage(coordinates: GroupSkillPackageTestSupport.coordinates, entries: entries)
    }

    private func entry(_ path: String, _ content: String, mode: String = "100644") -> SkillPackageEntry {
        GroupSkillPackageTestSupport.entry(path: path, mode: mode, data: Data(content.utf8))
    }
}
