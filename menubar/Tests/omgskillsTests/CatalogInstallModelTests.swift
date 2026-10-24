#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import Foundation
import Testing
@testable import omgskills

@MainActor
struct CatalogInstallModelTests {
    @Test(arguments: [CatalogInstallService.Result.installed, .alreadyInstalled, .conflict,
                      .needsGit, .unavailable, .failed("Private error /Users/example/secret")])
    func trackingRecordsOneApprovedOutcomeWithoutPrivateData(_ result: CatalogInstallService.Result) async {
        var events: [ConnectedAppEvent] = []
        let model = CatalogInstallModel(service: FlowStub(installResult: result),
            coordinator: UpdateInstallCoordinator(), track: { events.append($0) })
        model.receive(link())
        model.receive(link())
        await model.operation?.value
        #expect(events == [.install(.requested, agent: .codex)])
        model.install()
        model.install()
        await model.operation?.value
        #expect(events == [.install(.requested, agent: .codex), .install(.approved, agent: .codex),
                           .installResult(result, agent: .codex)])
        model.install()
        #expect(await model.close())
        #expect(events.count == 3)
    }

    @Test func trackingCancellationDoesNotClaimAnInstallOrEmitTwice() async {
        var events: [ConnectedAppEvent] = []
        let model = CatalogInstallModel(service: FlowStub(), coordinator: UpdateInstallCoordinator(),
            track: { events.append($0) })
        model.receive(link())
        await model.operation?.value
        #expect(await model.close())
        #expect(await model.close())
        #expect(events == [.install(.requested, agent: .codex), .install(.cancelled, agent: .codex)])
    }

    @Test func onlySuccessfulInstallationSchedulesOneInventoryReport() async {
        for result: CatalogInstallService.Result in [.installed, .alreadyInstalled, .conflict, .needsGit, .unavailable, .failed("Fixture failure")] {
            let service = FlowStub(installResult: result)
            var reports = 0
            let model = CatalogInstallModel(service: service, coordinator: UpdateInstallCoordinator(), onInstalled: { reports += 1 })
            model.receive(link())
            await model.operation?.value
            #expect(reports == 0)
            model.install()
            model.install()
            await model.operation?.value
            #expect(model.result == result)
            #expect(reports == (result == .installed ? 1 : 0))
            model.install()
            #expect(reports == (result == .installed ? 1 : 0))
        }
    }

    @Test func canceledApprovalNeverSchedulesInventory() async {
        var reports = 0
        let model = CatalogInstallModel(service: FlowStub(), coordinator: UpdateInstallCoordinator(), onInstalled: { reports += 1 })
        model.receive(link())
        await model.operation?.value
        #expect(await model.close())
        model.install()
        #expect(reports == 0)
    }

    @Test(arguments: ["claude", "codex"])
    func confirmationIsReadOnlyAndInstallRequiresOneExplicitApproval(_ agent: String) async throws {
        let service = FlowStub()
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        #expect(model.phase == .idle)
        #expect(await service.fetchCount == 0)
        model.receive(link(agent: agent))
        model.receive(link(agent: agent))
        model.receive(link(agent: agent, id: "another/repo"))
        #expect(!model.notice.isEmpty)
        await model.operation?.value
        #expect(model.phase == .confirm)
        #expect(model.request?.target == (agent == "claude" ? .claude : .codex))
        #expect(model.destination?.lastPathComponent == "old-alias")
        #expect(await service.fetchCount == 1)
        #expect(await service.installCount == 0)
        #expect(coordinator.isBusy)
        model.install()
        model.install()
        await model.operation?.value
        #expect(model.phase == .result)
        #expect(model.result == .installed)
        #expect(model.message == "Installed in \(agent == "claude" ? "Claude" : "Codex").")
        #expect(await service.fetchCount == 2)
        #expect(await service.installCount == 1)
        #expect(!coordinator.isBusy)
    }

    @Test func changedCoordinatesRequireAnotherClick() async throws {
        let service = FlowStub()
        let model = CatalogInstallModel(service: service, coordinator: UpdateInstallCoordinator())
        model.receive(link())
        await model.operation?.value
        await service.setRecord(try record(name: "new-name"))
        model.install()
        await model.operation?.value
        #expect(model.phase == .confirm)
        #expect(model.destination?.lastPathComponent == "new-name")
        #expect(model.message == "Installation information changed. Confirm again.")
        #expect(await service.installCount == 0)
        model.install()
        await model.operation?.value
        #expect(model.result == .installed)
        #expect(await service.installCount == 1)
    }

    @Test func closingConfirmationDiscardsAllConsent() async {
        let service = FlowStub()
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        model.receive(link())
        await model.operation?.value
        #expect(await model.close())
        model.install()
        #expect(await service.installCount == 0)
        #expect(model.phase == .idle)
        #expect(model.record == nil)
        #expect(model.request == nil)
        #expect(model.destination == nil)
        #expect(!coordinator.isBusy)
        let restarted = CatalogInstallModel(service: service, coordinator: coordinator)
        #expect(restarted.phase == .idle)
        #expect(await service.fetchCount == 1)
    }

    @Test func lateLoadingResponseCannotRestoreClosedRequest() async {
        let service = FlowStub()
        await service.holdNextFetch()
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        model.receive(link())
        await service.waitForFetch()
        let close = Task { await model.close() }
        // Yield until the close has invalidated the pending request.
        while model.phase != .cancelling { await Task.yield() }
        model.receive(link(id: "another/repo"))
        await service.resumeFetch()
        #expect(await close.value)
        #expect(model.phase == .idle)
        #expect(model.record == nil)
        #expect(await service.installCount == 0)
        #expect(!coordinator.isBusy)
        model.receive(link())
        await model.operation?.value
        #expect(model.phase == .confirm)
        _ = await model.close()
    }

    @Test func recheckCanBeCancelledWithoutStartingAnInstall() async {
        let service = FlowStub()
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        model.receive(link())
        await model.operation?.value
        await service.holdNextFetch()
        model.install()
        await service.waitForFetch()
        #expect(model.phase == .rechecking)
        let close = Task { await model.close() }
        while model.phase != .cancelling { await Task.yield() }
        await service.resumeFetch()
        #expect(await close.value)
        #expect(await service.installCount == 0)
        #expect(model.phase == .idle)
        #expect(!coordinator.isBusy)
    }

    @Test func installBlocksCloseQuitDuplicatesAndAppReplacement() async {
        let service = FlowStub()
        await service.holdInstall()
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        model.receive(link())
        await model.operation?.value
        model.install()
        await service.waitForInstall()
        #expect(model.phase == .installing)
        #expect(!model.canClose)
        #expect(!(await model.close()))
        model.install()
        model.receive(link(id: "another/repo"))
        #expect(model.request?.catalogID == "owner/repo:alias")
        var replacements = 0
        coordinator.requestInstall { replacements += 1 }
        #expect(replacements == 0)
        #expect(coordinator.hasPendingInstall)
        await service.resumeInstall()
        await model.operation?.value
        #expect(model.result == .installed)
        #expect(replacements == 1)
        #expect(coordinator.isAppReplacementActive)
        model.receive(link())
        #expect(await service.fetchCount == 2)
        #expect(!model.notice.isEmpty)
    }

    @Test func pendingAppReplacementPreventsNewRequestsAndRecheckWrites() async {
        let service = FlowStub()
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        model.receive(link())
        await model.operation?.value
        await service.holdNextFetch()
        model.install()
        await service.waitForFetch()
        var replacements = 0
        coordinator.requestInstall { replacements += 1 }
        #expect(replacements == 0)
        await service.resumeFetch()
        await model.operation?.value
        #expect(await service.installCount == 0)
        #expect(model.hasFailure)
        #expect(replacements == 1)
        let another = CatalogInstallModel(service: service, coordinator: coordinator)
        another.receive(link())
        #expect(another.phase == .idle)
        #expect(await service.fetchCount == 2)
    }

    @Test func pendingAppUpdateIsReleasedWhenConfirmationCloses() async {
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: FlowStub(), coordinator: coordinator)
        model.receive(link())
        await model.operation?.value
        var replacements = 0
        coordinator.requestInstall { replacements += 1 }
        #expect(replacements == 0)
        #expect(await model.close())
        #expect(replacements == 1)
        #expect(!coordinator.isBusy)
    }

    @Test(arguments: [CatalogInstallService.Result.alreadyInstalled, .conflict, .needsGit, .unavailable, .failed("Fixture failed")])
    func resultsAreHonestAndReleaseTheActivity(_ result: CatalogInstallService.Result) async {
        let service = FlowStub(installResult: result)
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        model.receive(link())
        await model.operation?.value
        model.install()
        await model.operation?.value
        #expect(model.result == result)
        #expect(model.phase == .result)
        #expect(model.hasFailure == (result != .alreadyInstalled))
        #expect(!coordinator.isBusy)
        #expect(!model.message.contains("Installed in"))
    }

    @Test func missingWrongAndInvalidRecordsCannotStartInstallation() async throws {
        let service = FlowStub()
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        await service.setRecord(nil)
        model.receive(link())
        await model.operation?.value
        #expect(model.hasFailure)
        #expect(!coordinator.isBusy)
        await service.setRecord(try record(id: "another/repo"))
        model.receive(link())
        await model.operation?.value
        #expect(model.hasFailure)
        await service.setRecord(try record(extra: ",\"repo_commit_sha\":\"broken\""))
        model.receive(link())
        await model.operation?.value
        #expect(model.hasFailure)
        #expect(await service.installCount == 0)
    }

    @Test func recordDisappearingAtRecheckCannotInstallOldSnapshot() async {
        let service = FlowStub()
        let model = CatalogInstallModel(service: service, coordinator: UpdateInstallCoordinator())
        model.receive(link())
        await model.operation?.value
        await service.setRecord(nil)
        model.install()
        await model.operation?.value
        #expect(model.hasFailure)
        #expect(await service.installCount == 0)
    }

    @Test(arguments: [false, true])
    func lookupFailureReleasesActivityAndNeverInstalls(_ atRecheck: Bool) async {
        let service = FlowStub()
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator)
        if atRecheck {
            model.receive(link())
            await model.operation?.value
        }
        await service.setFetchFailure()
        if atRecheck { model.install() } else { model.receive(link()) }
        await model.operation?.value
        #expect(model.hasFailure)
        #expect(model.phase == .result)
        #expect(!coordinator.isBusy)
        #expect(await service.installCount == 0)
    }

    @Test func oldReviewAndProductionLinksAreRefused() async {
        let service = FlowStub()
        let model = CatalogInstallModel(service: service, coordinator: UpdateInstallCoordinator())
        for url in ["omgskills-f1://review?v=1&id=x&agent=codex", "omgskills://catalog-install?v=1&id=x&agent=codex"] {
            model.receive(URL(string: url)!)
            #expect(model.hasFailure)
        }
        #expect(await service.fetchCount == 0)
        #expect(await service.installCount == 0)
    }

    @Test func productClientRequiresFreshApprovalAndRefusesTestHandlers() async {
        let service = FlowStub()
        let model = CatalogInstallModel(service: service, coordinator: UpdateInstallCoordinator(), client: .product)
        model.receive(link())
        #expect(model.hasFailure)
        #expect(await service.fetchCount == 0)
        model.receive(productLink())
        await model.operation?.value
        #expect(model.phase == .confirm)
        #expect(await service.installCount == 0)
        #expect(await model.close())
        model.install()
        #expect(await service.installCount == 0)
    }

    @Test func candidateUpdaterBlocksRequestsAndCannotInterruptAnySkillPhase() async {
        let service = FlowStub()
        await service.holdNextFetch()
        await service.holdInstall()
        let model = CatalogInstallModel(service: service, coordinator: UpdateInstallCoordinator(), client: .product)
        var checks = 0
        let updater = CatalogCandidateUpdater(model: model) { checks += 1 }
        #expect(checks == 0)
        model.receive(productLink())
        await service.waitForFetch()
        updater.check()
        #expect(checks == 0)
        await service.resumeFetch()
        await model.operation?.value
        updater.check()
        #expect(checks == 0)
        model.install()
        await service.waitForInstall()
        updater.check()
        #expect(checks == 0)
        #expect(!(await model.close()))
        await service.resumeInstall()
        await model.operation?.value
        updater.check()
        updater.check()
        #expect(checks == 1)
        #expect(updater.permitsUpdate)
        #expect(model.request == nil)
        model.receive(productLink())
        model.install()
        #expect(await service.fetchCount == 2)
        #expect(await service.installCount == 1)
        updater.finish(failed: false)
        #expect(updater.canCheck)
        #expect(model.request == nil)
        model.receive(productLink())
        await model.operation?.value
        #expect(model.phase == .confirm)
        #expect(await service.installCount == 1)
        _ = await model.close()
    }

    @Test func candidateUpdateFailureUnlocksButReplacementStaysLocked() async {
        let service = FlowStub()
        let coordinator = UpdateInstallCoordinator()
        let model = CatalogInstallModel(service: service, coordinator: coordinator, client: .product)
        let token = coordinator.beginActivity(.portalConnection)
        var checks = 0
        let updater = CatalogCandidateUpdater(model: model) { checks += 1 }
        updater.check()
        #expect(checks == 0)
        token.finish()
        let failure = CatalogCandidateUpdater(model: model) { throw URLError(.notConnectedToInternet) }
        failure.check()
        #expect(failure.canCheck)
        #expect(!model.appUpdateActive)
        updater.installationStarted()
        #expect(updater.phase == .idle)
        updater.check()
        updater.installationStarted()
        updater.finish(failed: true)
        updater.finish(failed: false)
        _ = await model.close()
        updater.check()
        model.receive(productLink())
        model.install()
        #expect(updater.phase == .restartRequired)
        #expect(model.appUpdateActive)
        #expect(checks == 1)
        #expect(await service.fetchCount == 0)
        #expect(await service.installCount == 0)
        let restarted = CatalogInstallModel(service: service, coordinator: UpdateInstallCoordinator(), client: .product)
        #expect(restarted.request == nil)
        #expect(!restarted.appUpdateActive)
        restarted.install()
        #expect(await service.installCount == 0)
    }

    private func productLink() -> URL {
        URL(string: "omgskills://catalog-install?v=1&id=owner%2Frepo%3Aalias&agent=codex")!
    }

    private func link(agent: String = "codex", id: String = "owner/repo:alias") -> URL {
        var url = URLComponents(string: "omgskills-f1://catalog-install")!
        url.queryItems = [.init(name: "v", value: "1"), .init(name: "id", value: id), .init(name: "agent", value: agent)]
        return url.url!
    }
}

