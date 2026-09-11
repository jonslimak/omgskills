import SwiftUI

struct GroupSnapshotInstallSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: GroupSnapshotInstallModel

    init(
        manifest: GroupManifest,
        route: DeviceGroupManifestRoute,
        credential: StoredDeviceCredential,
        installer: any GroupSnapshotInstalling,
        packageLoader: any GroupSkillPackageLoading,
        updateCoordinator: UpdateInstallCoordinator,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) {
        _model = State(initialValue: GroupSnapshotInstallModel(
            manifest: manifest,
            route: route,
            credential: credential,
            installer: installer,
            packageLoader: packageLoader,
            updateCoordinator: updateCoordinator,
            homeDirectory: homeDirectory
        ))
    }

    var body: some View {
        @Bindable var model = model

        VStack(alignment: .leading, spacing: 16) {
            header
            targetPicker(selection: Binding(
                get: { model.selectedTarget },
                set: { model.selectTarget($0) }
            ))
            installModePicker(selection: $model.installMode)
            itemList
            acknowledgement(isOn: $model.acknowledgesMetadataOnly)
            status
            actions
        }
        .padding(20)
        .frame(
            minWidth: 360,
            idealWidth: 400,
            maxWidth: 480,
            minHeight: 420,
            idealHeight: 560,
            maxHeight: 700
        )
        .interactiveDismissDisabled(model.isOperationActive)
        .task(id: model.selectedTarget) {
            await model.refreshSubscription()
        }
        .onDisappear {
            model.cancelInstall()
        }
    }

    @ViewBuilder
    private func installModePicker(selection: Binding<ManagedSkillInstallMode>) -> some View {
        if model.selectedTarget != nil,
           model.subscriptionPhase == .none,
           model.phase == .ready {
            Picker("Install mode", selection: selection) {
                Text("Install this version").tag(ManagedSkillInstallMode.snapshot)
                Text("Keep updated").tag(ManagedSkillInstallMode.subscribed)
            }
            .pickerStyle(.segmented)
            .accessibilityHint("Choose a fixed version or save it for update checks")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(model.groupName)
                .font(.title2.bold())

            Text("Version \(model.groupRevision)")
                .font(.caption)
                .foregroundStyle(.secondary)

            if let description = model.groupDescription {
                Text(description)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text(itemSummary)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func targetPicker(
        selection: Binding<GroupSnapshotInstallTarget?>
    ) -> some View {
        Picker("Install in", selection: selection) {
            ForEach(GroupSnapshotInstallTarget.allCases) { target in
                Text(target.title).tag(Optional(target))
            }
        }
        .pickerStyle(.segmented)
        .disabled(model.isOperationActive)
        .accessibilityHint("Choose where this group will be installed")
    }

    private var itemList: some View {
        List {
            if let subscription = model.existingSubscription {
                ForEach(subscription.changes) { change in
                    GroupSubscriptionChangeRow(change: change)
                }
            } else {
                ForEach(model.items) { item in
                    GroupSnapshotInstallItemRow(item: item)
                }
            }
        }
        .listStyle(.plain)
        .frame(minHeight: 180)
        .overlay {
            if model.items.isEmpty {
                ContentUnavailableView(
                    "No skills",
                    systemImage: "tray",
                    description: Text("This group has no skills to install.")
                )
            }
        }
        .accessibilityLabel("Skills in \(model.groupName)")
    }

    @ViewBuilder
    private func acknowledgement(isOn: Binding<Bool>) -> some View {
        if model.metadataOnlyCount > 0 {
            Toggle(
                acknowledgementLabel,
                isOn: isOn
            )
            .font(.callout)
            .disabled(model.isOperationActive)
        }
    }

    @ViewBuilder
    private var status: some View {
        switch model.phase {
        case .ready:
            switch model.subscriptionPhase {
            case .checking:
                ProgressView("Checking installed version...")
                    .controlSize(.small)
            case .existing(let diff):
                subscriptionStatus(diff)
            case .failure(let message):
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            case .none where model.installableCount == 0:
                Label("This group has no installable skills.", systemImage: "info.circle")
                    .foregroundStyle(.secondary)
            case .none:
                EmptyView()
            }
        case .installing:
            ProgressView(
                model.installMode == .subscribed
                    ? "Installing and enabling update checks..."
                    : "Installing this version..."
            )
                .controlSize(.small)
        case .cancelling:
            ProgressView("Cancelling and restoring previous skills...")
                .controlSize(.small)
        case .success(let summary):
            Label(successMessage(summary), systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failure(let failure):
            Label(failure.message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
        case .cancelled:
            Label("Installation cancelled. Previous skills remain available.", systemImage: "xmark.circle")
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func subscriptionStatus(_ diff: GroupSubscriptionDiff) -> some View {
        if diff.hasLocalChanges {
            Label(
                "Local changes were found. Review them before replacing this version.",
                systemImage: "exclamationmark.triangle.fill"
            )
            .foregroundStyle(.orange)
        } else if diff.hasUpstreamChanges {
            Label(
                "Changes are available. Applying them will be added in the next step.",
                systemImage: "arrow.triangle.2.circlepath"
            )
            .foregroundStyle(.secondary)
        } else {
            Label("This installed group is up to date.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        }
    }

    private var actions: some View {
        HStack(spacing: 10) {
            leadingAction
            Spacer()
            primaryAction
        }
    }

    @ViewBuilder
    private var leadingAction: some View {
        switch model.phase {
        case .installing:
            Button("Cancel installation") {
                model.cancelInstall()
            }
            .keyboardShortcut(.cancelAction)
        case .cancelling:
            Button("Cancelling...") {}
                .disabled(true)
        case .ready, .success, .failure, .cancelled:
            Button("Close") {
                dismiss()
            }
            .keyboardShortcut(.cancelAction)
        }
    }

    @ViewBuilder
    private var primaryAction: some View {
        switch model.phase {
        case .ready:
            if model.existingSubscription != nil || model.subscriptionPhase == .checking {
                EmptyView()
            } else if case .failure = model.subscriptionPhase {
                Button("Try again") {
                    Task { await model.refreshSubscription() }
                }
                .keyboardShortcut(.defaultAction)
            } else {
                Button(
                    model.installMode == .subscribed
                        ? "Keep updated"
                        : "Install this version"
                ) {
                    model.startInstall()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!model.canInstall)
            }
        case .failure(let failure) where failure.canRetry:
            Button("Try again") {
                model.retryInstall()
            }
            .keyboardShortcut(.defaultAction)
        case .cancelled:
            Button("Try again") {
                model.retryInstall()
            }
            .keyboardShortcut(.defaultAction)
        case .success:
            Button("Done") {
                dismiss()
            }
            .keyboardShortcut(.defaultAction)
        case .installing, .cancelling, .failure:
            EmptyView()
        }
    }

    private var itemSummary: String {
        let available = "\(model.installableCount) available"
        guard model.metadataOnlyCount > 0 else { return available }
        return "\(available), \(model.metadataOnlyCount) unavailable"
    }

    private var acknowledgementLabel: String {
        let noun = model.metadataOnlyCount == 1 ? "skill" : "skills"
        return "Install available skills and skip \(model.metadataOnlyCount) unavailable \(noun)"
    }

    private func successMessage(_ summary: GroupSnapshotInstallSummary) -> String {
        var parts: [String] = []
        if summary.installedCount > 0 {
            parts.append("\(summary.installedCount) installed")
        }
        if summary.updatedCount > 0 {
            parts.append("\(summary.updatedCount) updated")
        }
        if summary.skippedCount > 0 {
            parts.append("\(summary.skippedCount) skipped")
        }
        return parts.isEmpty ? "This version is installed." : parts.joined(separator: ", ").capitalized + "."
    }
}

private struct GroupSubscriptionChangeRow: View {
    let change: GroupSubscriptionChange

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbolName)
                .foregroundStyle(symbolStyle)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(change.name)
                    .font(.body.weight(.medium))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(detailStyle)
            }

            Spacer(minLength: 8)
            Text(statusLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var statusLabel: String {
        switch change.kind {
        case .added: "Added"
        case .updated: change.wasReordered ? "Updated and moved" : "Updated"
        case .removed: "Removed"
        case .reordered: "Moved"
        case .unchanged: "Unchanged"
        }
    }

    private var detail: String {
        guard let localState = change.localState, localState != .clean else {
            return change.isMetadataOnly ? "Metadata only" : "Installed package"
        }
        return switch localState {
        case .clean: "Installed package"
        case .modified: "Modified on this Mac"
        case .missing: "Missing from this Mac"
        case .replaced: "Replaced by another installation"
        case .unreadable: "Could not verify local files"
        }
    }

    private var symbolName: String {
        switch change.kind {
        case .added: "plus.circle"
        case .updated: "arrow.triangle.2.circlepath.circle"
        case .removed: "minus.circle"
        case .reordered: "arrow.up.arrow.down.circle"
        case .unchanged: "checkmark.circle"
        }
    }

    private var symbolStyle: AnyShapeStyle {
        if let localState = change.localState, localState != .clean {
            return AnyShapeStyle(Color.orange)
        }
        return change.kind == .unchanged
            ? AnyShapeStyle(Color.secondary)
            : AnyShapeStyle(Color.accentColor)
    }

    private var detailStyle: AnyShapeStyle {
        if let localState = change.localState, localState != .clean {
            return AnyShapeStyle(Color.orange)
        }
        return AnyShapeStyle(Color.secondary)
    }
}

private struct GroupSnapshotInstallItemRow: View {
    let item: GroupSnapshotInstallItem

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbolName)
                .foregroundStyle(symbolStyle)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(item.name)
                    .font(.body.weight(.medium))

                if let description = item.description {
                    Text(description)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                if let note = item.note {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if case .metadataOnly(let reason) = item.availability {
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 8)

            Text(statusLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var symbolName: String {
        switch item.availability {
        case .installable: "arrow.down.circle"
        case .metadataOnly: "info.circle"
        }
    }

    private var symbolStyle: AnyShapeStyle {
        switch item.availability {
        case .installable: AnyShapeStyle(Color.accentColor)
        case .metadataOnly: AnyShapeStyle(Color.secondary)
        }
    }

    private var statusLabel: String {
        switch item.availability {
        case .installable: "Will install"
        case .metadataOnly: "Unavailable"
        }
    }
}
