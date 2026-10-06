import Foundation

// Embedded, script-free bytes for agent discovery only. Never fetched from a server.
enum DiscoveryFixture {
    static let name = "omgskills-h13-check-20261006"
    static let id = "omgskills/local-h13:" + name

    static func candidate(_ version: String) throws -> InstallCandidate {
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
            return SkillPackageEntry(path: path, mode: "100644", data: data, blobSha: SkillIdentityResolver.gitBlobSHA(for: data))
        }
        let commit = String(repeating: version == "A" ? "a" : "b", count: 40)
        let pin = try PublicPin(id: id, repo: "omgskills/local-h13", path: name, commit: commit,
                                skillSHA: entries[0].blobSha, treeSHA: InstallFixtures.flatTree(entries))
        return InstallCandidate(pin: pin, package: .init(coordinates: .init(
            commitSha: commit, treeSha: pin.treeSHA!, skillMdSha: pin.skillSHA), entries: entries))
    }

    static func accepts(_ candidate: InstallCandidate) throws -> Bool {
        for version in ["A", "B"] {
            let expected = try self.candidate(version)
            if candidate.pin == expected.pin, candidate.package.coordinates == expected.package.coordinates,
               candidate.package.entries.sorted(by: { $0.path < $1.path }) == expected.package.entries.sorted(by: { $0.path < $1.path }) {
                return true
            }
        }
        return false
    }

    static func selected(in sandbox: InstallSandbox) throws -> InstallCandidate {
        try candidate(InstallFixtures.selectedVersion(in: sandbox))
    }
}

struct DiscoveryInstallService: InstallServing {
    private let store: SandboxInstaller
    private let control: InstallSandbox

    init(home: UserInstallHome, agent: InstallAgent, control: InstallSandbox) {
        self.control = control
        store = SandboxInstaller(location: .user(home, agent, discovery: true))
    }

    func prepare(_ request: HandoffRequest) async throws -> InstallReview {
        guard request.skillID == DiscoveryFixture.id else { throw InstallFailure.invalidRecord }
        try Task.checkCancellation()
        return try await store.prepare(DiscoveryFixture.selected(in: control))
    }
    func prepareRestore() async throws -> InstallReview { try await store.prepareRestore() }
    func apply(_ id: UUID) async throws -> String { try await store.apply(id) }
    func discard(_ id: UUID) async { await store.discard(id) }
}
