import Foundation
import Testing
@testable import omgskills

@MainActor
struct GroupInstallFlowModelTests {
    @Test func loadsStoredCredentialAndAuthenticatedManifest() async throws {
        let credential = makeCredential()
        let api = RecordingManifestAPI(result: .success(try manifest()))
        let model = GroupInstallFlowModel(
            credentialStore: FlowCredentialStore(record: credential),
            manifestAPI: api
        )
        let route = try DeviceGroupManifestRoute(handle: "owner", groupSlug: "team-skills")

        let task = model.open(route)
        #expect(model.isPresented)
        #expect(model.phase == .loading)
        await task.value

        #expect(model.phase == .ready)
        #expect(model.presentationContext?.route == route)
        #expect(model.presentationContext?.credential == credential)
        #expect(model.presentationContext?.manifest.group.slug == "team-skills")
        #expect(await api.requestedRoutes() == [route])
    }

    @Test func missingCredentialRequiresReconnectWithoutCallingManifestAPI() async throws {
        let api = RecordingManifestAPI(result: .success(try manifest()))
        let model = GroupInstallFlowModel(
            credentialStore: FlowCredentialStore(record: nil),
            manifestAPI: api
        )

        await model.open(try DeviceGroupManifestRoute(handle: "owner", groupSlug: "team-skills")).value

        #expect(model.phase == .failure(.init(
            kind: .reconnectRequired,
            message: "Connect this Mac to omgskills before installing a Skill Group."
        )))
        #expect(await api.requestedRoutes().isEmpty)
    }

    @Test func retryableFailureCanLoadOnTheNextAttempt() async throws {
        let api = SequencedManifestAPI(results: [
            .failure(DeviceGroupManifestAPIError.temporarilyUnavailable(retryAfter: "30")),
            .success(try manifest()),
        ])
        let model = GroupInstallFlowModel(
            credentialStore: FlowCredentialStore(record: makeCredential()),
            manifestAPI: api
        )
        let route = try DeviceGroupManifestRoute(handle: "owner", groupSlug: "team-skills")

        await model.open(route).value
        guard case .failure(let failure) = model.phase else {
            Issue.record("Expected a retryable failure")
            return
        }
        #expect(failure.canRetry)

        let retryTask = try #require(model.retry())
        await retryTask.value
        #expect(model.phase == .ready)
    }

    @Test func dismissCancelsAndClearsThePresentation() async throws {
        let api = SuspendedManifestAPI()
        let model = GroupInstallFlowModel(
            credentialStore: FlowCredentialStore(record: makeCredential()),
            manifestAPI: api
        )

        model.open(try DeviceGroupManifestRoute(handle: "owner", groupSlug: "team-skills"))
        await api.waitUntilRequested()
        model.dismiss()
        await api.release()

        #expect(model.phase == .idle)
        #expect(!model.isPresented)
        #expect(model.presentationContext == nil)
    }

    private func manifest() throws -> GroupManifest {
        let url = try #require(Bundle.module.url(
            forResource: "group-manifest-v2",
            withExtension: "json",
            subdirectory: "Fixtures"
        ))
        return try JSONDecoder().decode(GroupManifest.self, from: Data(contentsOf: url))
    }

    private func makeCredential() -> StoredDeviceCredential {
        StoredDeviceCredential(
            credential: "device-secret",
            connection: DeviceConnectionInfo(
                deviceID: "device-id",
                accountLabel: "person@example.com",
                expiresAt: Date.distantFuture,
                grantedScopes: Set(DeviceScope.allCases)
            )
        )
    }
}

private actor FlowCredentialStore: DeviceCredentialStoring {
    private let record: StoredDeviceCredential?

    init(record: StoredDeviceCredential?) {
        self.record = record
    }

    func load() async throws -> StoredDeviceCredential? { record }
    func save(_ record: StoredDeviceCredential, replacingExisting: Bool) async throws {}
    func delete(deviceID: String) async throws {}
}

private actor RecordingManifestAPI: DeviceGroupManifestServing {
    private let result: Result<GroupManifest, Error>
    private var routes: [DeviceGroupManifestRoute] = []

    init(result: Result<GroupManifest, Error>) {
        self.result = result
    }

    func fetchManifest(
        route: DeviceGroupManifestRoute,
        credential: StoredDeviceCredential
    ) async throws -> GroupManifest {
        routes.append(route)
        return try result.get()
    }

    func requestedRoutes() -> [DeviceGroupManifestRoute] { routes }
}

private actor SequencedManifestAPI: DeviceGroupManifestServing {
    private var results: [Result<GroupManifest, Error>]
    private var requestCount = 0
    private var waiters: [(Int, CheckedContinuation<Void, Never>)] = []

    init(results: [Result<GroupManifest, Error>]) {
        self.results = results
    }

    func fetchManifest(
        route: DeviceGroupManifestRoute,
        credential: StoredDeviceCredential
    ) async throws -> GroupManifest {
        requestCount += 1
        let completed = waiters.filter { requestCount >= $0.0 }
        waiters.removeAll { requestCount >= $0.0 }
        completed.forEach { $0.1.resume() }
        return try results.removeFirst().get()
    }

    func waitForRequestCount(_ count: Int) async {
        guard requestCount < count else { return }
        await withCheckedContinuation { continuation in
            waiters.append((count, continuation))
        }
    }
}

private actor SuspendedManifestAPI: DeviceGroupManifestServing {
    private var requested = false
    private var requestWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseWaiters: [CheckedContinuation<Void, Never>] = []

    func fetchManifest(
        route: DeviceGroupManifestRoute,
        credential: StoredDeviceCredential
    ) async throws -> GroupManifest {
        requested = true
        requestWaiters.forEach { $0.resume() }
        requestWaiters.removeAll()
        await withCheckedContinuation { continuation in
            releaseWaiters.append(continuation)
        }
        try Task.checkCancellation()
        throw CancellationError()
    }

    func waitUntilRequested() async {
        guard !requested else { return }
        await withCheckedContinuation { continuation in
            requestWaiters.append(continuation)
        }
    }

    func release() {
        releaseWaiters.forEach { $0.resume() }
        releaseWaiters.removeAll()
    }
}
