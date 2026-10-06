import HandoffCore
import SwiftUI

struct InstallContent: View {
    let model: InstallModel
    let fixtureMode: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("OMGSkills").font(.headline)
                Spacer()
                Text(fixtureMode ? "Local fixtures" : "Public package").foregroundStyle(.secondary)
            }
            if let review = model.review {
                Text(title(review.action)).font(.title2)
                Text(review.skillID).textSelection(.enabled)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Test destination").font(.caption).foregroundStyle(.secondary)
                    Text(review.destination).font(.caption).textSelection(.enabled)
                    if let from = review.fromCommit { Text("From: \(from)").font(.system(.caption, design: .monospaced)) }
                    Text("To: \(review.toCommit)").font(.system(.caption, design: .monospaced))
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
        case .install: "Install in test folder"
        case .update: "Apply update"
        case .restore: "Restore this version"
        case .unchanged: "Already installed"
        }
    }
}
