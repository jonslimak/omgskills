import Foundation
import Testing
@testable import omgskills

struct SkillPackageValidatorTests {
    private struct SharedFixture: Decodable {
        struct Entry: Decodable {
            let path: String
            let mode: String
            let blobSha: String
            let dataBase64: String
        }

        let version: Int
        let coordinates: SkillPackageCoordinatesFixture
        let entries: [Entry]
    }

    private struct SkillPackageCoordinatesFixture: Decodable {
        let commitSha: String
        let treeSha: String
        let skillMdSha: String
    }

    private let commitSha = String(repeating: "1", count: 40)
    private let treeSha = "315d6f38e5d0c3ab41809ba1c188e25eab45b5a1"
    private let skillMdSha = "6d2190081ae23aae9b09e89d10a3e1f57c3bb398"

    @Test func validatesCompletePackageAgainstGitTreeFixture() throws {
        let package = validPackage()

        let result = try SkillPackageValidator.validate(package, expected: package.coordinates)

        #expect(result.coordinates == package.coordinates)
        #expect(result.fileCount == 3)
        #expect(result.totalBytes == package.entries.reduce(0) { $0 + $1.data.count })
    }

    @Test func validatesSharedServerClientPackageFixture() throws {
        let fixtureURL = try #require(
            Bundle.module.url(
                forResource: "skill-package-validation-v1",
                withExtension: "json",
                subdirectory: "Fixtures"
            )
        )
        let fixture = try JSONDecoder().decode(
            SharedFixture.self,
            from: Data(contentsOf: fixtureURL)
        )
        let coordinates = SkillPackageCoordinates(
            commitSha: fixture.coordinates.commitSha,
            treeSha: fixture.coordinates.treeSha,
            skillMdSha: fixture.coordinates.skillMdSha
        )
        let package = SkillPackage(
            coordinates: coordinates,
            entries: try fixture.entries.map { entry in
                SkillPackageEntry(
                    path: entry.path,
                    mode: entry.mode,
                    data: try #require(Data(base64Encoded: entry.dataBase64)),
                    blobSha: entry.blobSha
                )
            }
        )

