import Foundation
import Testing
@testable import omgskills

struct SkillGroupsFeatureAvailabilityTests {
    @Test func releaseConfigurationAPIReadsVersionedBooleanWithoutCache() async throws {
        let session = ReleaseConfigurationHTTPSession(responses: [
            .init(statusCode: 200, body: Data(#"{"version":1,"skillGroupsAuthEnabled":true}"#.utf8))
        ])
        let url = URL(string: "https://example.com/app/release-config.json")!
        let api = SkillGroupsReleaseConfigurationAPI(url: url, session: session)

        #expect(try await api.loadSkillGroupsAuthEnabled())
        let request = try #require(await session.requests().first)
        #expect(request.url == url)
        #expect(request.cachePolicy == .reloadIgnoringLocalCacheData)
        #expect(request.timeoutInterval == 10)
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
    }

    @Test func releaseConfigurationAPIRejectsServerOversizeAndMalformedResponses() async throws {
        let url = URL(string: "https://example.com/app/release-config.json")!
        let server = SkillGroupsReleaseConfigurationAPI(
            url: url,
            session: ReleaseConfigurationHTTPSession(responses: [
                .init(statusCode: 503, body: Data())
            ])
        )
        await #expect(throws: SkillGroupsReleaseConfigurationError.server(statusCode: 503)) {
            try await server.loadSkillGroupsAuthEnabled()
        }

        let oversized = SkillGroupsReleaseConfigurationAPI(
            url: url,
            session: ReleaseConfigurationHTTPSession(responses: [
                .init(
                    statusCode: 200,
                    body: Data(repeating: 0, count: SkillGroupsReleaseConfigurationAPI.maximumResponseBytes + 1)
                )
            ])
        )
        await #expect(throws: SkillGroupsReleaseConfigurationError.responseTooLarge) {
            try await oversized.loadSkillGroupsAuthEnabled()
        }

        for body in [
            Data(#"{"version":2,"skillGroupsAuthEnabled":true}"#.utf8),
            Data(#"{"version":1}"#.utf8),
            Data("not-json".utf8)
        ] {
            let malformed = SkillGroupsReleaseConfigurationAPI(
                url: url,
                session: ReleaseConfigurationHTTPSession(responses: [
                    .init(statusCode: 200, body: body)
                ])
            )
            await #expect(throws: SkillGroupsReleaseConfigurationError.invalidResponse) {
                try await malformed.loadSkillGroupsAuthEnabled()
            }
        }
    }

    @MainActor
    @Test func unsupportedBuildNeverLoadsAndDiscardsDeepLinks() async {
        let loader = SequencedFeatureConfigurationLoader(responses: [.enabled])
        let model = SkillGroupsFeatureAvailability(
            buildSupportsSkillGroups: false,
            loader: loader
        )

        #expect(model.hasResolved)
        #expect(model.deepLinkDisposition == .discard)
        #expect(await model.refresh() == false)
        #expect(await loader.requestCount() == 0)
    }

    @MainActor
    @Test func supportedBuildQueuesUntilEnabledConfigurationResolves() async {
        let loader = SequencedFeatureConfigurationLoader(responses: [.enabled])
        let model = SkillGroupsFeatureAvailability(
            buildSupportsSkillGroups: true,
            loader: loader
        )

        #expect(!model.isEnabled)
        #expect(!model.hasResolved)
        #expect(model.deepLinkDisposition == .queueUntilResolved)
        #expect(await model.refresh())
        #expect(model.isEnabled)
        #expect(model.hasResolved)
        #expect(model.deepLinkDisposition == .handle)
    }

    @MainActor
    @Test func foregroundRefreshCanDisablePreviouslyEnabledFeature() async {
        let loader = SequencedFeatureConfigurationLoader(responses: [.enabled, .disabled])
        let model = SkillGroupsFeatureAvailability(
            buildSupportsSkillGroups: true,
            loader: loader
        )

        #expect(await model.refresh())
        #expect(await model.refresh() == false)
        #expect(!model.isEnabled)
        #expect(model.deepLinkDisposition == .discard)
    }

    @MainActor
    @Test func networkAndMalformedFailuresFailClosed() async {
        let loader = SequencedFeatureConfigurationLoader(responses: [
            .enabled,
            .failure(.timedOut),
            .enabled,
            .failure(.cannotParseResponse),
            .enabled,
            .cancellation
        ])
        let model = SkillGroupsFeatureAvailability(
            buildSupportsSkillGroups: true,
            loader: loader
        )

        #expect(await model.refresh())
        #expect(await model.refresh() == false)
        #expect(!model.isEnabled)
        #expect(await model.refresh())
        #expect(await model.refresh() == false)
        #expect(!model.isEnabled)
        #expect(await model.refresh())
        #expect(await model.refresh() == false)
        #expect(!model.isEnabled)
    }

    @MainActor
    @Test func staleResponseCannotReenableAfterNewerDisabledResponse() async {
        let loader = ControlledFeatureConfigurationLoader()
        let model = SkillGroupsFeatureAvailability(
            buildSupportsSkillGroups: true,
            loader: loader
        )

        let first = Task { await model.refresh() }
        await loader.waitForRequestCount(1)
        let second = Task { await model.refresh() }
        await loader.waitForRequestCount(2)

        await loader.resumeRequest(1, enabled: false)
        #expect(await second.value == false)
        await loader.resumeRequest(0, enabled: true)
        _ = await first.value

        #expect(!model.isEnabled)
        #expect(model.deepLinkDisposition == .discard)
    }
}

private actor ReleaseConfigurationHTTPSession: DeviceHTTPSession {
    struct Response: Sendable {
        let statusCode: Int
        let body: Data
    }

    private var responses: [Response]
    private var recordedRequests: [URLRequest] = []

    init(responses: [Response]) {
        self.responses = responses
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        recordedRequests.append(request)
        let response = responses.removeFirst()
        let httpResponse = HTTPURLResponse(
            url: request.url!,
            statusCode: response.statusCode,
            httpVersion: nil,
            headerFields: nil
        )!
        return (response.body, httpResponse)
    }

    func requests() -> [URLRequest] {
        recordedRequests
    }
}

private actor SequencedFeatureConfigurationLoader: SkillGroupsFeatureConfigurationLoading {
    enum Response: Sendable {
        case enabled
        case disabled
        case failure(URLError.Code)
        case cancellation
    }

    private var responses: [Response]
    private var requests = 0

    init(responses: [Response]) {
        self.responses = responses
    }

    func loadSkillGroupsAuthEnabled() async throws -> Bool {
        requests += 1
        switch responses.removeFirst() {
        case .enabled:
            return true
        case .disabled:
            return false
        case .failure(let code):
            throw URLError(code)
        case .cancellation:
            throw CancellationError()
        }
    }

    func requestCount() -> Int {
        requests
    }
}

private actor ControlledFeatureConfigurationLoader: SkillGroupsFeatureConfigurationLoading {
    private var continuations: [Int: CheckedContinuation<Bool, Error>] = [:]
    private var requestCountValue = 0
    private var waiters: [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []

    func loadSkillGroupsAuthEnabled() async throws -> Bool {
        let requestIndex = requestCountValue
        requestCountValue += 1
        let readyWaiters = waiters.filter { $0.count <= requestCountValue }
        waiters.removeAll { $0.count <= requestCountValue }
        readyWaiters.forEach { $0.continuation.resume() }
        return try await withCheckedThrowingContinuation { continuation in
            continuations[requestIndex] = continuation
        }
    }

    func waitForRequestCount(_ count: Int) async {
        guard requestCountValue < count else { return }
        await withCheckedContinuation { continuation in
            waiters.append((count, continuation))
        }
    }

    func resumeRequest(_ index: Int, enabled: Bool) {
        continuations.removeValue(forKey: index)?.resume(returning: enabled)
    }
}
