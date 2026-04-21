import SwiftUI
import AppKit

enum Source: String, CaseIterable, Identifiable {
    case installed = "Installed"
    case available = "Discover"
    var id: String { rawValue }
}

enum SortKey: String, CaseIterable, Identifiable {
    case stars
    case lastUpdated
    case firstSeen
    case name

    var id: String { rawValue }

    var label: String {
        switch self {
        case .stars: return "Stars"
        case .lastUpdated: return "Recently Updated"
        case .firstSeen: return "Recently Added"
        case .name: return "Name"
        }
    }

    var icon: String {
        switch self {
        case .stars: return "star"
        case .lastUpdated: return "clock.arrow.circlepath"
        case .firstSeen: return "sparkles"
        case .name: return "textformat"
        }
    }
}

struct ContentView: View {
    @StateObject private var store = SkillsStore()
    @State private var query = ""
    @State private var selectedId: String?
    @State private var keyMonitor: Any?
    @State private var sortKey: SortKey = .stars
    @State private var source: Source = .available
    @State private var showDetail = false
    @State private var readmeHeight: CGFloat = 200
    @FocusState private var searchFocused: Bool

    private var baseSkills: [Skill] {
        source == .installed ? store.installedSkills : store.availableSkills
    }

    private var results: [Skill] {
        let searched = store.search(query: query, in: baseSkills, usingIndex: source == .available)
        switch sortKey {
        case .stars:
            // If FTS returned ranked results, preserve that order for available skills
            if source == .available && !query.isEmpty { return searched }
            return source == .available
                ? searched
                : searched.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        case .lastUpdated: return searched.sorted { $0.lastUpdated > $1.lastUpdated }
        case .firstSeen:   return searched.sorted { $0.firstSeen > $1.firstSeen }
        case .name:        return searched.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        }
    }

