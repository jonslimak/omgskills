import Testing
@testable import omgskills

@MainActor
struct UpdateInstallCoordinatorTests {
    @Test func idleInstallInvokesHandlerOnce() {
        let coordinator = UpdateInstallCoordinator()
        var installCount = 0

        let accepted = coordinator.requestInstall(
            targetVersion: "0.0.20",
            targetBuild: "20"
        ) {
            installCount += 1
        }

        #expect(accepted == true)
        #expect(installCount == 1)
        #expect(coordinator.isBusy == false)
        #expect(coordinator.hasPendingInstall == false)
    }

    @Test func activeActivityDefersInstall() {
        let coordinator = UpdateInstallCoordinator()
        let token = coordinator.beginActivity(.skillInstall)
        var installCount = 0

        coordinator.requestInstall(
            targetVersion: "0.0.20",
            targetBuild: "20"
        ) {
            installCount += 1
        }

        #expect(installCount == 0)
        #expect(coordinator.isBusy == true)
        #expect(coordinator.hasPendingInstall == true)
        #expect(coordinator.pendingTargetVersion == "0.0.20")
        #expect(coordinator.pendingTargetBuild == "20")

        token.finish()

        #expect(installCount == 1)
        #expect(coordinator.isBusy == false)
        #expect(coordinator.hasPendingInstall == false)
    }

    @Test func finalActivityCompletionTriggersInstallOnce() {
        let coordinator = UpdateInstallCoordinator()
        let firstToken = coordinator.beginActivity(.skillInstall)
        let secondToken = coordinator.beginActivity(.portalConnection)
        var installCount = 0

        coordinator.requestInstall {
            installCount += 1
        }

        firstToken.finish()

        #expect(installCount == 0)
        #expect(coordinator.isBusy == true)
        #expect(coordinator.hasPendingInstall == true)

        secondToken.finish()
        secondToken.finish()

        #expect(installCount == 1)
        #expect(coordinator.isBusy == false)
        #expect(coordinator.hasPendingInstall == false)
    }

    @Test func duplicatePendingInstallDoesNotReplaceOriginalHandler() {
        let coordinator = UpdateInstallCoordinator()
        let token = coordinator.beginActivity(.legacySync)
        var installedVersion: String?

        coordinator.requestInstall(targetVersion: "0.0.20") {
            installedVersion = "0.0.20"
        }
        coordinator.requestInstall(targetVersion: "0.0.21") {
            installedVersion = "0.0.21"
        }

        #expect(coordinator.pendingTargetVersion == "0.0.20")

        token.finish()

        #expect(installedVersion == "0.0.20")
    }

    @Test func scopedActivityClearsAfterSuccess() {
        let coordinator = UpdateInstallCoordinator()

        coordinator.withActivity(.localCrossInstall) {
            #expect(coordinator.isBusy == true)
        }

        #expect(coordinator.isBusy == false)
    }

    @Test func scopedActivityClearsAfterFailure() {
        let coordinator = UpdateInstallCoordinator()

        #expect(throws: TestError.self) {
            try coordinator.withActivity(.localSkillDelete) {
                #expect(coordinator.isBusy == true)
                throw TestError.expected
            }
        }

        #expect(coordinator.isBusy == false)
    }

    @Test func scopedActivityClearsAfterCancellation() {
        let coordinator = UpdateInstallCoordinator()

        #expect(throws: CancellationError.self) {
            try coordinator.withActivity(.gitHubInstallPrompt) {
                #expect(coordinator.isBusy == true)
                throw CancellationError()
            }
        }

        #expect(coordinator.isBusy == false)
    }

    private enum TestError: Error {
        case expected
    }
}
