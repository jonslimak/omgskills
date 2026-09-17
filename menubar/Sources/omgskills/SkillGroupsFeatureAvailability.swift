import Foundation
import Observation

enum SkillGroupsReleaseConfigurationError: Error, Equatable, Sendable {
    case server(statusCode: Int)
    case responseTooLarge
    case invalidResponse
}

protocol SkillGroupsFeatureConfigurationLoading: Sendable {
    func loadSkillGroupsAuthEnabled() async throws -> Bool
}

struct SkillGroupsReleaseConfigurationAPI: SkillGroupsFeatureConfigurationLoading, Sendable {
    static let maximumResponseBytes = 64 * 1024

    private struct Payload: Decodable {
        let version: Int
        let skillGroupsAuthEnabled: Bool
    }

    private let url: URL
    private let session: any DeviceHTTPSession

    init(
        url: URL = AppRuntimeConfiguration.skillGroupsReleaseConfigurationURL,
        session: any DeviceHTTPSession = URLSession.shared
    ) {
        self.url = url
        self.session = session
    }

    func loadSkillGroupsAuthEnabled() async throws -> Bool {
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 10
        )
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        }
        try Task.checkCancellation()

        guard let httpResponse = response as? HTTPURLResponse else {
            throw SkillGroupsReleaseConfigurationError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw SkillGroupsReleaseConfigurationError.server(statusCode: httpResponse.statusCode)
        }
        guard data.count <= Self.maximumResponseBytes else {
            throw SkillGroupsReleaseConfigurationError.responseTooLarge
        }
        guard let payload = try? JSONDecoder().decode(Payload.self, from: data),
              payload.version == 1 else {
            throw SkillGroupsReleaseConfigurationError.invalidResponse
        }
        return payload.skillGroupsAuthEnabled
    }
}

@MainActor
@Observable
final class SkillGroupsFeatureAvailability {
    enum DeepLinkDisposition: Equatable, Sendable {
        case handle
        case queueUntilResolved
        case discard
    }

    private(set) var isEnabled = false
    private(set) var hasResolved: Bool
    let buildSupportsSkillGroups: Bool

    @ObservationIgnored private let loader: any SkillGroupsFeatureConfigurationLoading
    @ObservationIgnored private var activeAttemptID: UUID?

    init(
        buildSupportsSkillGroups: Bool,
        loader: any SkillGroupsFeatureConfigurationLoading = SkillGroupsReleaseConfigurationAPI()
    ) {
        self.buildSupportsSkillGroups = buildSupportsSkillGroups
        self.loader = loader
        self.hasResolved = !buildSupportsSkillGroups
    }

    var deepLinkDisposition: DeepLinkDisposition {
        if isEnabled {
            return .handle
        }
        if buildSupportsSkillGroups, !hasResolved {
            return .queueUntilResolved
        }
        return .discard
    }

    @discardableResult
    func refresh() async -> Bool {
        let attemptID = UUID()
        activeAttemptID = attemptID

        guard buildSupportsSkillGroups else {
            isEnabled = false
            hasResolved = true
            activeAttemptID = nil
            return false
        }

        do {
            let remoteEnabled = try await loader.loadSkillGroupsAuthEnabled()
            try Task.checkCancellation()
            guard activeAttemptID == attemptID else { return isEnabled }
            isEnabled = remoteEnabled
            hasResolved = true
            activeAttemptID = nil
            return remoteEnabled
        } catch is CancellationError {
            guard !Task.isCancelled else { return isEnabled }
            return resolveDisabled(attemptID: attemptID)
        } catch {
            return resolveDisabled(attemptID: attemptID)
        }
    }

    private func resolveDisabled(attemptID: UUID) -> Bool {
        guard activeAttemptID == attemptID else { return isEnabled }
        isEnabled = false
        hasResolved = true
        activeAttemptID = nil
        return false
    }
}
