import HandoffCore
import SwiftUI

public struct InstallContent: View {
    let model: InstallModel
    let sourceLabel: String
    let versionLabel: @Sendable (String) -> String
    let testDestination: Bool

    public init(model: InstallModel, sourceLabel: String = "Public package", testDestination: Bool = false,
                versionLabel: @escaping @Sendable (String) -> String = { $0 }) {
        self.model = model
        self.sourceLabel = sourceLabel
        self.testDestination = testDestination
        self.versionLabel = versionLabel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("OMGSkills").font(.headline)
                Spacer()
                Text(sourceLabel)
                    .foregroundStyle(.secondary)
            }
            if model.canSelectAgent {
                Picker("Install in", selection: Binding(get: { model.selectedAgent }, set: { model.selectAgent($0) })) {
                    ForEach(InstallAgent.allCases) { agent in Text(agent.title).tag(agent) }
                }
                .pickerStyle(.segmented)
                .disabled(model.isApplying)
            }
            if let review = model.review {
                Text(title(review.action)).font(.title2)
                Text(review.skillID).textSelection(.enabled)
                VStack(alignment: .leading, spacing: 6) {
                    Text(testDestination ? "Test destination" : "Destination").font(.caption).foregroundStyle(.secondary)
                    Text(review.destination).font(.caption).textSelection(.enabled)
                    if let from = review.fromCommit { Text("From: \(versionLabel(from))").font(.system(.caption, design: .monospaced)) }
                    Text("To: \(versionLabel(review.toCommit))").font(.system(.caption, design: .monospaced))
                }
                Divider()
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(review.changes) { change in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(change.path).font(.headline)
                                    Spacer()
                                    Text(change.kind).foregroundStyle(.secondary)
                                }
                                if change.oldMode != change.newMode {
                                    Text("Mode: \(change.oldMode ?? "none") -> \(change.newMode ?? "none")")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                ScrollView(.horizontal) {
                                    Text(change.diff).font(.system(.caption, design: .monospaced))
                                        .textSelection(.enabled).fixedSize(horizontal: true, vertical: true)
                                }
                                Divider()
                            }
                        }
                        if review.changes.isEmpty {
                            Text(review.action == .unchanged ? "Files and version are unchanged." : "Files are unchanged; the version record will change.")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } else if model.isLoading {
                ProgressView("Preparing verified review...")
            } else if let message = model.message {
                Label(message, systemImage: "checkmark.circle").foregroundStyle(.green)
            } else if model.errorMessage == nil {
                Text("No package selected.").foregroundStyle(.secondary)
            }
            if let error = model.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
            }
            if let notice = model.noticeMessage {
                Label(notice, systemImage: "info.circle").foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            HStack {
                Button("Close review", role: .cancel) { model.cancel() }
                    .keyboardShortcut(.cancelAction).disabled(model.isApplying)
                if model.canRestore {
                    Button("Review previous version", systemImage: "arrow.uturn.backward") { model.restore() }
                        .disabled(model.isApplying || model.isLoading)
                }
                Spacer()
                if model.isApplying { ProgressView().controlSize(.small) }
                if let review = model.review, review.action != .unchanged {
                    Button(title(review.action)) { model.apply() }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.isApplying || model.isLoading)
                }
            }
        }
        .padding(24)
        .frame(minWidth: 700, idealWidth: 760, minHeight: 600, idealHeight: 700)
    }

    private func title(_ action: InstallReview.Action) -> String {
        switch action {
        case .install: testDestination ? "Install in test folder" : "Install in \(model.selectedAgent.title)"
        case .update: "Apply update"
        case .restore: "Restore this version"
        case .unchanged: "Already installed"
        }
    }

}
