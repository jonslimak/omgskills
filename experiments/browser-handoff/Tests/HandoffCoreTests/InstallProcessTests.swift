import Foundation
import Testing
@testable import HandoffCore

private final class InstallTestBundle {}

private func harnessExecutable() throws -> URL {
    // SwiftPM can launch via Xcode's xctest host; argv[0] is not our build directory.
    var directory = Bundle(for: InstallTestBundle.self).bundleURL
    for _ in 0..<7 {
        let candidate = directory.appendingPathComponent("HandoffInstallHarness")
        if FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate }
        directory.deleteLastPathComponent()
    }
    throw InstallFailure.io
}

private func runHarness(_ arguments: [String]) throws -> (Int32, Process.TerminationReason, String) {
    let process = Process(), output = Pipe()
    process.executableURL = try harnessExecutable()
    process.arguments = arguments
    process.standardOutput = output
    process.standardError = output
    try process.run()
    let bytes = try output.fileHandleForReading.readToEnd() ?? Data()
    process.waitUntilExit()
    return (process.terminationStatus, process.terminationReason, String(decoding: bytes, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
}

struct InstallProcessTests {
    @Test(arguments: ["home-kill-before", "home-kill-after"], InstallAgent.allCases)
    func persistentHomeProcessTerminationAndRecovery(_ phase: String, _ agent: InstallAgent) throws {
        let sandbox = try InstallSandbox.create()
        defer { try? FileManager.default.removeItem(at: sandbox.url) }
        #expect(try runHarness(["select", sandbox.url.path, "A"]).0 == 0)
        #expect(try runHarness(["home-apply", sandbox.url.path, agent.rawValue]).0 == 0)
        #expect(try runHarness(["select", sandbox.url.path, "B"]).0 == 0)
        let killed = try runHarness([phase, sandbox.url.path, agent.rawValue])
        #expect(killed.0 == 9 && killed.1 == .uncaughtSignal)
        let expected = phase == "home-kill-before" ? "a" : "b"
        #expect(try runHarness(["home-inspect", sandbox.url.path, agent.rawValue]).2 == String(repeating: expected, count: 40))
        #expect(try runHarness(["home-apply", sandbox.url.path, agent.rawValue]).0 == 0)
        #expect(try runHarness(["home-inspect", sandbox.url.path, agent.rawValue]).2 == String(repeating: "b", count: 40))
        #expect(try runHarness(["home-restore", sandbox.url.path, agent.rawValue]).0 == 0)
        #expect(try runHarness(["home-inspect", sandbox.url.path, agent.rawValue]).2 == String(repeating: "a", count: 40))
        let skill = sandbox.url.appendingPathComponent("home/\(agent.directory)/skills/frontend-design/SKILL.md")
        #expect(try String(contentsOf: skill, encoding: .utf8).contains("Version A"))
    }

    @Test func persistentHomeLockExcludesAnotherProcess() throws {
        let sandbox = try InstallSandbox.create()
        defer { try? FileManager.default.removeItem(at: sandbox.url) }
        let home = try UserInstallHome.simulated(in: sandbox)
        _ = try runHarness(["select", sandbox.url.path, "A"])
        let root = try home.open(), lock = try root.lock()
        defer { lock.release() }
        #expect(try runHarness(["home-apply", sandbox.url.path, "codex"]).0 != 0)
        #expect(try runHarness(["home-apply", sandbox.url.path, "claude"]).0 != 0)
        #expect(!FileManager.default.fileExists(atPath: home.url.appendingPathComponent(".agents").path))
    }

    @Test(arguments: ["kill-before", "kill-after"])
    func realProcessTerminationLeavesCompleteVersionAndRetryWorks(_ phase: String) async throws {
        let sandbox = try InstallSandbox.create()
        defer { try? FileManager.default.removeItem(at: sandbox.url) }
        #expect(try runHarness(["select", sandbox.url.path, "A"]).0 == 0)
        #expect(try runHarness(["apply", sandbox.url.path]).0 == 0)
        #expect(try runHarness(["select", sandbox.url.path, "B"]).0 == 0)
        let killed = try runHarness([phase, sandbox.url.path])
        #expect(killed.0 == 9)
        #expect(killed.1 == .uncaughtSignal)
        let expected = phase == "kill-before" ? "a" : "b"
        let inspected = try runHarness(["inspect", sandbox.url.path])
        #expect(inspected.0 == 0)
        #expect(inspected.2 == String(repeating: expected, count: 40))
        let skill = sandbox.url.appendingPathComponent("codex/skills/frontend-design/SKILL.md")
        #expect(try String(contentsOf: skill, encoding: .utf8).contains("Version \(expected.uppercased())"))
        #expect(try runHarness(["apply", sandbox.url.path]).0 == 0)
        #expect(try runHarness(["inspect", sandbox.url.path]).2 == String(repeating: "b", count: 40))
        #expect(try runHarness(["restore", sandbox.url.path]).0 == 0)
        #expect(try String(contentsOf: skill, encoding: .utf8).contains("Version A"))
    }

    @Test func anotherProcessCannotWriteWhileRootIsLocked() throws {
        let sandbox = try InstallSandbox.create()
        defer { try? FileManager.default.removeItem(at: sandbox.url) }
        #expect(try runHarness(["select", sandbox.url.path, "A"]).0 == 0)
        let root = try sandbox.open(), lock = try root.lock()
        let result = try runHarness(["apply", sandbox.url.path])
        lock.release()
        #expect(result.0 == 1)
        #expect(result.2.contains("Another helper operation"))
        #expect(try runHarness(["inspect", sandbox.url.path]).2 == "not_installed")
    }
}