    private var selectedSkill: Skill? {
        guard let id = selectedId else { return nil }
        return results.first { $0.id == id }
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            searchField
            Divider()
            masterDetail
        }
        .frame(width: showDetail ? 750 : 400, height: 855)
        .onChange(of: showDetail) { _, newValue in
            NotificationCenter.default.post(
                name: .detailToggled,
                object: nil,
                userInfo: ["showDetail": newValue]
            )
        }
        .background(.background)
        .onAppear {
            if selectedId == nil { selectedId = results.first?.id }
            addKeyMonitor()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                searchFocused = true
            }
        }
        .onDisappear { removeKeyMonitor() }
        .onReceive(NotificationCenter.default.publisher(for: .popoverDidOpen)) { _ in
            store.refresh()
            query = ""
            showDetail = false
            selectedId = results.first?.id
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                searchFocused = true
            }
        }
        .onChange(of: query)    { _, _ in selectedId = results.first?.id }
        .onChange(of: sortKey)  { _, _ in selectedId = results.first?.id }
        .onChange(of: source)   { _, _ in
            searchFocused = true
        }
    }

    // MARK: - Header

    private var toolbar: some View {
        HStack(spacing: 8) {
            Menu {
                ForEach(SortKey.allCases) { key in
                    Button {
                        sortKey = key
                    } label: {
                        Label(key.label, systemImage: key.icon)
                    }
                }
            } label: {
                Image(systemName: sortKey.icon)
                    .font(.system(size: 9))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .controlSize(.small)
            .fixedSize()
            .tint(.secondary)
            .help("Sort: \(sortKey.label)")

            Spacer()

            HStack(spacing: 2) {
                ForEach(Source.allCases) { s in
                    Button { source = s } label: {
                        Image(systemName: s == .installed ? "laptopcomputer" : "globe")
                            .font(.system(size: 11))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 4)
                            .background(source == s ? Color.primary.opacity(0.1) : Color.clear)
                            .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(source == s ? AnyShapeStyle(.primary) : AnyShapeStyle(.tertiary))
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 6)
        .padding(.bottom, 6)
    }

    private var searchField: some View {
        TextField(source == .available ? "Search for skills on Github..." : "Search your device...", text: $query)
            .textFieldStyle(.plain)
            .font(.title3)
            .focused($searchFocused)
            .padding(.horizontal, 14)
            .padding(.top, 8)
            .padding(.bottom, 12)
    }

    // MARK: - Master-Detail

    @ViewBuilder
    private var masterDetail: some View {
        if let err = store.loadError, source == .available {
            errorView(err)
        } else if results.isEmpty {
            emptyView
        } else if showDetail {
            HStack(spacing: 0) {
                skillsList
                    .frame(width: 320)
                Divider()
                detailPane
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            skillsList
        }
    }

    private func errorView(_ msg: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(.red)
            Text(msg)
                .font(.callout)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: 8) {
            Image(systemName: source == .installed ? "tray" : "magnifyingglass")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(emptyMessage)
                .font(.callout)
                .foregroundStyle(.secondary)
            if source == .installed && baseSkills.isEmpty {
                Text("Install a skill via `git clone … ~/.claude/skills/…`")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else if source == .available && baseSkills.isEmpty {
                Text("Run `npm run scrape` in `index/`, then rebuild.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyMessage: String {
        if baseSkills.isEmpty {
            return source == .installed ? "No skills installed" : "No skills indexed yet"
        }
        return "No matches"
    }

    // MARK: - List

    private var skillsList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(results) { skill in
                        SkillRow(skill: skill, selected: skill.id == selectedId, source: source)
                            .id(skill.id)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedId = skill.id
                                withAnimation(.easeInOut(duration: 0.15)) {
                                    showDetail = true
                                }
                            }
                    }
                }
                .padding(.vertical, 4)
            }
            .onChange(of: selectedId) { _, newId in
                readmeHeight = 200
                if let newId {
                    withAnimation(.easeOut(duration: 0.08)) {
                        proxy.scrollTo(newId, anchor: .center)
                    }
                }
            }
        }
    }

    // MARK: - Detail Pane

    @ViewBuilder
    private var detailPane: some View {
        if let skill = selectedSkill {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Name + author
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        VStack(alignment: .leading, spacing: 4) {
                            if !skill.githubUrl.isEmpty, let url = URL(string: skill.githubUrl) {
                                Link(skill.name, destination: url)
                                    .font(.title2)
                                    .fontWeight(.bold)
                            } else {
                                Text(skill.name)
                                    .font(.title2)
                                    .fontWeight(.bold)
                            }
                            if !skill.authorHandle.isEmpty {
                                Text("by @\(skill.authorHandle)")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Button("Close", systemImage: "xmark") {
                            withAnimation(.easeInOut(duration: 0.15)) { showDetail = false }
                        }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                        .help("Close")
                    }

                    // Tags
                    if !skill.tags.isEmpty {
                        FlowLayout(spacing: 6) {
                            ForEach(skill.tags, id: \.self) { tag in
                                Text(tag)
                                    .font(.system(size: 9))
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(.quaternary.opacity(0.5)))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    // Stats
                    if source == .available {
                        HStack(spacing: 16) {
                            Label("\(skill.stars)", systemImage: "star")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                            Label(formatDate(skill.lastUpdated), systemImage: "clock")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    } else if let origin = skill.origin {
                        HStack(spacing: 8) {
                            Text(origin)
                                .font(.caption)
                                .fontWeight(.medium)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Capsule().fill(originColor(origin).opacity(0.18)))
                                .foregroundStyle(originColor(origin))
                        }
                    }

                    // Action buttons
                    detailActions(skill)

                    Divider()

                    // Full description
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(descriptionBullets(skill.description), id: \.self) { sentence in
                            HStack(alignment: .top, spacing: 6) {
                                Text("•").foregroundStyle(.secondary)
                                Text(sentence)
                            }
                        }
                    }
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)

                    // Readme snippet
                    if let snippet = skill.readmeSnippet, !snippet.isEmpty {
                        Divider()
                        Text("README")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundStyle(.tertiary)
                        ReadmeWebView(markdown: snippet, height: $readmeHeight)
                            .frame(height: readmeHeight)
                    }

                }
                .padding(20)
            }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "sidebar.right")
                    .font(.largeTitle)
                    .foregroundStyle(.quaternary)
                Text("Select a skill")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func detailActions(_ skill: Skill) -> some View {
        if source == .installed {
            HStack(spacing: 10) {
                Button {
                    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: skill.installCmd)])
                } label: {
                    Label("Open in Finder", systemImage: "folder")
                }
                Button {
                    let url = URL(fileURLWithPath: skill.installCmd).appendingPathComponent("SKILL.md")
                    NSWorkspace.shared.open(url)
                } label: {
                    Label("Open SKILL.md", systemImage: "doc.text")
                }
                if !skill.githubUrl.isEmpty, let url = URL(string: skill.githubUrl) {
                    Button {
                        NSWorkspace.shared.open(url)
                    } label: {
                        Label("GitHub", systemImage: "arrow.up.right")
                    }
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        } else {
            HStack(spacing: 10) {
                Button {
                    setPasteboard(skill.installCmd)
                } label: {
                    Label("Copy Install", systemImage: "folder")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                if !skill.githubUrl.isEmpty, let url = URL(string: skill.githubUrl) {
                    Button {
                        NSWorkspace.shared.open(url)
                    } label: {
                        Label("GitHub", systemImage: "arrow.up.right")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        }
    }

    private func descriptionBullets(_ text: String) -> [String] {
        text.components(separatedBy: ". ")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { $0.hasSuffix(".") ? $0 : $0 + "." }
    }

    private func formatDate(_ iso: String) -> String {
        let df = ISO8601DateFormatter()
        guard let date = df.date(from: iso) else { return String(iso.prefix(10)) }
        let out = DateFormatter()
        out.dateStyle = .medium
        return out.string(from: date)
    }

    private func originColor(_ origin: String) -> Color {
        switch origin {
        case "Claude": return .blue
        case "Codex":  return .green
        case "Agents": return .purple
        default:       return .secondary
        }
    }

    // MARK: - Keyboard

    private func addKeyMonitor() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            handleKey(event)
        }
    }

    private func removeKeyMonitor() {
        if let m = keyMonitor {
            NSEvent.removeMonitor(m)
            keyMonitor = nil
        }
    }

    private func handleKey(_ event: NSEvent) -> NSEvent? {
        let cmd = event.modifierFlags.contains(.command)
        let shift = event.modifierFlags.contains(.shift)
        switch event.keyCode {
        case 125: moveSelection(by: 1); return nil
        case 126: moveSelection(by: -1); return nil
        case 36:
            if source == .installed {
                cmd ? openSkillMd() : openInFinder()
            } else {
                if cmd { openGitHub() }
                else if shift { copyInstall(target: .codex) }
                else { copyInstall(target: .claude) }
            }
            return nil
        case 47 where cmd:
            source == .installed ? copyPath() : copyGithubURL()
            return nil
        case 53:
            if showDetail {
                withAnimation(.easeInOut(duration: 0.15)) { showDetail = false }
            } else {
                closePopover()
            }
            return nil
        default: return event
        }
    }

    private enum InstallTarget {
        case claude, codex
    }

    private func moveSelection(by delta: Int) {
        guard !results.isEmpty else { return }
        let currentIdx = results.firstIndex { $0.id == selectedId } ?? -1
        let nextIdx = max(0, min(results.count - 1, currentIdx + delta))
        selectedId = results[nextIdx].id
    }

    // MARK: - Actions

    private func copyInstall(target: InstallTarget) {
        guard let skill = selectedSkill else { return }
        let cmd: String
        switch target {
        case .claude:
            cmd = skill.installCmd
        case .codex:
            cmd = skill.installCmd.replacingOccurrences(of: "~/.claude/skills", with: "~/.codex/skills")
        }
        setPasteboard(cmd)
        closePopover()
    }

    private func openGitHub() {
        guard let skill = selectedSkill, let url = URL(string: skill.githubUrl) else { return }
        NSWorkspace.shared.open(url)
        closePopover()
    }

    private func copyGithubURL() {
        guard let skill = selectedSkill else { return }
        setPasteboard(skill.githubUrl)
        closePopover()
    }

    private func openInFinder() {
        guard let skill = selectedSkill else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: skill.installCmd)])
        closePopover()
    }

    private func openSkillMd() {
        guard let skill = selectedSkill else { return }
        let url = URL(fileURLWithPath: skill.installCmd).appendingPathComponent("SKILL.md")
        NSWorkspace.shared.open(url)
        closePopover()
    }

    private func copyPath() {
        guard let skill = selectedSkill else { return }
        setPasteboard(skill.installCmd)
        closePopover()
    }

    private func setPasteboard(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }

    private func closePopover() {
        (NSApp.delegate as? AppDelegate)?.closePopover()
    }
}