private actor FlowStub: CatalogInstallFlowServing {
    var fetchCount = 0
    var installCount = 0
    private var current: CatalogInstallRecord? = try! record()
    private let installResult: CatalogInstallService.Result
    private var holdFetch = false
    private var holdApplying = false
    private var failFetch = false
    private var fetchWait: CheckedContinuation<Void, Never>?
    private var applyWait: CheckedContinuation<Void, Never>?
    private var fetchStarted: CheckedContinuation<Void, Never>?
    private var applyStarted: CheckedContinuation<Void, Never>?
    init(installResult: CatalogInstallService.Result = .installed) { self.installResult = installResult }
    func setRecord(_ record: CatalogInstallRecord?) { current = record }
    func holdNextFetch() { holdFetch = true }
    func holdInstall() { holdApplying = true }
    func setFetchFailure() { failFetch = true }
    func fetch(id: String) async throws -> CatalogInstallRecord? {
        fetchCount += 1
        if failFetch { throw URLError(.timedOut) }
        let captured = current
        if holdFetch {
            holdFetch = false
            await withCheckedContinuation { fetchWait = $0; fetchStarted?.resume(); fetchStarted = nil }
        }
        return captured
    }
    func destination(for record: CatalogInstallRecord, target: SkillInstaller.Target) async throws -> URL {
        guard record.skill.pinnedInstallMetadataState != .invalid else { throw CatalogSkillInstaller.InstallError.invalidPinnedMetadata }
        return URL(fileURLWithPath: "/private/tmp/catalog-model/home/\(target == .claude ? ".claude" : ".codex")/skills")
            .appendingPathComponent(try SkillInstaller.installationSpec(for: record.skill).targetName)
    }
    func install(_ record: CatalogInstallRecord, target: SkillInstaller.Target) async -> CatalogInstallService.Result {
        installCount += 1
        if holdApplying {
            await withCheckedContinuation { applyWait = $0; applyStarted?.resume(); applyStarted = nil }
        }
        return installResult
    }
    func waitForFetch() async { if fetchWait == nil { await withCheckedContinuation { fetchStarted = $0 } } }
    func waitForInstall() async { if applyWait == nil { await withCheckedContinuation { applyStarted = $0 } } }
    func resumeFetch() { fetchWait?.resume(); fetchWait = nil }
    func resumeInstall() { applyWait?.resume(); applyWait = nil }
}

private func record(id: String = "owner/repo:alias", name: String = "old-alias", extra: String = "") throws -> CatalogInstallRecord {
    try JSONDecoder().decode(CatalogInstallRecord.self, from: Data("""
    {"id":"\(id)","name":"design","description":"Fixture skill","author_handle":"owner",
    "github_url":"https://github.com/owner/repo","install_cmd":"git clone https://github.com/owner/repo ~/.claude/skills/\(name)"\(extra)}
    """.utf8))
}
#endif
