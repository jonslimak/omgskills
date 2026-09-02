import Foundation

struct DevicePrivateSkillPackageAPI: PrivateSkillPackageFetching, Sendable {
    static let maximumResponseBytes = 19_000_000
    static let brokerLimits = SkillPackageValidationLimits(
        maximumFileCount: 512,
        maximumTotalBytes: 12 * 1024 * 1024,
        maximumFileBytes: 10 * 1024 * 1024,
        maximumSkillMdBytes: 2 * 1024 * 1024
    )

    private let origin: URL?
    private let session: any DeviceHTTPSession
    private let now: @Sendable () -> Date

    init(
        uploadEndpoint: URL = SkillSyncService.configuredEndpoint(),
        session: any DeviceHTTPSession = URLSession.shared,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.origin = Self.origin(from: uploadEndpoint)
        self.session = session
        self.now = now
    }

    func fetchPackage(
        sourceID: String,
        release: GroupManifestRelease,
        credential: StoredDeviceCredential
    ) async throws -> SkillPackage {
        guard credential.connection.expiresAt > now() else {
            throw GroupSkillPackageLoaderError.reconnectRequired
        }
        guard credential.connection.grantedScopes.contains(.contentRead) else {
            throw GroupSkillPackageLoaderError.contentReadRequired
        }
        guard let origin,
              Self.isOpaqueID(sourceID),
              Self.isOpaqueID(release.id) else {
            throw GroupSkillPackageLoaderError.invalidResponse
        }

        let url = origin
            .appendingPathComponent("api")
            .appendingPathComponent("portal")
            .appendingPathComponent("private-releases")
            .appendingPathComponent(release.id)
            .appendingPathComponent("package")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(credential.credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30

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
            throw GroupSkillPackageLoaderError.invalidResponse
        }
        try Self.validateStatus(httpResponse)
        if let contentLength = Self.contentLength(httpResponse),
           contentLength > Self.maximumResponseBytes {
            throw GroupSkillPackageLoaderError.responseTooLarge
        }
        guard data.count <= Self.maximumResponseBytes else {
            throw GroupSkillPackageLoaderError.responseTooLarge
        }
        guard httpResponse.value(forHTTPHeaderField: "Content-Type")?
            .lowercased().hasPrefix("application/x-ndjson") == true else {
            throw GroupSkillPackageLoaderError.invalidResponse
        }

        let package = try Self.decodePackage(
            data,
            expectedSourceID: sourceID,
            expectedRelease: release
        )
        _ = try SkillPackageValidator.validate(
            package,
            expected: release.coordinates,
            limits: Self.brokerLimits
        )
        return package
    }

