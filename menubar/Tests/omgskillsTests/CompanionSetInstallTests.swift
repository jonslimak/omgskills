import Foundation
import Testing
@testable import omgskills

@MainActor
@Suite(.serialized)
struct CompanionSetInstallTests {
    private let setLink = URL(string: "omgskills://group?url=https://omgskills.com/u/owner/sets/team-skills")!

    @Test func setLinksWaitForTheGateAndAreDroppedWhenItIsOff() async throws {
        let off = try controller(enabled: false)
        #expect(off.receive(setLink))
        #expect(!off.isActive)
        await off.refreshAvailability()
        #expect(!off.isActive)
        #expect(off.receive(setLink))
        #expect(!off.isActive)
        #expect(!off.receive(URL(string: "omgskills://catalog-install?v=1&id=owner%2Frepo&agent=claude")!))

        let on = try controller(enabled: true)
        #expect(on.receive(setLink))
        #expect(!on.isActive)
        await on.refreshAvailability()
        #expect(on.isActive)
        for _ in 0..<50 where on.install == nil { await Task.yield() }
        #expect(on.install?.groupName != nil)
        on.close()
        #expect(!on.isActive && on.install == nil)
    }

    @Test func catalogItemsResolveFromSingleRecordsAndRejectMismatchedRepositories() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SetRecordURLProtocol.self]
        let resolver = CatalogRecordRepositoryResolver(records: CatalogInstallRecordClient(session: URLSession(configuration: configuration)))

        #expect(try await resolver.repositorySlug(for: "owner/repo:skills/example") == "owner/repo")
        await #expect(throws: GroupSkillPackageLoaderError.invalidCatalogRepository("owner/moved:skills/example")) {
            try await resolver.repositorySlug(for: "owner/moved:skills/example")
        }
        await #expect(throws: GroupSkillPackageLoaderError.catalogSkillUnavailable("owner/missing:skills/example")) {
            try await resolver.repositorySlug(for: "owner/missing:skills/example")
        }
    }

    @Test func setLinksCannotOpenDuringPendingOrActiveAppReplacement() async throws {
        let coordinator = UpdateInstallCoordinator()
        let activity = coordinator.beginActivity(.portalConnection)
        coordinator.requestInstall {}
        let sets = try controller(enabled: true, coordinator: coordinator)
        #expect(sets.receive(setLink))
        await sets.refreshAvailability()
        #expect(!sets.isActive)
        activity.finish()
        #expect(coordinator.isAppReplacementActive)
        #expect(sets.receive(setLink))
        #expect(!sets.isActive)
    }

    @Test func readySetCannotStartWhenAppReplacementBegins() async throws {
        let coordinator = UpdateInstallCoordinator()
        let sets = try controller(enabled: true, coordinator: coordinator)
        await sets.refreshAvailability()
        #expect(sets.receive(setLink))
        for _ in 0..<100 where sets.install == nil { await Task.yield() }
        let install = try #require(sets.install)
        install.selectTarget(.claude)
        install.acknowledgesMetadataOnly = true
        await install.refreshSubscription()
        #expect(install.canInstall)
        coordinator.requestInstall {}
        sets.startInstall()
        #expect(install.phase == .ready)
        #expect(!coordinator.isBusy)
    }

    @Test func updateCheckBlocksOpeningAndPreparedActionsUntilItFinishes() async throws {
        var checking = true
        let sets = try controller(enabled: true, requestIsBlocked: { checking })
        await sets.refreshAvailability()
        #expect(sets.receive(setLink))
        #expect(!sets.isActive)
        checking = false
        #expect(sets.receive(setLink))
        for _ in 0..<100 where sets.install == nil { await Task.yield() }
        let install = try #require(sets.install)
        install.selectTarget(.claude)
        install.acknowledgesMetadataOnly = true
        await install.refreshSubscription()
        #expect(install.canInstall)
        checking = true
        sets.startInstall()
        sets.retryLoad()
        #expect(sets.install === install)
        #expect(install.phase == .ready)
        checking = false
        #expect(!sets.requestsBlocked)
        sets.close()
        #expect(!sets.isActive)
    }

    @Test func updateAndRetryCannotStartAfterAppUpdateCheckBegins() async throws {
        var checking = false
        let installer = SetRecordingInstaller()
        let sets = try controller(enabled: true, installer: installer, requestIsBlocked: { checking })
        await sets.refreshAvailability()
        #expect(sets.receive(setLink))
        for _ in 0..<100 where sets.install == nil { await Task.yield() }
        let install = try #require(sets.install)
        install.selectTarget(.claude)
        install.acknowledgesMetadataOnly = true
        await install.refreshSubscription()
        let diff = GroupSubscriptionDiff(groupId: "set", installedRevision: 6, currentRevision: 7,
            changes: [GroupSubscriptionChange(id: "skill", name: "Example", kind: .updated,
                wasReordered: false, isMetadataOnly: false, localState: .clean, packageAction: .update)])
        await installer.setSubscription(diff)
        await install.refreshSubscription()
        #expect(install.canApplySubscriptionUpdate)
        checking = true
        sets.startUpdate()
        #expect(install.phase == .ready)
        #expect(await installer.calls == 0)
        checking = false
        await installer.setSubscription(nil)
        await install.refreshSubscription()
        try await #require(install.startInstall()).value
        guard case .failure(let failure) = install.phase else {
            Issue.record("Expected the stub install to fail")
            return
        }
        #expect(failure.canRetry)
        checking = true
        sets.retryInstall()
        #expect(install.phase == .failure(failure))
        #expect(await installer.calls == 1)
    }

    private func controller(enabled: Bool, coordinator: UpdateInstallCoordinator = UpdateInstallCoordinator(),
                            installer: (any GroupSnapshotInstalling)? = nil,
                            requestIsBlocked: (@MainActor () -> Bool)? = nil) throws -> CompanionSetInstallController {
        let url = try #require(Bundle.module.url(forResource: "group-manifest-v2", withExtension: "json", subdirectory: "Fixtures"))
        let manifest = try JSONDecoder().decode(GroupManifest.self, from: Data(contentsOf: url))
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return CompanionSetInstallController(
            flow: GroupInstallFlowModel(credentialStore: SetCredentialStore(), manifestAPI: SetManifestAPI(manifest: manifest)),
            availability: SkillGroupsFeatureAvailability(buildSupportsSkillGroups: true, loader: SetGate(enabled: enabled)),
            installer: installer ?? ManagedSkillInstaller(managedRoot: root.appendingPathComponent("managed"), pathAnchor: root),
            packageLoader: GroupSkillPackageLoader(catalog: CatalogSkillPackageIndex(skills: [])),
            coordinator: coordinator, home: root,
            requestIsBlocked: requestIsBlocked ?? { coordinator.hasPendingInstall || coordinator.isAppReplacementActive })
    }
}

