import Foundation
import HandoffCore

package struct FixtureInstallService: InstallServing {
    private let control: InstallSandbox
    private let store: SandboxInstaller

    package init(testRoot: String) throws {
        control = try InstallSandbox(path: testRoot)
        store = SandboxInstaller(sandbox: control)
    }

    package init(home: UserInstallHome, agent: InstallAgent, control: InstallSandbox) {
        self.control = control
        store = SandboxInstaller(location: .user(home, agent))
    }

    package func prepare(_ request: HandoffRequest) async throws -> InstallReview {
        guard request.skillID == HandoffRequest.pinnedTestSkillID else { throw InstallFailure.invalidRecord }
        try Task.checkCancellation()
        return try await store.prepare(InstallFixtures.selected(in: control))
    }
    package func prepareRestore() async throws -> InstallReview { try await store.prepareRestore() }
    package func apply(_ id: UUID) async throws -> String { try await store.apply(id) }
    package func discard(_ id: UUID) async { await store.discard(id) }
}
