import Foundation
import Testing
@testable import omgskills

@MainActor
@Suite(.serialized)
struct InventoryFolderWatcherTests {
    @Test func watchesNestedChangesAndStopsDelivering() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let skills = root.appendingPathComponent(".codex/skills")
        let nested = skills.appendingPathComponent("fixture/references")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        var changes = 0
        let watcher = InventoryFolderWatcher(roots: [skills], anchor: root) { changes += 1 }
        try watcher.start()
        defer { watcher.stop() }
        try Data("first".utf8).write(to: nested.appendingPathComponent("example.txt"))
        try await waitUntil("nested file edit") { changes > 0 }
        watcher.stop()
        let count = changes
        try Data("second".utf8).write(to: nested.appendingPathComponent("example.txt"))
        try await Task.sleep(for: .milliseconds(300))
        #expect(changes == count)
        #expect(!watcher.isWatching)
    }

    @Test func missingRootAndParentCanBeCreatedDeletedAndRecreated() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let skills = root.appendingPathComponent(".codex/skills")
        var changes = 0
        let watcher = InventoryFolderWatcher(roots: [skills], anchor: root) { changes += 1 }
        #expect(try watcher.observationPaths() == [root.path])
        try watcher.start()
        defer { watcher.stop() }
        #expect(!FileManager.default.fileExists(atPath: skills.path))
        try FileManager.default.createDirectory(at: skills, withIntermediateDirectories: true)
        try await waitUntil("missing root created") { changes > 0 }
        var count = changes
        try FileManager.default.removeItem(at: skills)
        try await waitUntil("root removed") { changes > count }
        count = changes
        try FileManager.default.createDirectory(at: skills, withIntermediateDirectories: true)
        try Data("restored".utf8).write(to: skills.appendingPathComponent("SKILL.md"))
        try await waitUntil("root recreated") { changes > count }
    }

    @Test func symlinkEntryNotifiesWithoutWatchingExternalTargetOrScanningIt() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let skills = root.appendingPathComponent(".codex/skills")
        let external = root.appendingPathComponent("external")
        try FileManager.default.createDirectory(at: skills, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: external, withIntermediateDirectories: true)
        let file = external.appendingPathComponent("SKILL.md")
        try Data("untouched".utf8).write(to: file)
        var changes = 0
        let watcher = InventoryFolderWatcher(roots: [skills], anchor: root) { changes += 1 }
        try watcher.start()
        defer { watcher.stop() }
        try FileManager.default.createSymbolicLink(at: skills.appendingPathComponent("fixture"), withDestinationURL: external)
        try await waitUntil("symlink added") { changes > 0 }
        #expect(try Data(contentsOf: file) == Data("untouched".utf8))
        #expect(try watcher.observationPaths() == [root.path])
    }

    @Test func existingAgentParentCanBeReplacedAndUnrelatedChangesAreFiltered() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let parent = root.appendingPathComponent(".codex")
        let skills = parent.appendingPathComponent("skills")
        try FileManager.default.createDirectory(at: skills, withIntermediateDirectories: true)
        var changes = 0
        let watcher = InventoryFolderWatcher(roots: [skills], anchor: root) { changes += 1 }
        try watcher.start()
        defer { watcher.stop() }
        try Data("initial".utf8).write(to: skills.appendingPathComponent("SKILL.md"))
        try await waitUntil("initial file event") { changes > 0 }
        var count = changes
        try FileManager.default.removeItem(at: parent)
        try await waitUntil("agent parent removed") { changes > count }
        count = changes
        try FileManager.default.createDirectory(at: skills, withIntermediateDirectories: true)
        try Data("recreated".utf8).write(to: skills.appendingPathComponent("SKILL.md"))
        try await waitUntil("agent parent recreated") { changes > count }
        // Drain the native batch before checking a sibling outside the supported root.
        try await Task.sleep(for: .milliseconds(300))
        count = changes
        try Data("unrelated".utf8).write(to: root.appendingPathComponent("unrelated.txt"))
        try await Task.sleep(for: .milliseconds(300))
        #expect(changes == count)
    }

    @Test func refusesOutOfScopeAndRedirectedAncestors() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let outside = InventoryFolderWatcher(roots: [root.deletingLastPathComponent()], anchor: root) {}
        #expect(throws: InventoryFolderWatcher.Failure.invalidRoots) { try outside.start() }
        let missing = InventoryFolderWatcher(roots: [root.appendingPathComponent("skills")], anchor: root.appendingPathComponent("missing")) {}
        #expect(throws: InventoryFolderWatcher.Failure.invalidRoots) { try missing.start() }
        let target = root.appendingPathComponent("target")
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent(".codex"), withDestinationURL: target)
        let redirected = InventoryFolderWatcher(roots: [root.appendingPathComponent(".codex/skills")], anchor: root) {}
        #expect(throws: InventoryFolderWatcher.Failure.unavailableAncestor) { try redirected.start() }
    }

    private func temporaryRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("omgskills-watcher-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        return root
    }

    private func waitUntil(_ action: String, _ condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while !condition(), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        try #require(condition(), "Expected a native event: \(action)")
    }
}