        #expect(fixture.version == 1)
        #expect(try SkillPackageValidator.validate(package, expected: coordinates).fileCount == 1)
    }

    @Test func rejectsUnsafeAndReservedPaths() {
        for path in ["", "/SKILL.md", "../SKILL.md", "docs/../SKILL.md", "docs//file.md", "docs\\file.md", ".git/config", "docs/.GIT/config", "line\nfeed.md"] {
            expectFailure(.invalidPath) {
                try validateReplacingEntries([entry(path: path, contents: "unsafe")])
            }
        }
    }

    @Test func rejectsDuplicateAndFileDirectoryConflicts() {
        let duplicate = entry(path: "SKILL.md", contents: skillMdContents)
        expectFailure(.duplicatePath) {
            try validateReplacingEntries([duplicate, duplicate])
        }
        expectFailure(.pathConflict) {
            try validateReplacingEntries([
                entry(path: "SKILL.md", contents: skillMdContents),
                entry(path: "docs", contents: "file"),
                entry(path: "docs/readme.md", contents: "nested")
            ])
        }
    }

    @Test func rejectsCaseAndUnicodeCollisions() {
        expectFailure(.caseCollision) {
            try validateReplacingEntries([
                entry(path: "SKILL.md", contents: skillMdContents),
                entry(path: "Docs/one.md", contents: "one"),
                entry(path: "docs/two.md", contents: "two")
            ])
        }

        let composed = "caf\u{00E9}.md"
        let decomposed = "cafe\u{0301}.md"
        expectFailure(.caseCollision) {
            try validateReplacingEntries([
                entry(path: "SKILL.md", contents: skillMdContents),
                entry(path: composed, contents: "one"),
                entry(path: decomposed, contents: "two")
            ])
        }
    }

    @Test func rejectsSymbolicLinksSubmodulesAndUnknownModes() {
        for (mode, code) in [
            ("120000", SkillPackageValidationFailureCode.symbolicLink),
            ("160000", .submodule),
            ("040000", .unsupportedEntryType)
        ] {
            expectFailure(code) {
                try validateReplacingEntries([
                    entry(path: "SKILL.md", contents: skillMdContents),
                    entry(path: "unsafe", mode: mode, contents: "value")
                ])
            }
        }
    }

    @Test func enforcesFileCountAndByteLimits() {
        let package = validPackage()

        expectFailure(.tooManyFiles) {
            _ = try SkillPackageValidator.validate(
                package,
                expected: package.coordinates,
                limits: limits(maximumFileCount: 2)
            )
        }
        expectFailure(.fileTooLarge) {
            _ = try SkillPackageValidator.validate(
                package,
                expected: package.coordinates,
                limits: limits(maximumFileBytes: 10)
            )
        }
        expectFailure(.skillMdTooLarge) {
            _ = try SkillPackageValidator.validate(
                package,
                expected: package.coordinates,
                limits: limits(maximumSkillMdBytes: 10)
            )
        }
        expectFailure(.packageTooLarge) {
            _ = try SkillPackageValidator.validate(
                package,
                expected: package.coordinates,
                limits: limits(maximumTotalBytes: package.entries.reduce(0) { $0 + $1.data.count } - 1)
            )
        }
    }

    @Test func rejectsInvalidAndMismatchedCoordinates() {
        let package = validPackage()

        expectFailure(.invalidSha) {
            _ = try SkillPackageValidator.validate(
                package,
                expected: coordinates(commitSha: "not-a-sha")
            )
        }
        expectFailure(.commitShaMismatch) {
            _ = try SkillPackageValidator.validate(
                package,
                expected: coordinates(commitSha: String(repeating: "2", count: 40))
            )
        }
        expectFailure(.treeShaMismatch) {
            _ = try SkillPackageValidator.validate(
                package,
                expected: coordinates(treeSha: String(repeating: "2", count: 40))
            )
        }
        expectFailure(.skillMdShaMismatch) {
            _ = try SkillPackageValidator.validate(
                package,
                expected: coordinates(skillMdSha: String(repeating: "2", count: 40))
            )
        }
    }

    @Test func rejectsBlobSkillAndTreeHashMismatches() {
        let package = validPackage()
        var entries = package.entries
        let script = entries[1]
        entries[1] = SkillPackageEntry(
            path: script.path,
            mode: script.mode,
            data: Data("changed".utf8),
            blobSha: script.blobSha
        )
        expectFailure(.blobShaMismatch) {
            _ = try SkillPackageValidator.validate(
                SkillPackage(coordinates: package.coordinates, entries: entries),
                expected: package.coordinates
            )
        }

        let changedSkill = entry(path: "SKILL.md", contents: "changed")
        let changedSkillPackage = packageWithEntries(
            [changedSkill] + package.entries.dropFirst(),
            skillMdSha: changedSkill.blobSha
        )
        expectFailure(.skillMdShaMismatch) {
            _ = try SkillPackageValidator.validate(changedSkillPackage, expected: package.coordinates)
        }

        let regularScript = entry(path: "scripts/run.sh", contents: scriptContents)
        let changedTreePackage = packageWithEntries(
            [package.entries[0], regularScript, package.entries[2]],
            treeSha: package.coordinates.treeSha
        )
        expectFailure(.treeShaMismatch) {
            _ = try SkillPackageValidator.validate(changedTreePackage, expected: package.coordinates)
        }
    }

    @Test func requiresOneRootSkillMd() {
        expectFailure(.missingSkillMd) {
            try validateReplacingEntries([
                entry(path: "nested/SKILL.md", contents: skillMdContents)
            ])
        }
    }

    @Test func validationFailureDoesNotChangeActiveInstallation() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let activeSkill = root.appendingPathComponent("active/SKILL.md")
        try FileManager.default.createDirectory(
            at: activeSkill.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let original = Data("active installation".utf8)
        try original.write(to: activeSkill)

        expectFailure(.invalidPath) {
            try validateReplacingEntries([entry(path: "../SKILL.md", contents: "unsafe")])
        }

        #expect(try Data(contentsOf: activeSkill) == original)
    }

    private var skillMdContents: String {
        """
        ---
        name: example
        description: Example package.
        ---

        """
    }

    private var scriptContents: String {
        "#!/bin/sh\necho hello\n"
    }

    private func validPackage() -> SkillPackage {
        SkillPackage(
            coordinates: coordinates(),
            entries: [
                entry(path: "SKILL.md", contents: skillMdContents),
                entry(path: "scripts/run.sh", mode: "100755", contents: scriptContents),
                entry(path: "references/info.txt", contents: "reference\n")
            ]
        )
    }

    private func packageWithEntries<S: Sequence>(
        _ entries: S,
        treeSha: String? = nil,
        skillMdSha: String? = nil
    ) -> SkillPackage where S.Element == SkillPackageEntry {
        SkillPackage(
            coordinates: coordinates(
                treeSha: treeSha ?? self.treeSha,
                skillMdSha: skillMdSha ?? self.skillMdSha
            ),
            entries: Array(entries)
        )
    }

    private func validateReplacingEntries(_ entries: [SkillPackageEntry]) throws {
        let package = packageWithEntries(entries)
        _ = try SkillPackageValidator.validate(package, expected: package.coordinates)
    }

    private func coordinates(
        commitSha: String? = nil,
        treeSha: String? = nil,
        skillMdSha: String? = nil
    ) -> SkillPackageCoordinates {
        SkillPackageCoordinates(
            commitSha: commitSha ?? self.commitSha,
            treeSha: treeSha ?? self.treeSha,
            skillMdSha: skillMdSha ?? self.skillMdSha
        )
    }

    private func entry(
        path: String,
        mode: String = "100644",
        contents: String
    ) -> SkillPackageEntry {
        let data = Data(contents.utf8)
        return SkillPackageEntry(
            path: path,
            mode: mode,
            data: data,
            blobSha: SkillIdentityResolver.gitBlobSHA(for: data)
        )
    }

    private func limits(
        maximumFileCount: Int = 512,
        maximumTotalBytes: Int = 50 * 1024 * 1024,
        maximumFileBytes: Int = 10 * 1024 * 1024,
        maximumSkillMdBytes: Int = 2 * 1024 * 1024
    ) -> SkillPackageValidationLimits {
        SkillPackageValidationLimits(
            maximumFileCount: maximumFileCount,
            maximumTotalBytes: maximumTotalBytes,
            maximumFileBytes: maximumFileBytes,
            maximumSkillMdBytes: maximumSkillMdBytes
        )
    }

    private func expectFailure(
        _ code: SkillPackageValidationFailureCode,
        _ operation: () throws -> Void
    ) {
        #expect {
            try operation()
        } throws: { error in
            (error as? SkillPackageValidationError)?.code == code
        }
    }
}
