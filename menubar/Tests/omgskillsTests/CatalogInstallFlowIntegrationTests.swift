#if DEBUG
import Foundation
import Testing
@testable import omgskills

@MainActor
struct CatalogInstallFlowIntegrationTests {
    @Test func confirmationCancelInstallAndRepeatUseTheRealAdapterOnlyInsideTheTestHome() async throws {
        let rawRoot = URL(fileURLWithPath: "/private/tmp/omgskills-f1-" + UUID().uuidString, isDirectory: true)
        let repository = try LocalGitPackageRepository(root: rawRoot, packagePath: ".")
        defer { repository.remove() }
        let root = rawRoot.resolvingSymlinksInPath()
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        try FileManager.default.createDirectory(at: paths.homeDirectory, withIntermediateDirectories: false)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FlowRecordProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let git = GitCommandRunner(temporaryRoot: repository.temporaryRoot)
        let local = LocalCloneRunner(git: git, repository: repository.repositoryRoot)
        let catalog = CatalogSkillInstaller(managedInstaller: ManagedSkillInstaller(managedRoot: root.appendingPathComponent("managed"),
            pathAnchor: paths.homeDirectory), filesystemPaths: paths)
        let service = CatalogInstallFlowService(records: CatalogInstallRecordClient(session: session),
            installer: CatalogInstallService(installer: catalog, gitProvider: { local }))
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        let url = URL(string: "omgskills-f1://catalog-install?v=1&id=owner%2Frepo%3Aalias&agent=codex")!
        model.receive(url)
        await model.operation?.value
        #expect(model.phase == .confirm)
        #expect(model.destination == paths.codexSkillsRoot.appendingPathComponent("old-alias"))
        #expect(try FileManager.default.contentsOfDirectory(atPath: paths.homeDirectory.path).isEmpty)
        #expect(!CatalogInstallFilesystem.exists(paths.legacyRepoCacheRoot))
        #expect(await model.close())
        #expect(try FileManager.default.contentsOfDirectory(atPath: paths.homeDirectory.path).isEmpty)
        model.receive(url)
        await model.operation?.value
        model.install()
        await model.operation?.value
        #expect(model.result == .installed)
        #expect(!coordinator.isBusy)
        let target = paths.codexSkillsRoot.appendingPathComponent("old-alias")
        #expect(try Data(contentsOf: target.appendingPathComponent("SKILL.md")) == repository.originalSkillData)
        let link = try FileManager.default.destinationOfSymbolicLink(atPath: target.path)
        #expect(link.hasPrefix(root.path + "/"))
        #expect(!CatalogInstallFilesystem.exists(paths.claudeSkillsRoot))
        #expect(!CatalogInstallFilesystem.exists(paths.agentsSkillsRoot))
        let metadata = SkillInstallProvenanceStore.metadataURL(targetRoot: paths.codexSkillsRoot, targetName: "old-alias")
        let before = try Data(contentsOf: metadata)
        #expect(await model.close())
        let reopened = CatalogInstallModel(service: service, coordinator: coordinator)
        #expect(reopened.phase == .idle)
        reopened.receive(url)
        await reopened.operation?.value
        reopened.install()
        await reopened.operation?.value
        #expect(reopened.result == .alreadyInstalled)
        #expect(try Data(contentsOf: metadata) == before)
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: target.path) == link)
        #expect(await reopened.close())
    }
}

private struct LocalCloneRunner: GitCommandRunning {
    let git: GitCommandRunner
    let repository: URL
    func run(arguments: [String], maximumOutputBytes: Int) async throws -> Data {
        if arguments.first == "clone" {
            #expect(arguments[1] == "https://github.com/owner/repo")
            let destination = arguments[2]
            let data = try await git.run(arguments: ["clone", repository.path, destination], maximumOutputBytes: maximumOutputBytes)
            _ = try await git.run(arguments: ["-C", destination, "config", "remote.origin.url", "https://github.com/owner/repo"], maximumOutputBytes: 1024)
            return data
        }
        return try await git.run(arguments: arguments, maximumOutputBytes: maximumOutputBytes)
    }
}

private final class FlowRecordProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "omgskills.com" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        #expect(request.url?.path == "/api/catalog/install-record")
        #expect(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems == [.init(name: "id", value: "owner/repo:alias")])
        let body = Data("""
        {"version":1,"found":true,"skill":{"id":"owner/repo:alias","name":"example","description":"Fixture",
        "author_handle":"owner","github_url":"https://github.com/owner/repo",
        "install_cmd":"git clone https://github.com/owner/repo ~/.claude/skills/old-alias"}}
        """.utf8)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200,
            httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif
