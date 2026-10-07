import Foundation
import HandoffCore

// Embedded, script-free bytes for agent discovery only. Never fetched from a server.
package enum DiscoveryFixture {
    package static let policy = InstallPolicy(targetName: name, permitsRemoval: true, accepts: accepts)
    package static let name = "omgskills-h13-check-20261006"
    package static let id = "omgskills/local-h13:" + name

    package static func candidate(_ version: String) throws -> InstallCandidate {
        guard ["A", "B"].contains(version) else { throw InstallFailure.invalidRecord }
        let skill = """
        ---
        name: \(name)
        description: Harmless OMGSkills installation check. Use only when explicitly asked to run this check.
        ---
        Read CHECK.txt in this skill's directory and reply with its exact text.
        Do not use a remembered result. Read only this SKILL.md and CHECK.txt.
        Do not execute package scripts, install anything, modify files, or access
        the network for this check.

        """
        let entries = [("SKILL.md", skill), ("CHECK.txt", "OMGSkills H13 check: \(version)\n")].map { path, text in
            let data = Data(text.utf8)
            return (path: path, mode: "100644", data: data, blobSha: SkillIdentityResolver.gitBlobSHA(for: data))
        }
        let commit = String(repeating: version == "A" ? "a" : "b", count: 40)
        return try InstallCandidate(id: id, repo: "omgskills/local-h13", path: name, commit: commit,
                                    tree: InstallFixtures.flatTree(entries), skill: entries[0].blobSha, entries: entries)
    }

    package static func accepts(_ candidate: InstallCandidate) throws -> Bool {
        for version in ["A", "B"] {
            let expected = try self.candidate(version)
            if candidate == expected {
                return true
            }
        }
        return false
    }

    package static func selected(in sandbox: InstallSandbox) throws -> InstallCandidate {
        try candidate(InstallFixtures.selectedVersion(in: sandbox))
    }
}

package struct DiscoveryInstallService: InstallServing {
    private let store: SandboxInstaller
    private let control: InstallSandbox

    package init(home: UserInstallHome, agent: InstallAgent, control: InstallSandbox) {
        self.control = control
        store = SandboxInstaller(location: .user(home, agent, policy: DiscoveryFixture.policy))
    }

    package func prepare(_ request: HandoffRequest) async throws -> InstallReview {
        guard request.skillID == DiscoveryFixture.id else { throw InstallFailure.invalidRecord }
        try Task.checkCancellation()
        return try await store.prepare(DiscoveryFixture.selected(in: control))
    }
    package func prepareRestore() async throws -> InstallReview { try await store.prepareRestore() }
    package func apply(_ id: UUID) async throws -> String { try await store.apply(id) }
    package func discard(_ id: UUID) async { await store.discard(id) }
}
