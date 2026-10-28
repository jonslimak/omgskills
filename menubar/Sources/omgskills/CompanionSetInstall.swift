#if DEBUG || OMGSKILLS_CATALOG_CANDIDATE
import SwiftUI

/// Resolves catalog Set items one record at a time, so the companion never downloads the full catalog.
struct CatalogRecordRepositoryResolver: CatalogSkillRepositoryResolving {
    let records: CatalogInstallRecordClient

    func repositorySlug(for catalogSkillID: String) async throws -> String {
        let record: CatalogInstallRecord?
        do {
            record = try await records.fetch(id: catalogSkillID)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw GroupSkillPackageLoaderError.temporarilyUnavailable(retryAfter: nil)
        }
        guard let record else { throw GroupSkillPackageLoaderError.catalogSkillUnavailable(catalogSkillID) }
        guard let repository = CatalogSkillPackageIndex.githubRepository(from: record.githubURL),
              CatalogSkillID.repositorySlug(from: catalogSkillID)?.caseInsensitiveCompare(repository) == .orderedSame
        else { throw GroupSkillPackageLoaderError.invalidCatalogRepository(catalogSkillID) }
        return repository
    }
}

/// Opens `omgskills://group` links in the companion panel, behind the build and remote Skill Groups gates.
@MainActor
@Observable
final class CompanionSetInstallController {
    let flow: GroupInstallFlowModel
    private(set) var install: GroupSnapshotInstallModel?
    var onInstalled: () -> Void = {}

    @ObservationIgnored private let availability: SkillGroupsFeatureAvailability
    @ObservationIgnored private let installer: any GroupSnapshotInstalling
    @ObservationIgnored private let packageLoader: any GroupSkillPackageLoading
    @ObservationIgnored private let coordinator: UpdateInstallCoordinator
    @ObservationIgnored private let home: URL
    @ObservationIgnored private var pendingRoute: DeviceGroupManifestRoute?

    init(flow: GroupInstallFlowModel, availability: SkillGroupsFeatureAvailability,
         installer: any GroupSnapshotInstalling, packageLoader: any GroupSkillPackageLoading,
         coordinator: UpdateInstallCoordinator, home: URL) {
        self.flow = flow
        self.availability = availability
        self.installer = installer
        self.packageLoader = packageLoader
        self.coordinator = coordinator
        self.home = home
    }

    var isActive: Bool { flow.isPresented }
    var canClose: Bool { install?.canDismiss ?? true }

    /// Returns true for any Set link, so it never reaches the single-skill installer.
    func receive(_ url: URL) -> Bool {
        guard let route = GroupInstallDeepLink.route(from: url) else { return false }
        switch availability.deepLinkDisposition {
        case .handle: open(route)
        case .queueUntilResolved: pendingRoute = route
        case .discard: break
        }
        return true
    }

    func refreshAvailability() async {
        let enabled = await availability.refresh()
        if enabled, let route = pendingRoute {
            pendingRoute = nil
            open(route)
        } else if !enabled {
            pendingRoute = nil
            close()
        }
    }

    func open(_ route: DeviceGroupManifestRoute) {
        guard canClose else { return }
        install = nil
        prepareInstall(after: flow.open(route))
    }

    func retryLoad() {
        install = nil
        guard let task = flow.retry() else { return }
        prepareInstall(after: task)
    }

    func startInstall() { reportSuccess(of: install?.startInstall()) }
    func startUpdate() { reportSuccess(of: install?.startSubscriptionUpdate()) }
    func retryInstall() { reportSuccess(of: install?.retryInstall()) }

    func close() {
        guard canClose else { return }
        flow.dismiss()
        install = nil
    }

    private func prepareInstall(after load: Task<Void, Never>) {
        Task { [weak self] in
            await load.value
            guard let self, flow.phase == .ready, let context = flow.presentationContext else { return }
            install = GroupSnapshotInstallModel(manifest: context.manifest, route: context.route,
                credential: context.credential, installer: installer, packageLoader: packageLoader,
                updateCoordinator: coordinator, homeDirectory: home)
        }
    }