// MARK: - Skill Row

struct SkillRow: View {
    let skill: Skill
    let selected: Bool
    let source: Source

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(skill.name)
                    .font(.headline)
                    .lineLimit(1)
                Text("@\(skill.authorHandle)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if source == .available {
                    Text("★ \(skill.stars)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                } else if let origin = skill.origin {
                    Text(origin)
                        .font(.caption2)
                        .fontWeight(.medium)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(originColor(origin).opacity(0.18)))
                        .foregroundStyle(originColor(origin))
                }
            }
            Text(skill.description)
                .font(.system(size: 12))
                .foregroundStyle(.secondary.opacity(0.7))
                .lineLimit(2)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? Color.accentColor.opacity(0.18) : .clear)
    }

    private func originColor(_ origin: String) -> Color {
        switch origin {
        case "Claude": return .blue
        case "Codex":  return .green
        case "Agents": return .purple
        default:       return .secondary
        }
    }
}

// MARK: - Flow Layout (horizontal wrapping for tags)

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        var height: CGFloat = 0
        for (i, row) in rows.enumerated() {
            let rowHeight = row.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0
            height += rowHeight + (i > 0 ? spacing : 0)
        }
        return CGSize(width: proposal.width ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        var y = bounds.minY
        for row in rows {
            let rowHeight = row.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0
            var x = bounds.minX
            for subview in row {
                let size = subview.sizeThatFits(.unspecified)
                subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += rowHeight + spacing
        }
    }

    private func computeRows(proposal: ProposedViewSize, subviews: Subviews) -> [[LayoutSubviews.Element]] {
        let maxWidth = proposal.width ?? .infinity
        var rows: [[LayoutSubviews.Element]] = [[]]
        var currentWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if currentWidth + size.width + spacing > maxWidth && !rows[rows.count - 1].isEmpty {
                rows.append([])
                currentWidth = 0
            }
            rows[rows.count - 1].append(subview)
            currentWidth += size.width + spacing
        }
        return rows
    }
}
