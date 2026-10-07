import Darwin
import Foundation
import Testing
@testable import HandoffCore
import HandoffTestSupport

private var fm: FileManager { FileManager() }

private struct TestHome {
    let sandbox: InstallSandbox
    let home: UserInstallHome
    init() throws {
        sandbox = try InstallSandbox.create()
        home = try .simulated(in: sandbox)
    }
    func erase() { try? fm.removeItem(at: sandbox.url) }
    func location(_ agent: InstallAgent = .codex) -> InstallLocation { .user(home, agent) }
    func target(_ agent: InstallAgent = .codex) -> URL { URL(fileURLWithPath: location(agent).destination) }
    func store(_ agent: InstallAgent = .codex) -> SandboxInstaller { SandboxInstaller(location: location(agent)) }
    func mkdir(_ path: String, mode: Int = 0o755) throws -> URL {
        let url = home.url.appendingPathComponent(path)
        try fm.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: mode])
        try fm.setAttributes([.posixPermissions: mode], ofItemAtPath: url.path)
        return url
    }
}

private func apply(_ store: SandboxInstaller, _ version: String) async throws {
    let review = try await store.prepare(InstallFixtures.candidate(version))
    _ = try await store.apply(review.id)
}

private func activeContent(_ target: URL) throws -> URL {
    URL(fileURLWithPath: try fm.destinationOfSymbolicLink(atPath: target.path))
}