private actor SetRecordingInstaller: GroupSnapshotInstalling {
    private(set) var calls = 0
    private var subscription: GroupSubscriptionDiff?
    func setSubscription(_ value: GroupSubscriptionDiff?) { subscription = value }
    func detectGroupSubscription(manifest: GroupManifest, route: DeviceGroupManifestRoute,
                                 destination: ManagedGroupSnapshotDestination) async throws -> GroupSubscriptionDiff? {
        subscription
    }
    func installGroupSnapshot(_ request: ManagedGroupSnapshotInstallRequest, credential: StoredDeviceCredential,
                              packageLoader: any GroupSkillPackageLoading) async throws -> ManagedGroupSnapshotInstallResult {
        calls += 1
        throw GroupSkillPackageLoaderError.temporarilyUnavailable(retryAfter: nil)
    }
    func applyGroupSubscriptionUpdate(_ request: ManagedGroupSnapshotInstallRequest, credential: StoredDeviceCredential,
                                      packageLoader: any GroupSkillPackageLoading) async throws -> ManagedGroupSnapshotInstallResult {
        calls += 1
        throw GroupSkillPackageLoaderError.temporarilyUnavailable(retryAfter: nil)
    }
}

private struct SetGate: SkillGroupsFeatureConfigurationLoading {
    let enabled: Bool
    func loadSkillGroupsAuthEnabled() async throws -> Bool { enabled }
}

private actor SetCredentialStore: DeviceCredentialStoring {
    func load() async throws -> StoredDeviceCredential? { GroupSkillPackageTestSupport.credential() }
    func save(_ record: StoredDeviceCredential, replacingExisting: Bool) async throws {}
}

private struct SetManifestAPI: DeviceGroupManifestServing {
    let manifest: GroupManifest
    func fetchManifest(route: DeviceGroupManifestRoute, credential: StoredDeviceCredential) async throws -> GroupManifest {
        manifest
    }
}

private final class SetRecordURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let id = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.first!.value!
        let repository = id.hasPrefix("owner/moved") ? "someone/else" : "owner/repo"
        let body = id.hasPrefix("owner/missing")
            ? "{\"version\":1,\"found\":false,\"skill\":null}"
            : "{\"version\":1,\"found\":true,\"skill\":{\"id\":\"\(id)\",\"name\":\"example\",\"description\":\"Example\","
                + "\"author_handle\":\"owner\",\"github_url\":\"https://github.com/\(repository)/tree/main/skills/example\","
                + "\"install_cmd\":\"\"}}"
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
            headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