    private static func decodePackage(
        _ data: Data,
        expectedSourceID: String,
        expectedRelease: GroupManifestRelease
    ) throws -> SkillPackage {
        guard !data.isEmpty, data.last == 10 else {
            throw GroupSkillPackageLoaderError.invalidResponse
        }
        var lines = data.split(separator: 10, omittingEmptySubsequences: false)
        guard lines.last?.isEmpty == true else {
            throw GroupSkillPackageLoaderError.invalidResponse
        }
        lines.removeLast()
        guard lines.count >= 2, lines.allSatisfy({ !$0.isEmpty }) else {
            throw GroupSkillPackageLoaderError.invalidResponse
        }

        let decoder = JSONDecoder()
        let header: PackageHeader
        do {
            header = try decoder.decode(PackageHeader.self, from: Data(lines[0]))
        } catch {
            throw GroupSkillPackageLoaderError.invalidResponse
        }
        guard header.type == "omgskills.skill_package",
              header.version == 1,
              header.sourceID == expectedSourceID,
              header.releaseID == expectedRelease.id,
              header.fileCount >= 0,
              header.fileCount <= brokerLimits.maximumFileCount,
              lines.count == header.fileCount + 2 else {
            throw GroupSkillPackageLoaderError.invalidResponse
        }

        let coordinates = SkillPackageCoordinates(
            commitSha: header.coordinates.commitSha,
            treeSha: header.coordinates.treeSha,
            skillMdSha: header.coordinates.skillMdSha
        )
        guard coordinates == expectedRelease.coordinates else {
            throw GroupSkillPackageLoaderError.invalidResponse
        }

        var entries: [SkillPackageEntry] = []
        entries.reserveCapacity(header.fileCount)
        var totalBytes = 0
        for index in 0..<header.fileCount {
            try Task.checkCancellation()
            let payload: PackageFile
            do {
                payload = try decoder.decode(PackageFile.self, from: Data(lines[index + 1]))
            } catch {
                throw GroupSkillPackageLoaderError.invalidResponse
            }
            guard payload.type == "file", let fileData = Data(base64Encoded: payload.data) else {
                throw GroupSkillPackageLoaderError.invalidResponse
            }
            guard fileData.count <= brokerLimits.maximumFileBytes else {
                throw GroupSkillPackageLoaderError.responseTooLarge
            }
            if payload.path == "SKILL.md",
               fileData.count > brokerLimits.maximumSkillMdBytes {
                throw GroupSkillPackageLoaderError.responseTooLarge
            }
            let (newTotal, overflow) = totalBytes.addingReportingOverflow(fileData.count)
            guard !overflow, newTotal <= brokerLimits.maximumTotalBytes else {
                throw GroupSkillPackageLoaderError.responseTooLarge
            }
            totalBytes = newTotal
            entries.append(SkillPackageEntry(
                path: payload.path,
                mode: payload.mode,
                data: fileData,
                blobSha: payload.blobSha
            ))
        }

        let end: PackageEnd
        do {
            end = try decoder.decode(PackageEnd.self, from: Data(lines[lines.count - 1]))
        } catch {
            throw GroupSkillPackageLoaderError.invalidResponse
        }
        guard end.type == "end" else {
            throw GroupSkillPackageLoaderError.invalidResponse
        }
        try Task.checkCancellation()
        return SkillPackage(coordinates: coordinates, entries: entries)
    }

    private static func validateStatus(_ response: HTTPURLResponse) throws {
        guard (200..<300).contains(response.statusCode) else {
            let retryAfter = response.value(forHTTPHeaderField: "Retry-After")
            switch response.statusCode {
            case 401:
                throw GroupSkillPackageLoaderError.reconnectRequired
            case 404:
                throw GroupSkillPackageLoaderError.packageUnavailable
            case 429:
                throw GroupSkillPackageLoaderError.rateLimited(retryAfter: retryAfter)
            case 503:
                throw GroupSkillPackageLoaderError.temporarilyUnavailable(retryAfter: retryAfter)
            default:
                throw GroupSkillPackageLoaderError.server(statusCode: response.statusCode)
            }
        }
    }

    private static func contentLength(_ response: HTTPURLResponse) -> Int? {
        guard let value = response.value(forHTTPHeaderField: "Content-Length"),
              let length = Int(value), length >= 0 else { return nil }
        return length
    }

    private static func isOpaqueID(_ value: String) -> Bool {
        (16...100).contains(value.utf8.count) && value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...70).contains(byte) ||
                (97...102).contains(byte) || byte == 45
        }
    }

    private static func origin(from endpoint: URL) -> URL? {
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false),
              components.scheme == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil else {
            return nil
        }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }
}

private struct PackageCoordinatesPayload: Decodable {
    let commitSha: String
    let treeSha: String
    let skillMdSha: String
}

private struct PackageHeader: Decodable {
    let type: String
    let version: Int
    let sourceID: String
    let releaseID: String
    let coordinates: PackageCoordinatesPayload
    let fileCount: Int

    private enum CodingKeys: String, CodingKey {
        case type
        case version
        case sourceID = "sourceId"
        case releaseID = "releaseId"
        case coordinates
        case fileCount
    }
}

private struct PackageFile: Decodable {
    let type: String
    let path: String
    let mode: String
    let blobSha: String
    let data: String
}

private struct PackageEnd: Decodable {
    let type: String
}