struct UserDestinationTests {
    @Test(arguments: InstallAgent.allCases)
    func installNoopUpdateRestoreAndIndependentReadback(_ agent: InstallAgent) async throws {
        let test = try TestHome(); defer { test.erase() }
        for path in ["", "Library", "Library/Application Support", agent.directory] {
            _ = try test.mkdir(path)
        }
        #expect(try UserInstallHome.simulated(in: test.sandbox).storeID == test.home.storeID)
        let parent = try test.mkdir("\(agent.directory)/skills")
        let store = test.store(agent)
        let review = try await store.prepare(InstallFixtures.candidate("A"))
        #expect(review.destination == test.target(agent).path)
        #expect(!fm.fileExists(atPath: test.target(agent).path))
        _ = try await store.apply(review.id)
        let first = try activeContent(test.target(agent))
        #expect(first.path.hasPrefix(test.home.storeURL.path + "/\(agent.rawValue)/versions/"))
        let record = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: first.deletingLastPathComponent().appendingPathComponent("record.json"))) as? [String: Any])
        #expect(record["schema"] as? Int == 2)
        #expect(record["owner"] as? String == "omgskills-standalone-helper")
        #expect(record["storeID"] as? String == test.home.storeID)
        #expect(record["target"] as? String == test.target(agent).path)
        #expect(record["sandboxID"] == nil)
        #expect(try Data(contentsOf: test.target(agent).appendingPathComponent("SKILL.md")) == InstallFixtures.candidate("A").package.entries[0].data)
        #expect(try String(contentsOf: test.target(agent).appendingPathComponent("old.txt"), encoding: .utf8) == "Removed in B.\n")
        let again = try await store.prepare(InstallFixtures.candidate("A"))
        #expect(again.action == .unchanged)
        _ = try await store.apply(again.id)
        #expect(try activeContent(test.target(agent)) == first)
        try await apply(store, "B")
        #expect(try String(contentsOf: test.target(agent).appendingPathComponent("SKILL.md"), encoding: .utf8).contains("Version B"))
        let restore = try await store.prepareRestore()
        #expect(restore.action == .restore)
        _ = try await store.apply(restore.id)
        #expect(try String(contentsOf: test.target(agent).appendingPathComponent("SKILL.md"), encoding: .utf8).contains("Version A"))
        #expect(try fm.attributesOfItem(atPath: parent.path)[.posixPermissions] as? Int == 0o755)
        #expect(try fm.attributesOfItem(atPath: test.home.storeURL.path)[.posixPermissions] as? Int == 0o700)
        #expect(!fm.fileExists(atPath: test.home.url.appendingPathComponent(".codex").path))
    }

    @Test func agentsAreIndependentAndApprovalsCannotCross() async throws {
        let test = try TestHome(); defer { test.erase() }
        let codex = test.store(), claude = test.store(.claude)
        let c = try await codex.prepare(InstallFixtures.candidate("A"))
        let a = try await claude.prepare(InstallFixtures.candidate("B"))
        await #expect(throws: InstallFailure.staleReview) { try await claude.apply(c.id) }
        _ = try await claude.apply(a.id)
        _ = try await codex.apply(c.id)
        #expect(try await codex.installedCommit() == String(repeating: "a", count: 40))
        #expect(try await claude.installedCommit() == String(repeating: "b", count: 40))
        #expect(try activeContent(test.target()) != activeContent(test.target(.claude)))
        let root = try test.home.open(), lock = try root.lock()
        defer { lock.release() }
        await #expect(throws: InstallFailure.busy) { try await claude.prepareRestore() }
    }

    @Test(arguments: ["directory", "foreign-link", "broken-link", "legacy-directory", "legacy-broken-link"])
    func existingInstallIsNeverAdopted(_ kind: String) async throws {
        let test = try TestHome(); defer { test.erase() }
        let root = kind.hasPrefix("legacy") ? ".codex/skills" : ".agents/skills"
        let parent = try test.mkdir(root)
        let target = parent.appendingPathComponent("frontend-design")
        if kind.hasSuffix("directory") {
            try fm.createDirectory(at: target, withIntermediateDirectories: false)
            try Data("keep".utf8).write(to: target.appendingPathComponent("mine"))
        } else {
            try fm.createSymbolicLink(atPath: target.path,
                                      withDestinationPath: kind == "foreign-link" ? test.home.url.path : "/missing-h13-fixture")
        }
        await #expect(throws: InstallFailure.unmanaged) { try await test.store().prepare(InstallFixtures.candidate("A")) }
        if kind.hasSuffix("directory") {
            #expect(try String(contentsOf: target.appendingPathComponent("mine"), encoding: .utf8) == "keep")
        } else { #expect(try !fm.destinationOfSymbolicLink(atPath: target.path).isEmpty) }
    }

    @Test(arguments: [".agents", ".agents/skills", ".codex", ".codex/skills", "Library", "Library/Application Support"])
    func symlinkedParentsRefused(_ path: String) async throws {
        let test = try TestHome(); defer { test.erase() }
        let url = test.home.url.appendingPathComponent(path)
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fm.fileExists(atPath: url.path) {
            try fm.moveItem(at: url, to: test.sandbox.url.appendingPathComponent("moved"))
        }
        let outside = try test.sandbox.open().child("outside", create: true)
        try outside.write("sentinel", data: Data("untouched".utf8))
        try fm.createSymbolicLink(at: url, withDestinationURL: test.sandbox.url.appendingPathComponent("outside"))
        await #expect(throws: (any Error).self) { try await test.store().prepare(InstallFixtures.candidate("A")) }
        #expect(try outside.names() == ["sentinel"])
    }

    @Test(arguments: ["", ".agents", ".agents/skills", ".codex", ".codex/skills", "Library", "Library/Application Support", UserInstallHome.storePath])
    func writableParentsRefusedWithoutChmod(_ path: String) async throws {
        let test = try TestHome(); defer { test.erase() }
        let url = try test.mkdir(path, mode: 0o777)
        await #expect(throws: InstallFailure.unsafeRoot) { try await test.store().prepare(InstallFixtures.candidate("A")) }
        #expect(try fm.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int == 0o777)
    }

    @Test(arguments: InstallAgent.allCases)
    func localEditsBeforeAndAfterReviewBlock(_ agent: InstallAgent) async throws {
        let test = try TestHome(); defer { test.erase() }
        let store = test.store(agent)
        try await apply(store, "A")
        let b = try await store.prepare(InstallFixtures.candidate("B"))
        let skill = test.target(agent).appendingPathComponent("SKILL.md")
        try Data("my change".utf8).write(to: skill)
        await #expect(throws: InstallFailure.changed) { try await store.apply(b.id) }
        await #expect(throws: InstallFailure.changed) { try await store.prepare(InstallFixtures.candidate("B")) }
        #expect(try String(contentsOf: skill, encoding: .utf8) == "my change")
    }

    @Test func parentReplacementAndLateLegacyCollisionInvalidateApproval() async throws {
        for late in [false, true] {
            let test = try TestHome(); defer { test.erase() }
            let target = test.target().deletingLastPathComponent()
            let change: @Sendable () throws -> Void = {
                try fm.moveItem(at: target, to: test.home.url.appendingPathComponent("saved"))
                try fm.createDirectory(at: target, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            }
            let store = SandboxInstaller(location: test.location(), beforeSwitch: { if late { try change() } })
            let a = try await store.prepare(InstallFixtures.candidate("A"))
            if !late { try change() }
            await #expect(throws: InstallFailure.staleReview) { try await store.apply(a.id) }
            #expect(try fm.contentsOfDirectory(atPath: target.path).isEmpty)
            #expect(try fm.contentsOfDirectory(atPath: test.home.url.appendingPathComponent("saved").path).isEmpty)
        }
        let test = try TestHome(); defer { test.erase() }
        let store = SandboxInstaller(location: test.location(), beforeSwitch: {
            _ = try test.mkdir(".codex/skills/frontend-design")
        })
        let a = try await store.prepare(InstallFixtures.candidate("A"))
        await #expect(throws: InstallFailure.unmanaged) { try await store.apply(a.id) }
        #expect(!fm.fileExists(atPath: test.target().path))
    }

    @Test func deletionDoesNotResurrectAndForeignReplacementIsProtected() async throws {
        let test = try TestHome(); defer { test.erase() }
        let store = test.store()
        try await apply(store, "A")
        let b = try await store.prepare(InstallFixtures.candidate("B"))
        try fm.removeItem(at: test.target()) // Remove only this test's activation, not version files.
        await #expect(throws: InstallFailure.staleReview) { try await store.apply(b.id) }
        #expect(try await store.installedCommit() == nil)
        #expect(!fm.fileExists(atPath: test.target().path))
        await #expect(throws: InstallFailure.noBackup) { try await store.prepareRestore() }
        _ = try test.mkdir(".agents/skills/frontend-design")
        await #expect(throws: InstallFailure.unmanaged) { try await store.prepare(InstallFixtures.candidate("B")) }
    }

    @Test func storeMarkerAndRecordCannotBeAdoptedAcrossHomesOrAgents() async throws {
        let test = try TestHome(); defer { test.erase() }
        let store = test.store()
        try await apply(store, "A")
        let content = try activeContent(test.target())
        let recordURL = content.deletingLastPathComponent().appendingPathComponent("record.json")
        var record = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: recordURL)) as? [String: Any])
        record["target"] = test.target(.claude).path
        try JSONSerialization.data(withJSONObject: record).write(to: recordURL)
        await #expect(throws: InstallFailure.invalidRecord) { try await store.prepare(InstallFixtures.candidate("B")) }
        let other = try TestHome(); defer { other.erase() }
        let marker = try Data(contentsOf: test.home.storeURL.appendingPathComponent("store.json"))
        try marker.write(to: other.home.storeURL.appendingPathComponent("store.json"))
        #expect(throws: InstallFailure.invalidRecord) { try UserInstallHome.simulated(in: other.sandbox) }
        try fm.removeItem(at: test.home.storeURL.appendingPathComponent("store.json"))
        #expect(throws: (any Error).self) { try UserInstallHome.simulated(in: test.sandbox) }
    }

    @Test func privateStoreCannotBecomeWorldReadable() async throws {
        let test = try TestHome(); defer { test.erase() }
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: test.home.storeURL.path)
        await #expect(throws: InstallFailure.unsafeRoot) { try await test.store().prepare(InstallFixtures.candidate("A")) }
    }

    @Test func launchModesAreExplicitAndFixturesCannotReachRealHome() throws {
        #expect(try InstallLaunchMode.parse([:]) == .preview)
        #expect(try InstallLaunchMode.parse(["OMGSKILLS_H13_REAL_INSTALLS": "1"]) == .realHome)
        #expect(try InstallLaunchMode.parse(["OMGSKILLS_H13_TEST_HOME_ROOT": "/fixture", "OMGSKILLS_H12_FIXTURES": "1"]) == .simulatedHome("/fixture", fixtures: true))
        for env in [
            ["OMGSKILLS_H13_REAL_INSTALLS": "1", "OMGSKILLS_H12_FIXTURES": "1"],
            ["OMGSKILLS_H13_REAL_INSTALLS": "1", "OMGSKILLS_H1_INSTALL_ROOT": "/fixture"],
            ["OMGSKILLS_H13_TEST_HOME_ROOT": "/fixture", "OMGSKILLS_H1_INSTALL_ROOT": "/other"],
            ["OMGSKILLS_H12_FIXTURES": "1"], ["OMGSKILLS_H13_REAL_INSTALLS": "yes"]
        ] { #expect(throws: InstallFailure.unsafeRoot) { try InstallLaunchMode.parse(env) } }
        // Deliberately do not construct the real-home model in automated tests.
        #expect(throws: InstallFailure.unsafeRoot) { try InstallSandbox(path: NSHomeDirectory()) }
    }
}
