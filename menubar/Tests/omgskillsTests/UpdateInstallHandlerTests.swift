import Foundation
import Testing
@testable import omgskills

@MainActor
struct UpdateInstallHandlerTests {
    @Test func idleInstallStoresTargetAndInvokesHandlerOnce() {
        let testContext = makeTestContext()
        defer { testContext.cleanup() }
        var installCount = 0

        let accepted = testContext.handler.handleInstallOnQuit(
            targetVersion: "0.0.20",
            targetBuild: "20"
        ) {
            installCount += 1
        }

        #expect(accepted == true)
        #expect(installCount == 1)
        #expect(testContext.store.load() == PendingUpdateInstall(
            sourceVersion: "0.0.19",
            sourceBuild: "19",
            targetVersion: "0.0.20",
            targetBuild: "20"
        ))
        #expect(testContext.emitted.values.map(\.name) == [
            "app.update_ready",
            "app.update_relaunch_requested"
        ])
    }

    @Test func busyInstallDefersUntilActivityFinishes() {
        let testContext = makeTestContext()
        defer { testContext.cleanup() }
        let activity = testContext.coordinator.beginActivity(.skillInstall)
        var installCount = 0

        testContext.handler.handleInstallOnQuit(
            targetVersion: "0.0.20",
            targetBuild: "20"
        ) {
            installCount += 1
        }

        #expect(installCount == 0)
        #expect(testContext.store.load() == nil)
        #expect(testContext.coordinator.hasPendingInstall == true)
        #expect(testContext.coordinator.pendingTargetVersion == "0.0.20")
        #expect(testContext.coordinator.pendingTargetBuild == "20")
        #expect(testContext.emitted.values.map(\.name) == [
            "app.update_ready",
            "app.update_deferred_busy"
        ])

        activity.finish()

        #expect(installCount == 1)
        #expect(testContext.store.load() == PendingUpdateInstall(
            sourceVersion: "0.0.19",
            sourceBuild: "19",
            targetVersion: "0.0.20",
            targetBuild: "20"
        ))
        #expect(testContext.coordinator.hasPendingInstall == false)
        #expect(testContext.emitted.values.map(\.name) == [
            "app.update_ready",
            "app.update_deferred_busy",
            "app.update_relaunch_requested"
        ])
    }

    @Test func pendingStoreCanClearSavedTarget() {
        let testContext = makeTestContext()
        defer { testContext.cleanup() }

        testContext.store.save(
            sourceVersion: "0.0.19",
            sourceBuild: "19",
            targetVersion: "0.0.20",
            targetBuild: "20"
        )
        #expect(testContext.store.load() != nil)

        testContext.store.clear()

        #expect(testContext.store.load() == nil)
    }

    private func makeTestContext() -> TestContext {
        let suiteName = UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        let coordinator = UpdateInstallCoordinator()
        let store = PendingUpdateInstallStore(userDefaults: defaults)
        let emitted = EmittedSignals()
        let handler = UpdateInstallHandler(
            coordinator: coordinator,
            pendingStore: store,
            appVersionParameters: {
                [
                    "app_version": "0.0.19",
                    "build_number": "19"
                ]
            },
            emit: { name, parameters in
                emitted.append(name: name, parameters: parameters)
            }
        )
        return TestContext(
            suiteName: suiteName,
            defaults: defaults,
            coordinator: coordinator,
            store: store,
            handler: handler,
            emitted: emitted
        )
    }

    private final class EmittedSignals {
        private(set) var values: [(name: String, parameters: [String: String])] = []

        func append(name: String, parameters: [String: String]) {
            values.append((name: name, parameters: parameters))
        }
    }

    private struct TestContext {
        let suiteName: String
        let defaults: UserDefaults
        let coordinator: UpdateInstallCoordinator
        let store: PendingUpdateInstallStore
        let handler: UpdateInstallHandler
        let emitted: EmittedSignals

        func cleanup() {
            defaults.removePersistentDomain(forName: suiteName)
        }
    }
}
