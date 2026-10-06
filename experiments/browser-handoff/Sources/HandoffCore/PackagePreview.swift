import Foundation
import Observation

public struct PackagePreview: Equatable, Sendable, Codable {
    public let skillID: String
    public let repo: String
    public let path: String
    public let commit: String
    public let treeSHA: String
    public let skillSHA: String
    public let totalBytes: Int
    public let files: [File]

    public struct File: Equatable, Sendable, Codable, Identifiable {
        public let path: String
        public let size: Int
        public let mode: String
        public let blobSHA: String
        public var id: String { path }
    }
}

public protocol PackagePreviewLoading: Sendable {
    func preview(_ request: HandoffRequest) async throws -> PackagePreview
}

public struct PublicPackagePreviewService: PackagePreviewLoading {
    private let loader: PublicPackageLoader

    public init() { loader = PublicPackageLoader(http: BoundedPublicHTTP()) }
    init(http: any PublicHTTPClient) { loader = PublicPackageLoader(http: http) }

    public func preview(_ request: HandoffRequest) async throws -> PackagePreview {
        try await withThrowingTaskGroup(of: PackagePreview.self) { group in
            group.addTask {
                let pin = try await loader.resolve(request)
                let package = try await loader.fetch(pin)
                try Task.checkCancellation()
                return try Self.stageAndVerify(package, pin: pin)
            }
            group.addTask {
                try await Task.sleep(for: .seconds(180))
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            guard let preview = try await group.next() else { throw CancellationError() }
            return preview
        }
    }

    // Preview-only staging: no retained executable, provenance, target path, or install operation.
    // The verified summary outlives this workspace; all bytes are discarded before it is published.
    static func stageAndVerify(
        _ package: SkillPackage, pin: PublicPin,
        parent: URL = FileManager.default.temporaryDirectory
    ) throws -> PackagePreview {
        let fm = FileManager.default
        let expected = SkillPackageCoordinates(commitSha: pin.commit,
                                               treeSha: pin.treeSHA ?? package.coordinates.treeSha,
                                               skillMdSha: pin.skillSHA)
        _ = try SkillPackageValidator.validate(package, expected: expected, limits: PublicPackageLoader.limits)
        let root = parent.appendingPathComponent("omgskills-h1-preview-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        do {
            for entry in package.entries {
                try Task.checkCancellation()
                let target = root.appendingPathComponent(entry.path)
                try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true,
                                       attributes: [.posixPermissions: 0o700])
                try entry.data.write(to: target, options: .withoutOverwriting)
                // Never make a preview download executable, even if its Git mode is 100755.
                try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
            }
            let readback = try package.entries.map { entry in
                SkillPackageEntry(path: entry.path, mode: entry.mode,
                                  data: try Data(contentsOf: root.appendingPathComponent(entry.path)), blobSha: entry.blobSha)
            }
            let verified = try SkillPackageValidator.validate(
                SkillPackage(coordinates: package.coordinates, entries: readback),
                expected: expected, limits: PublicPackageLoader.limits
            )
            try Task.checkCancellation()
            let preview = PackagePreview(
                skillID: pin.id, repo: pin.repo, path: pin.path, commit: verified.coordinates.commitSha,
                treeSHA: verified.coordinates.treeSha, skillSHA: verified.coordinates.skillMdSha,
                totalBytes: verified.totalBytes,
                files: readback.sorted { $0.path < $1.path }.map {
                    PackagePreview.File(path: $0.path, size: $0.data.count, mode: $0.mode, blobSHA: $0.blobSha)
                }
            )
            try fm.removeItem(at: root)
            return preview
        } catch {
            // Cleanup failure must not be reported as a successful preview or hidden cancellation.
            if fm.fileExists(atPath: root.path) { try fm.removeItem(at: root) }
            throw error
        }
    }
}

@MainActor @Observable
public final class PreviewModel {
    public private(set) var request: HandoffRequest?
    public private(set) var preview: PackagePreview?
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?
    @ObservationIgnored private let service: any PackagePreviewLoading
    @ObservationIgnored private(set) var task: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()

    public init(service: any PackagePreviewLoading = PublicPackagePreviewService()) {
        self.service = service
    }

    public func open(_ rawURL: String) {
        guard let incoming = HandoffRequest.parse(rawURL) else {
            cancel()
            errorMessage = "Invalid preview link. Nothing was installed."
            return
        }
        if incoming == request, isLoading || preview != nil { return }
        cancel()
        request = incoming
        isLoading = true
        let current = generation
        task = Task { [weak self, service] in
            do {
                let result = try await service.preview(incoming)
                try Task.checkCancellation()
                guard let self, generation == current else { return }
                preview = result
                isLoading = false
                task = nil
            } catch {
                guard let self, generation == current, !Task.isCancelled else { return }
                isLoading = false
                task = nil
                if let failure = error as? PreviewFailure {
                    errorMessage = failure.localizedDescription
                } else if error is SkillPackageValidationError {
                    errorMessage = "Package safety checks failed. Nothing was installed."
                } else if (error as? URLError)?.code == .timedOut {
                    errorMessage = "The download timed out. Try again."
                } else {
                    errorMessage = "The preview could not be loaded safely. Nothing was installed."
                }
            }
        }
    }

    public func cancel() {
        generation = UUID()
        task?.cancel()
        task = nil
        request = nil
        preview = nil
        isLoading = false
        errorMessage = nil
    }

    deinit { task?.cancel() }
}
