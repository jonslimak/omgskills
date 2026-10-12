#if DEBUG || OMGSKILLS_SETUP_TEST
import Foundation
import Testing
@testable import omgskills

@MainActor
struct SetupTestServiceTests {
    private let url = "omgskills-setup-test://review?v=1&id=owner/repo:example&repo=owner/repo&path=example/SKILL.md&agent=codex"

    @Test func factoryChoosesHTTPWithoutCreatingStorageAndRechecksRedirects() throws {
        let configuration = try configuration()
        defer { try? FileManager.default.removeItem(at: configuration.home) }
        let service = try PublicSkillReviewService.setupTest(configuration)
        #expect(service.fetcher is HTTPPublicSkillPackageFetcher)
        #expect(service.paths == configuration.paths)
        #expect(try FileManager.default.contentsOfDirectory(atPath: configuration.home.path).isEmpty)
        try configuration.prepareStorage()
        try FileManager.default.removeItem(at: configuration.stateRoot)
        try FileManager.default.createSymbolicLink(at: configuration.stateRoot, withDestinationURL: configuration.home)
        #expect(throws: PublicSkillReviewError.destinationConflict) { try PublicSkillReviewService.setupTest(configuration) }
    }

    @Test func candidateReviewCancelAndApprovalUseOnlyInjectedHome() async throws {
        let configuration = try configuration()
        defer { try? FileManager.default.removeItem(at: configuration.home) }
        try configuration.prepareStorage()
        let resolver = SetupPackageResolver()
        let service = PublicSkillReviewService(fetcher: resolver,
            installer: ManagedSkillInstaller(managedRoot: configuration.managedRoot, pathAnchor: configuration.home),
            paths: configuration.paths)
        let model = PublicSkillInstallModel(service: service, client: .setupTest)
        model.receive(url.replacingOccurrences(of: "omgskills-setup-test", with: "omgskills-f1"))
        #expect(model.phase == .failure)
        #expect(await resolver.calls == 0)
        model.receive(url)
        model.receive(url)
        await model.operation?.value
        #expect(model.phase == .review)
        #expect(await resolver.calls == 1)
        let destination = configuration.paths.codexSkillsRoot.appendingPathComponent("example")
        #expect(model.review?.destination.path == destination.path)
        #expect(!FileManager.default.fileExists(atPath: configuration.managedRoot.path))
        #expect(!FileManager.default.fileExists(atPath: destination.path))
        await model.cancel()
        model.apply()
        #expect(!FileManager.default.fileExists(atPath: destination.path))
        model.receive(url)
        await model.operation?.value
        model.apply()
        await model.operation?.value
        #expect(model.phase == .success)
        #expect(model.message == "Installed in Codex")
        #expect(try Data(contentsOf: destination.appendingPathComponent("SKILL.md")) == GroupSkillPackageTestSupport.package.entries[0].data)
        #expect(destination.resolvingSymlinksInPath().path.hasPrefix(configuration.managedRoot.path + "/"))
        #expect(!FileManager.default.fileExists(atPath: configuration.paths.agentsSkillsRoot.path))
        #expect(!FileManager.default.fileExists(atPath: configuration.paths.legacyRepoCacheRoot.path))
        let restarted = PublicSkillInstallModel(service: service, client: .setupTest)
        restarted.receive(url)
        await restarted.operation?.value
        #expect(restarted.review?.action == .unchanged)
        await restarted.cancel()
    }

    private func configuration() throws -> SetupTestRuntime.Configuration {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("omgskills-setup-service-\(UUID())", isDirectory: true)
            .resolvingSymlinksInPath().standardizedFileURL
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        return .init(home: home.standardizedFileURL, website: URL(string: "https://omgskills.com/app/")!, updatesEnabled: false)
    }
}

private actor SetupPackageResolver: PublicSkillPackageResolving {
    var calls = 0
    func resolvePackage(_ request: PublicSkillInstallRequest) async throws -> SkillPackage {
        calls += 1
        return GroupSkillPackageTestSupport.package
    }
}
#endif