    private func reportSuccess(of operation: Task<Void, Never>?) {
        guard let operation else { return }
        Task { [weak self] in
            await operation.value
            guard let self, case .success = install?.phase else { return }
            onInstalled()
        }
    }
}

struct CompanionSetInstallView: View {
    let controller: CompanionSetInstallController
    let reconnect: () -> Void
    static let listLimit = 8

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch controller.flow.phase {
            case .idle, .loading:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading Set...")
                }
                closeButton("Cancel")
            case .failure(let failure):
                loadFailure(failure)
            case .ready:
                if let install = controller.install {
                    SetInstallContent(model: install, controller: controller, reconnect: reconnect)
                } else {
                    ProgressView().controlSize(.small)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func loadFailure(_ failure: GroupInstallFlowFailure) -> some View {
        switch failure.kind {
        case .reconnectRequired:
            Text("Connect this Mac to install Sets.").font(.callout)
            Button(action: reconnect) { Text("Connect account").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
        case .contentReadRequired:
            Text("Reconnect to allow Set downloads.").font(.callout)
            Button(action: reconnect) { Text("Reconnect").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
        case .unavailable:
            Text("This Set isn't available to you.").font(.callout)
        case .temporarilyUnavailable:
            Text(failure.message).font(.callout).foregroundStyle(.secondary)
            Button { controller.retryLoad() } label: { Text("Try again").frame(maxWidth: .infinity) }
        }
        closeButton("Close")
    }

    private func closeButton(_ title: String) -> some View {
        Button { controller.close() } label: { Text(title).frame(maxWidth: .infinity) }
            .keyboardShortcut(.cancelAction)
    }
}

private struct SetInstallContent: View {
    @Bindable var model: GroupSnapshotInstallModel
    let controller: CompanionSetInstallController
    let reconnect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(model.groupName).font(.headline).textSelection(.enabled)
            Text("Set version \(model.groupRevision)").font(.caption).foregroundStyle(.secondary)
        }
        skillList
        if model.installableCount == 0 {
            Text("This Set has no skills you can install.").font(.callout)
        } else if model.phase == .ready {
            Picker("Install in", selection: Binding(get: { model.selectedTarget }, set: { model.selectTarget($0) })) {
                Text("Choose...").tag(GroupSnapshotInstallTarget?.none)
                ForEach(GroupSnapshotInstallTarget.allCases) { Text($0.title).tag(Optional($0)) }
            }.task(id: model.selectedTarget) { await model.refreshSubscription() }
            readyStatus
        }
        phaseStatus
        actions
    }

    private var skillList: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(model.items.count) \(model.items.count == 1 ? "skill" : "skills")").font(.caption)
                .foregroundStyle(.secondary)
            ForEach(model.items.prefix(CompanionSetInstallView.listLimit)) { item in
                HStack(spacing: 4) {
                    Text(item.name).lineLimit(1).truncationMode(.middle)
                    if case .metadataOnly = item.availability {
                        Text("view only").font(.caption2).foregroundStyle(.secondary)
                    }
                }.font(.callout).accessibilityElement(children: .combine)
            }
            if model.items.count > CompanionSetInstallView.listLimit {
                Text("+\(model.items.count - CompanionSetInstallView.listLimit) more").font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var readyStatus: some View {
        switch model.subscriptionPhase {
        case .none where model.selectedTarget != nil:
            Picker("Mode", selection: $model.installMode) {
                Text("This version").tag(ManagedSkillInstallMode.snapshot)
                Text("Keep updated").tag(ManagedSkillInstallMode.subscribed)
            }.pickerStyle(.segmented).labelsHidden()
                .help("Keep updated shows changes when you open this Set again and asks before applying them.")
            if model.metadataOnlyCount > 0 {
                Toggle("Skip \(model.metadataOnlyCount) view-only", isOn: $model.acknowledgesMetadataOnly)
                    .font(.callout)
            }
        case .none:
            EmptyView()
        case .checking:
            HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Checking...").font(.callout) }
        case .existing(let diff):
            if diff.hasBlockingLocalConflicts {
                Text("Local edits block this update.").font(.callout).foregroundStyle(.orange)
            } else if diff.hasUpstreamChanges {
                Text("Update available: \(Self.changeSummary(diff)).").font(.callout)
            } else {
                Label("Up to date (version \(diff.installedRevision)).", systemImage: "checkmark")
                    .font(.callout).foregroundStyle(.green)
            }
        case .failure(let message):
            Text(message).font(.callout).foregroundStyle(.red)
        }
    }

    @ViewBuilder private var phaseStatus: some View {
        switch model.phase {
        case .ready:
            EmptyView()
        case .installing:
            HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Installing...").font(.callout) }
        case .cancelling:
            HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Cancelling...").font(.callout) }
        case .success(let summary):
            Label(Self.successMessage(summary, target: model.selectedTarget), systemImage: "checkmark")
                .font(.callout).foregroundStyle(.green)
        case .failure(let failure):
            Text(failure.message).font(.callout).foregroundStyle(.red).textSelection(.enabled)
        case .cancelled:
            Text("Cancelled. Your skills are unchanged.").font(.callout).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var actions: some View {
        VStack(spacing: 8) {
            switch model.phase {
            case .ready:
                if let diff = model.existingSubscription {
                    if diff.hasUpstreamChanges {
                        Button { controller.startUpdate() } label: { Text("Apply update").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent).disabled(!model.canApplySubscriptionUpdate)
                    }
                } else if model.installableCount > 0 {
                    Button { controller.startInstall() } label: { Text("Install").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(!model.canInstall)
                }
                closeButton(model.existingSubscription?.hasUpstreamChanges == true ? "Not now" : "Close")
            case .installing:
                Button { model.cancelInstall() } label: { Text("Cancel").frame(maxWidth: .infinity) }
            case .cancelling:
                Button {} label: { Text("Cancelling...").frame(maxWidth: .infinity) }.disabled(true)
            case .success:
                Button { controller.close() } label: { Text("Done").frame(maxWidth: .infinity) }
                    .keyboardShortcut(.defaultAction)
            case .failure(let failure):
                if failure.kind == .reconnectRequired || failure.kind == .contentReadRequired {
                    Button(action: reconnect) { Text("Reconnect").frame(maxWidth: .infinity) }
                } else if failure.canRetry {
                    Button { controller.retryInstall() } label: { Text("Try again").frame(maxWidth: .infinity) }
                }
                closeButton("Close")
            case .cancelled:
                Button { controller.retryInstall() } label: { Text("Try again").frame(maxWidth: .infinity) }
                closeButton("Close")
            }
        }
    }

    private func closeButton(_ title: String) -> some View {
        Button { controller.close() } label: { Text(title).frame(maxWidth: .infinity) }
            .keyboardShortcut(.cancelAction)
    }

    static func changeSummary(_ diff: GroupSubscriptionDiff) -> String {
        let added = diff.changes.count { $0.packageAction == .install }
        let changed = diff.changes.count { $0.packageAction == .update || $0.packageAction == .rename }
        let removed = diff.changes.count { $0.packageAction == .remove }
        var parts: [String] = []
        if added > 0 { parts.append("\(added) added") }
        if changed > 0 { parts.append("\(changed) changed") }
        if removed > 0 { parts.append("\(removed) removed") }
        return parts.isEmpty ? "new Set version" : parts.joined(separator: ", ")
    }

    static func successMessage(_ summary: GroupSnapshotInstallSummary, target: GroupSnapshotInstallTarget?) -> String {
        var parts: [String] = []
        if summary.installedCount > 0 { parts.append("\(summary.installedCount) installed") }
        if summary.updatedCount > 0 { parts.append("\(summary.updatedCount) updated") }
        if summary.removedCount > 0 { parts.append("\(summary.removedCount) removed") }
        if summary.alreadyInstalledCount > 0 { parts.append("\(summary.alreadyInstalledCount) already installed") }
        if summary.skippedCount > 0 { parts.append("\(summary.skippedCount) view only") }
        let place = target.map { " in \($0.title)" } ?? ""
        return parts.isEmpty ? "Up to date\(place)." : parts.joined(separator: ", ").capitalized + place + "."
    }
}
#endif
