import SwiftUI
import AppKit

enum Source: String, CaseIterable, Identifiable {
    case installed = "Installed"
    case available = "Available"
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
        case .stars: return "star.fill"
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
    @State private var source: Source = .installed
    @FocusState private var searchFocused: Bool

    private var baseSkills: [Skill] {
        source == .installed ? store.installedSkills : store.availableSkills
    }

    private var results: [Skill] {
        let base: [Skill]
        if query.isEmpty {
            base = baseSkills
        } else {
            let q = query.lowercased()
            base = baseSkills.filter { s in
                s.name.lowercased().contains(q)
                    || s.description.lowercased().contains(q)
                    || s.authorHandle.lowercased().contains(q)
                    || s.tags.contains { $0.lowercased().contains(q) }
            }
        }
        switch sortKey {
        case .stars:
            return source == .available ? base : base.sorted {
                $0.name.localizedCompare($1.name) == .orderedAscending
            }
        case .lastUpdated: return base.sorted { $0.lastUpdated > $1.lastUpdated }
        case .firstSeen:   return base.sorted { $0.firstSeen > $1.firstSeen }
        case .name:
            return base.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        }
    }

    private var selectedSkill: Skill? {
        guard let id = selectedId else { return nil }
        return results.first { $0.id == id }
    }

    var body: some View {
        VStack(spacing: 0) {
            sourcePicker
            searchField
            Divider()
            content
        }
        .frame(width: 400, height: 500)
        .onAppear {
            // If nothing is installed locally, default to Available
            if store.installedSkills.isEmpty && !store.availableSkills.isEmpty {
                source = .available
            }
            if selectedId == nil { selectedId = results.first?.id }
            addKeyMonitor()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                searchFocused = true
            }
        }
        .onDisappear { removeKeyMonitor() }
        .onChange(of: query)    { _, _ in selectedId = results.first?.id }
        .onChange(of: sortKey)  { _, _ in selectedId = results.first?.id }
        .onChange(of: source)   { _, _ in
            selectedId = results.first?.id
            searchFocused = true
        }
    }

    private var sourcePicker: some View {
        Picker("Source", selection: $source) {
            ForEach(Source.allCases) { s in
                Text("\(s.rawValue) (\(countFor(s)))").tag(s)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal, 10)
        .padding(.top, 10)
    }

    private func countFor(_ s: Source) -> Int {
        s == .installed ? store.installedSkills.count : store.availableSkills.count
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            TextField(source == .installed ? "Search installed skills…" : "Search Claude skills…", text: $query)
                .textFieldStyle(.plain)
                .font(.title3)
                .focused($searchFocused)

            Menu {
                Picker("Sort by", selection: $sortKey) {
                    ForEach(SortKey.allCases) { key in
                        Label(key.label, systemImage: key.icon).tag(key)
                    }
                }
            } label: {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Sort results")

            Button {
                store.refresh()
                selectedId = results.first?.id
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("Rescan installed skills and reload index")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var content: some View {
        if let err = store.loadError, source == .available {
            errorView(err)
        } else if results.isEmpty {
            emptyView
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

    private var skillsList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(results) { skill in
                        SkillRow(skill: skill, selected: skill.id == selectedId, source: source)
                            .id(skill.id)
                            .contentShape(Rectangle())
                            .onTapGesture { selectedId = skill.id }
                    }
                }
                .padding(.vertical, 4)
            }
            .onChange(of: selectedId) { _, newId in
                if let newId {
                    withAnimation(.easeOut(duration: 0.08)) {
                        proxy.scrollTo(newId, anchor: .center)
                    }
                }
            }
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
        case 53: closePopover(); return nil
        default: return event
        }
    }

    private enum InstallTarget {
        case claude, codex
        var dir: String {
            switch self {
            case .claude: return "~/.claude/skills"
            case .codex:  return "~/.codex/skills"
            }
        }
    }

    private func moveSelection(by delta: Int) {
        guard !results.isEmpty else { return }
        let currentIdx = results.firstIndex { $0.id == selectedId } ?? -1
        let nextIdx = max(0, min(results.count - 1, currentIdx + delta))
        selectedId = results[nextIdx].id
    }

    // MARK: - Available actions

    private func copyInstall(target: InstallTarget) {
        guard let skill = selectedSkill else { return }
        let cmd: String
        switch target {
        case .claude:
            cmd = skill.installCmd
        case .codex:
            // Scraper emits `git clone {url} ~/.claude/skills/{name}`; rewrite for Codex.
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

    // MARK: - Installed actions

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

struct SkillRow: View {
    let skill: Skill
    let selected: Bool
    let source: Source

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(skill.name)
                        .font(.headline)
                        .lineLimit(1)
                    if let firstTag = skill.tags.first {
                        Text(firstTag)
                            .font(.caption2)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(.quaternary))
                            .foregroundStyle(.secondary)
                    }
                }
                Text(skill.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
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
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
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
