import SwiftUI
import AppKit

enum Source: String, CaseIterable, Identifiable {
    case installed = "Installed"
    case available = "Discover"
    case trending = "Trending"
    case twitter = "Twitter / X"
    var id: String { rawValue }
}

enum SortKey: String, CaseIterable, Identifiable {
    case trending
    case stars
    case lastUpdated
    case firstSeen
    case name

    var id: String { rawValue }

    var label: String {
        switch self {
        case .trending: return "Trending"
        case .stars: return "Stars"
        case .lastUpdated: return "Recently Updated"
        case .firstSeen: return "Recently Added"
        case .name: return "Name"
        }
    }

    var icon: String {
        switch self {
        case .trending: return "triangle"
        case .stars: return "star"
        case .lastUpdated: return "clock.arrow.circlepath"
        case .firstSeen: return "sparkles"
        case .name: return "textformat"
        }
    }
}

private enum SkillInstallState: Equatable {
    case idle
    case installing
    case installed
    case failed(String)

    func buttonTitle(for target: SkillInstaller.Target) -> String {
        switch self {
        case .idle, .failed: return target.rawValue
        case .installing: return "Installing..."
        case .installed: return "Installed"
        }
    }

    var isDisabled: Bool {
        self == .installing || self == .installed
    }

    var errorMessage: String? {
        if case .failed(let message) = self { return message }
        return nil
    }
}

private enum GitHubInstallPromptStatus: Equatable {
    case idle
    case installing
    case success(String)
    case failed(String)
}

private enum GitHubInstallPromptResolution: Equatable {
    case empty
    case invalid
    case ambiguous
    case ready(Skill)
}

private enum CrossInstallState: Equatable {
    case idle
    case installing
    case failed(String)

    var isInstalling: Bool {
        self == .installing
    }

    var errorMessage: String? {
        if case .failed(let message) = self { return message }
        return nil
    }
}

private struct PopoverSessionState: Equatable {
    let source: Source
    let sortKey: SortKey
    let query: String
    let debouncedQuery: String
    let localDashboardFilter: LocalDashboardFilter?
    let selectedId: String
}

private struct StarterSearch: Identifiable, Hashable {
    let title: String
    let symbol: String
    var id: String { title }

    init(_ title: String, _ symbol: String) {
        self.title = title
        self.symbol = symbol
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
    @State private var cachedResults: [Skill] = []
    @State private var selectedSkill: Skill?
    @State private var displayedReadme: String?
    @State private var isLoadingReadme = false
    @State private var readmeHeight: CGFloat = 200
    @State private var readmeLoadTask: Task<Void, Never>?
    @State private var scrollTargetId: String?
    @State private var updateAvailable = false
    @State private var debouncedQuery = ""
    @State private var showDataUpdatedToast = false
    @State private var dataUpdatedText = ""
    @State private var dataUpdatedTask: Task<Void, Never>?
    @State private var claudeInstallState: SkillInstallState = .idle
    @State private var codexInstallState: SkillInstallState = .idle
    @State private var localDashboardFilter: LocalDashboardFilter?
    @State private var skillPendingDelete: Skill?
    @State private var deleteError: String?
    @State private var githubInstallURLText = ""
    @State private var githubInstallCodex = true
    @State private var githubInstallClaude = true
    @State private var githubInstallPromptStatus: GitHubInstallPromptStatus = .idle
    @State private var crossInstallState: CrossInstallState = .idle
    @State private var savedSession: PopoverSessionState?
    @State private var isRestoringSession = false
    @State private var suppressSessionChangeHandlers = false
    @State private var lastTrackedSearchQuery = ""
    @State private var lastTrackedSearchErrorKey = ""
    @State private var lastTrackedOpenedSkillId = ""
    @FocusState private var searchFocused: Bool

    private let detailDescriptionFont: Font = .body
    private let toolbarSources: [Source] = [.installed, .available]
    private let friendShareText = "I use omgskills.com to find skills and it doesn't suck"

    private let starterSearchGroups: [(String, [StarterSearch])] = [
        ("Design + Apps", [
            StarterSearch("UI design", "paintbrush"),
            StarterSearch("Swift iOS", "swift"),
            StarterSearch("App Store", "app.badge"),
            StarterSearch("React UI", "atom"),
            StarterSearch("Video Motion", "play.rectangle"),
            StarterSearch("Screenshots", "camera.viewfinder")
        ]),
        ("Marketing", [
            StarterSearch("Google ads", "megaphone"),
            StarterSearch("SEO content", "text.magnifyingglass"),
            StarterSearch("Social media", "person.2"),
            StarterSearch("Content writing", "text.quote"),
            StarterSearch("Email marketing", "envelope"),
            StarterSearch("Competitor research", "scope")
        ]),
        ("Coding", [
            StarterSearch("Code review", "checkmark.seal"),
            StarterSearch("Test automation", "checklist"),
            StarterSearch("Debugging", "ladybug"),
            StarterSearch("Security audit", "lock.shield"),
            StarterSearch("API design", "point.3.connected.trianglepath.dotted"),
            StarterSearch("Refactoring", "arrow.triangle.2.circlepath")
        ]),
        ("Automation", [
            StarterSearch("Image generation", "photo"),
            StarterSearch("Web scraping", "globe"),
            StarterSearch("Spreadsheet", "tablecells"),
            StarterSearch("Browser automation", "safari"),
            StarterSearch("GitHub", "chevron.left.forwardslash.chevron.right"),
            StarterSearch("CI/CD", "hammer")
        ]),
        ("Practical", [
            StarterSearch("MCP server", "server.rack"),
            StarterSearch("Research", "doc.text.magnifyingglass"),
            StarterSearch("Humanizer", "person.crop.circle.badge.checkmark"),
            StarterSearch("Youtube", "play.tv"),
            StarterSearch("Docs", "doc.text"),
            StarterSearch("Memory", "brain")
        ])
    ]

    private var baseSkills: [Skill] {
        switch source {
        case .installed:
            if let localDashboardFilter {
                return filteredInstalledSkills(for: localDashboardFilter)
            }
            return store.installedSkills
        case .available: return store.availableSkills
        case .trending: return store.trendingSkills
        case .twitter: return store.twitterSkills
        }
    }

    private var currentLoadError: String? {
        switch source {
        case .available: return store.loadError
        case .trending: return store.trendingLoadError
        case .installed: return nil
        case .twitter: return store.twitterLoadError
        }
    }
    
    private func computeResults() -> [Skill] {
        let searched = store.search(query: debouncedQuery, in: baseSkills, source: source, usingIndex: source != .installed)
        let sorted: [Skill] = switch sortKey {
        case .trending:
            searched.sorted {
                ($0.trendingRank ?? .max, -($0.installs ?? 0), -$0.stars, $0.name) <
                ($1.trendingRank ?? .max, -($1.installs ?? 0), -$1.stars, $1.name)
            }
        case .stars where source == .twitter:
            if !debouncedQuery.isEmpty { searched }
            else {
                searched.sorted {
                    (($0.tweetLikes ?? 0), $0.stars, $0.name) >
                    (($1.tweetLikes ?? 0), $1.stars, $1.name)
                }
            }
        case .stars:
            if (source == .available || source == .trending) && !debouncedQuery.isEmpty { searched }
            else {
                source == .available
                ? searched
                : source == .trending
                    ? searched.sorted { ($0.installs ?? 0, $0.stars) > ($1.installs ?? 0, $1.stars) }
                    : searched.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
            }
        case .lastUpdated: searched.sorted { $0.lastUpdated > $1.lastUpdated }
        case .firstSeen:   searched.sorted { $0.firstSeen > $1.firstSeen }
        case .name:        searched.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        }
        return Array(sorted.prefix(150))
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            searchField
            Divider()
            masterDetail
        }
        .overlay(alignment: .top) {
            if showDataUpdatedToast {
                Text(dataUpdatedText)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .padding(.top, 10)
                    .allowsHitTesting(false)
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .overlay {
            if skillPendingDelete != nil {
                deleteConfirmationOverlay
            }
        }
        .frame(width: shouldShowDetailPanel ? 750 : 400, height: 855)
        .onChange(of: showDetail) { _, newValue in
            guard !suppressSessionChangeHandlers else { return }
            postDetailVisibility(newValue && !isEmptyStartState)
            captureSessionIfNeeded()
        }
        .onChange(of: shouldShowDetailPanel) { _, newValue in
            guard !suppressSessionChangeHandlers else { return }
            postDetailVisibility(newValue)
            captureSessionIfNeeded()
        }
        .background(.background)
        .onAppear {
            refreshResults(selectFirst: selectedId == nil)
            addKeyMonitor()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                searchFocused = true
            }
        }
        .onDisappear {
            captureSessionIfNeeded()
            removeKeyMonitor()
            dataUpdatedTask?.cancel()
            readmeLoadTask?.cancel()
            resetInstallStates()
            showDataUpdatedToast = false
        }
        .task(id: query) {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                debouncedQuery = query
                refreshResults(selectFirst: shouldSelectFirstResult)
                if isEmptyStartState {
                    postDetailVisibility(false)
                }
                return
            }
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled else { return }
            debouncedQuery = query
            refreshResults(selectFirst: shouldSelectFirstResult)
        }
        .onReceive(NotificationCenter.default.publisher(for: .popoverDidOpen)) { _ in
            resetTelemetryDedupe()
            Analytics.signal("popover.opened")
            store.refreshInstalled()
            if restoreSessionIfPossible() {
                postDetailVisibility(shouldShowDetailPanel)
            } else {
                resetToDefaultOpenState()
            }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(250))
                showDataUpdatedToastIfPossible()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                searchFocused = true
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .libraryDataDidRefresh)) { _ in
            Task { await store.reloadLibraryData() }
            refreshResults(selectFirst: selectedId == nil)
        }
        .onChange(of: query) { _, newValue in
            guard !suppressSessionChangeHandlers else { return }
            if !newValue.isEmpty && source == .trending {
                source = .available
                return
            }
            if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if isEmptyStartState {
                    postDetailVisibility(false)
                }
            }
            captureSessionIfNeeded()
        }
        .onChange(of: debouncedQuery) { _, _ in
            guard !suppressSessionChangeHandlers else { return }
            trackSearchIfNeeded(debouncedQuery)
            captureSessionIfNeeded()
        }
        .onChange(of: selectedId) { _, _ in
            guard !suppressSessionChangeHandlers else { return }
            trackOpenedSkillIfNeeded()
            captureSessionIfNeeded()
        }
        .onChange(of: sortKey)  { _, _ in
            guard !suppressSessionChangeHandlers else { return }
            refreshResults(selectFirst: true)
            captureSessionIfNeeded()
        }
        .onChange(of: source)   { _, _ in
            guard !suppressSessionChangeHandlers else { return }
            if source != .installed { localDashboardFilter = nil }
            if source == .trending { sortKey = .trending }
            else if sortKey == .trending { sortKey = .stars }
            refreshResults(selectFirst: true)
            searchFocused = true
            captureSessionIfNeeded()
        }
        .onChange(of: localDashboardFilter) { _, _ in
            guard !suppressSessionChangeHandlers else { return }
            captureSessionIfNeeded()
        }
        .onChange(of: store.searchIndexVersion) { _, _ in refreshResults(selectFirst: true) }
        .onChange(of: githubInstallURLText) { _, _ in resetGitHubInstallPromptStatus() }
        .onChange(of: githubInstallCodex) { _, _ in resetGitHubInstallPromptStatus() }
        .onChange(of: githubInstallClaude) { _, _ in resetGitHubInstallPromptStatus() }
        .onReceive(NotificationCenter.default.publisher(for: .updateAvailabilityChanged)) { note in
            updateAvailable = (note.userInfo?["available"] as? Bool) ?? false
        }
    }

    // MARK: - Header

    private var toolbar: some View {
        ZStack {
            HStack(spacing: 8) {
                if shouldShowSortMenu {
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
                }

                if source == .twitter || source == .trending {
                    Button {
                        resetToDefaultOpenState()
                        postDetailVisibility(false)
                        searchFocused = true
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.left")
                                .font(.system(size: 9))
                            Text("Exit")
                                .font(.system(size: 9))
                        }
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(Color.primary.opacity(0.1))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .help("Back")
                }

                Spacer()

                if updateAvailable {
                    Button {
                        NotificationCenter.default.post(name: .checkForUpdates, object: nil)
                    } label: {
                        Text("Update")
                            .font(.system(size: 9))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.primary)
                    .help("Install Update")
                }

                HStack(spacing: 2) {
                    ForEach(toolbarSources) { s in
                        Button { source = s } label: {
                            Image(systemName: sourceIcon(s))
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

        }
        .padding(.horizontal, 10)
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    private var shouldShowSortMenu: Bool {
        !cachedResults.isEmpty
    }

    private var shouldSelectFirstResult: Bool {
        !(showDetail && selectedId != nil)
    }

    private var isEmptyStartState: Bool {
        shouldShowStarterSearches ||
        (source == .installed &&
         localDashboardFilter == nil &&
         query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private var shouldShowDetailPanel: Bool {
        showDetail && !isEmptyStartState
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            TextField(searchPlaceholder, text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
                .focused($searchFocused)

            if !query.isEmpty {
                Button {
                    query = ""
                    debouncedQuery = ""
                    refreshResults(selectFirst: true)
                    searchFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 10))
                        .frame(width: 25, height: 20)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.tertiary)
                .accessibilityLabel("Clear search")
                .help("Clear search")
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    // MARK: - Master-Detail

    @ViewBuilder
    private var masterDetail: some View {
        if let err = currentLoadError {
            errorView(err)
        } else if shouldShowStarterSearches {
            starterSearchesView
        } else if shouldShowLocalDashboard {
            if shouldShowDetailPanel {
                HStack(spacing: 0) {
                    localDashboardContent
                        .frame(width: 320)
                    Divider()
                    detailPane
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                localDashboardContent
            }
        } else if source == .installed, localDashboardFilter != nil, cachedResults.isEmpty {
            localFilteredList
        } else if cachedResults.isEmpty {
            emptyView
        } else if shouldShowDetailPanel {
            HStack(spacing: 0) {
                localFilteredList
                    .frame(width: 320)
                Divider()
                detailPane
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            localFilteredList
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

    private var shouldShowStarterSearches: Bool {
        source == .available && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var shouldShowLocalDashboard: Bool {
        source == .installed &&
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var starterSearchesView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                ForEach(starterSearchGroups, id: \.0) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(group.0)
                            .font(.system(size: 10, weight: .semibold))
                            .fontWeight(.semibold)
                            .foregroundStyle(.tertiary)
                        HStack(alignment: .top, spacing: 8) {
                            starterSearchColumn(Array(group.1.prefix(3)))
                            starterSearchColumn(Array(group.1.dropFirst(3).prefix(3)))
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Trending")
                        .font(.system(size: 10, weight: .semibold))
                        .fontWeight(.semibold)
                        .foregroundStyle(.tertiary)
                    HStack(alignment: .top, spacing: 8) {
                        trendingStarterButton("Twitter / X", icon: "chart.line.uptrend.xyaxis", action: showTwitterSkills)
                        trendingStarterButton("Skills.sh", icon: "triangle", action: showTrendingSkills)
                    }
                }

                ShareLink(item: friendShareText) {
                    Label("Send to a friend", systemImage: "square.and.arrow.up")
                        .font(.system(size: 11, weight: .regular))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Share omgskills")
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollIndicators(.never)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func trendingStarterButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 10))
                    .frame(width: 14)
                    .foregroundStyle(.secondary)
                Text(title)
                    .font(.system(size: 11, weight: .regular))
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .help("Show \(title) trending skills")
    }

    private func starterSearchColumn(_ searches: [StarterSearch]) -> some View {
        VStack(spacing: 5) {
            ForEach(searches) { search in
                Button {
                    runStarterSearch(search.title)
                } label: {
                    HStack {
                        Image(systemName: search.symbol)
                            .font(.system(size: 10))
                            .frame(width: 14)
                            .foregroundStyle(.secondary)
                        Text(search.title)
                            .font(.system(size: 11, weight: .regular))
                            .lineLimit(1)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
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
            } else if source == .trending && baseSkills.isEmpty {
                Text("Run `npm run scrape:trending` in `index/`, then rebuild.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else if source == .twitter && baseSkills.isEmpty {
                Text("Run `npm run collect:x-skill-tweets`, then merge tweet metadata.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyMessage: String {
        if baseSkills.isEmpty {
            switch source {
            case .installed: return "No skills installed"
            case .available: return "No skills indexed yet"
            case .trending: return "No trending skills indexed yet"
            case .twitter: return "No X-trending skills indexed yet"
            }
        }
        return "No matches"
    }

    // MARK: - List

    private var localDashboardContent: some View {
        VStack(spacing: 0) {
            ScrollView {
                LocalDashboardView(
                    summary: store.installedSummary,
                    selectedFilter: localDashboardFilter,
                    onSelectFilter: selectLocalDashboardFilter,
                    onSelectRecentSkill: selectRecentInstalledSkill
                )

                if localDashboardFilter != nil {
                    if cachedResults.isEmpty {
                        emptyView
                    } else {
                        skillsListRows
                    }
                }
            }
            .scrollIndicators(.never)

            if localDashboardFilter == nil {
                GitHubInstallPromptView(
                    urlText: $githubInstallURLText,
                    installCodex: $githubInstallCodex,
                    installClaude: $githubInstallClaude,
                    title: githubInstallPromptTitle,
                    message: githubInstallPromptMessage,
                    tone: githubInstallPromptTone,
                    showInstallControls: shouldShowGitHubInstallControls,
                    canInstall: canInstallGitHubPromptSkill,
                    isInstalling: githubInstallPromptStatus == .installing,
                    onInstall: installGitHubPromptSkill
                )
            }
        }
    }

    @ViewBuilder
    private var localFilteredList: some View {
        if source == .installed, let localDashboardFilter {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Text(localDashboardFilter.title)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        self.localDashboardFilter = nil
                        refreshResults(selectFirst: true)
                        searchFocused = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tertiary)
                    .help("Clear filter")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)

                Divider()
                if cachedResults.isEmpty {
                    emptyView
                } else {
                    skillsList
                }
            }
        } else {
            skillsList
        }
    }

    private var skillsList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                skillsListRows
            }
            .onChange(of: scrollTargetId) { _, newId in
                if let newId {
                    withAnimation(.easeOut(duration: 0.08)) {
                        proxy.scrollTo(newId, anchor: .center)
                    }
                    scrollTargetId = nil
                }
            }
        }
    }

    private var skillsListRows: some View {
        LazyVStack(spacing: 0) {
            ForEach(cachedResults) { skill in
                Button {
                    select(skill, scroll: false)
                    withAnimation(.easeInOut(duration: 0.15)) {
                        showDetail = true
                    }
                } label: {
                    SkillRow(skill: skill, selected: skill.id == selectedId, source: source)
                }
                .id(skill.id)
                .buttonStyle(.plain)
                .contentShape(Rectangle())
                .padding(.bottom, source == .twitter ? 10 : 0)
            }
        }
        .padding(.vertical, 4)
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
                        Button("Close", systemImage: "arrow.left.to.line.compact") {
                            withAnimation(.easeInOut(duration: 0.15)) { showDetail = false }
                        }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .frame(width: 20, height: 20)
                        .frame(width: 24, height: 24)
                        .contentShape(Circle())
                        .offset(x: 10)
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
                            Label(formatCompactCount(skill.stars), systemImage: "star")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                            Label(formatDate(skill.lastUpdated), systemImage: "clock")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    } else if source == .trending {
                        HStack(spacing: 16) {
                            Label(formatCompactCount(skill.installs ?? 0), systemImage: "triangle.fill")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                            if let rank = skill.trendingRank {
                                Label("#\(rank)", systemImage: "number")
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        if let trendingSource = skill.trendingSource {
                            Text("Trending on \(trendingSource)")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    } else if source == .twitter {
                        HStack(spacing: 16) {
                            Label(formatCompactCount(skill.tweetLikes ?? 0), systemImage: "heart.fill")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                            if let views = skill.tweetViews {
                                Label(formatCompactCount(views), systemImage: "eye")
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        if let tweetUrl = skill.tweetUrl,
                           let url = URL(string: tweetUrl) {
                            Link(destination: url) {
                                Text("Trending on X by \(twitterAuthorLabel(skill))")
                                    .font(.caption)
                            }
                            .foregroundStyle(.secondary)
                        } else {
                            Text("Trending on X by \(twitterAuthorLabel(skill))")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
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

                    if source == .twitter,
                       let tweetText = skill.tweetText,
                       !tweetText.isEmpty {
                        twitterTweetCard(skill, tweetText: tweetText)
                    }

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
                    .font(detailDescriptionFont)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)

                    if isLoadingReadme {
                        Divider()
                        ProgressView()
                            .controlSize(.small)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else if let readme = displayedReadme, !readme.isEmpty {
                        Divider()
                        Text("README")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundStyle(.tertiary)
                        ReadmeWebView(markdown: readme, height: $readmeHeight)
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
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Button {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: skill.installCmd)])
                    } label: {
                        Label("Open", systemImage: "folder")
                    }
                    Button {
                        let url = URL(fileURLWithPath: skill.installCmd).appendingPathComponent("SKILL.md")
                        NSWorkspace.shared.open(url)
                    } label: {
                        Label("SKILL.md", systemImage: "doc.text")
                    }
                    if !skill.githubUrl.isEmpty, let url = URL(string: skill.githubUrl) {
                        Button {
                            NSWorkspace.shared.open(url)
                        } label: {
                            Label("GitHub", systemImage: "arrow.up.right")
                        }
                    }
                    if let shareText = skillShareText(skill) {
                        ShareLink(item: shareText) {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                    }
                    if let target = crossInstallTarget(for: skill) {
                        Button {
                            crossInstallSkill(skill, target: target)
                        } label: {
                            Label(crossInstallButtonTitle(for: target), systemImage: "arrow.triangle.branch")
                        }
                        .disabled(crossInstallState.isInstalling)
                        .accessibilityLabel(crossInstallAccessibilityLabel(for: skill, target: target))
                    }
                    Button(role: .destructive) {
                        requestDeleteInstalledSkill(skill)
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                if let deleteError {
                    Text(deleteError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                if let message = crossInstallState.errorMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Button {
                        installSkill(skill, target: .claude)
                    } label: {
                        Label(claudeInstallState.buttonTitle(for: .claude), systemImage: "square.and.arrow.down")
                    }
                    .disabled(claudeInstallState.isDisabled)
                    .accessibilityLabel(claudeInstallState.buttonTitle(for: .claude))
                    .accessibilityHint("Installs this skill as a global Claude skill")

                    Button {
                        installSkill(skill, target: .codex)
                    } label: {
                        Label(codexInstallState.buttonTitle(for: .codex), systemImage: "square.and.arrow.down")
                    }
                    .disabled(codexInstallState.isDisabled)
                    .accessibilityLabel(codexInstallState.buttonTitle(for: .codex))
                    .accessibilityHint("Installs this skill as a global Codex skill")

                    if !skill.githubUrl.isEmpty, let url = URL(string: skill.githubUrl) {
                        Button {
                            NSWorkspace.shared.open(url)
                        } label: {
                            Label("GitHub", systemImage: "arrow.up.right")
                        }
                    }
                    if let shareText = skillShareText(skill) {
                        ShareLink(item: shareText) {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                if let message = claudeInstallState.errorMessage ?? codexInstallState.errorMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
    }

    private func skillShareText(_ skill: Skill) -> String? {
        guard !skill.githubUrl.isEmpty else { return nil }
        return "Check out the \(skill.name) skill: \(skill.githubUrl) via omgskills.com"
    }

    private func twitterTweetCard(_ skill: Skill, tweetText: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                XTwitterLogoView(size: 12)

                if let tweetUrl = skill.tweetUrl,
                   let url = URL(string: tweetUrl) {
                    Link(twitterAuthorLabel(skill), destination: url)
                        .font(.headline)
                        .fontWeight(.regular)
                        .foregroundStyle(.blue)
                } else {
                    Text(twitterAuthorLabel(skill))
                        .font(.headline)
                        .fontWeight(.regular)
                        .foregroundStyle(.blue)
                }
            }

            Text(tweetText)
                .font(detailDescriptionFont)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(.quaternary.opacity(0.35))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(.quaternary.opacity(0.7), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Tweet by \(twitterAuthorLabel(skill)): \(tweetText)")
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

    private func formatCompactCount(_ value: Int) -> String {
        if value >= 1_000_000 {
            return compactDecimal(Double(value) / 1_000_000) + "M"
        }
        if value >= 1_000 {
            return compactDecimal(Double(value) / 1_000) + "k"
        }
        return "\(value)"
    }

    private func compactDecimal(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        if rounded.truncatingRemainder(dividingBy: 1) == 0 {
            return "\(Int(rounded))"
        }
        return String(format: "%.1f", rounded)
    }

    private func originColor(_ origin: String) -> Color {
        switch origin {
        case "Claude": return .blue
        case "Codex":  return .green
        case "Agents": return .purple
        default:       return .secondary
        }
    }

    private func twitterAuthorLabel(_ skill: Skill) -> String {
        if let handle = skill.tweetAuthorHandle, !handle.isEmpty {
            return "@\(handle)"
        }
        if let name = skill.tweetAuthorName, !name.isEmpty {
            return name
        }
        return "X"
    }

    private var searchPlaceholder: String {
        switch source {
        case .available: return "Search for skills on Github..."
        case .trending: return "Seach trending skills on skills.sh..."
        case .twitter: return "Search skills trending on X..."
        case .installed: return "Search your device..."
        }
    }

    private var deleteConfirmationTitle: String {
        guard let skill = skillPendingDelete else { return "Delete skill?" }
        return "Delete this \(skill.origin ?? "local") skill?"
    }

    private var deleteConfirmationMessage: String {
        guard let skill = skillPendingDelete else { return "" }
        return "This removes \(skill.name) from \(skill.origin ?? "this service")."
    }

    private var githubInstallPromptResolution: GitHubInstallPromptResolution {
        guard let normalized = normalizedGitHubRepoURL(from: githubInstallURLText) else {
            return githubInstallURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .empty : .invalid
        }

        let matches = store.availableSkills.filter { normalizedGitHubRepoURL(from: $0.githubUrl) == normalized }
        if matches.count == 1, let match = matches.first {
            return .ready(match)
        }
        if matches.count > 1 {
            return .ambiguous
        }

        return .ready(rootSkillCandidate(from: normalized))
    }

    private var githubInstallPromptTitle: String {
        switch githubInstallPromptStatus {
        case .success(let message): return message
        case .failed(let message): return message
        case .installing: return "Installing..."
        case .idle:
            switch githubInstallPromptResolution {
            case .empty: return ""
            case .invalid: return "Paste a valid GitHub repo URL"
            case .ambiguous: return "Multiple skills found"
            case .ready(let skill): return "Ready: \(skill.name)"
            }
        }
    }

    private var githubInstallPromptMessage: String? {
        switch githubInstallPromptStatus {
        case .success, .failed, .installing:
            return nil
        case .idle:
            switch githubInstallPromptResolution {
            case .empty:
                return nil
            case .invalid:
                return "Use github.com/owner/repo"
            case .ambiguous:
                return "Search Discover to pick one"
            case .ready:
                return nil
            }
        }
    }

    private var githubInstallPromptTone: GitHubInstallPromptTone {
        switch githubInstallPromptStatus {
        case .success: return .success
        case .failed: return .error
        case .idle:
            switch githubInstallPromptResolution {
            case .invalid, .ambiguous: return .error
            default: return .neutral
            }
        case .installing:
            return .neutral
        }
    }

    private var canInstallGitHubPromptSkill: Bool {
        guard case .ready = githubInstallPromptResolution else { return false }
        guard githubInstallPromptStatus != .installing else { return false }
        return githubInstallCodex || githubInstallClaude
    }

    private var shouldShowGitHubInstallControls: Bool {
        if githubInstallPromptStatus == .installing {
            return true
        }
        guard case .ready = githubInstallPromptResolution else { return false }
        return true
    }

    private var deleteConfirmationOverlay: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 31, style: .continuous)
                .fill(.black.opacity(0.10))
                .contentShape(RoundedRectangle(cornerRadius: 31, style: .continuous))
                .onTapGesture {
                    skillPendingDelete = nil
                }

            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(deleteConfirmationTitle)
                        .font(.system(size: 14, weight: .semibold))
                    Text(deleteConfirmationMessage)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 8) {
                    Button {
                        skillPendingDelete = nil
                    } label: {
                        Text("Cancel")
                            .frame(maxWidth: .infinity)
                    }
                    .keyboardShortcut(.cancelAction)
                    .buttonStyle(.bordered)
                    .controlSize(.large)

                    Button(role: .destructive) {
                        if let skill = skillPendingDelete {
                            deleteInstalledSkill(skill)
                        }
                    } label: {
                        Text("Delete")
                            .frame(maxWidth: .infinity)
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(.red)
                }
            }
            .padding(22)
            .frame(width: 260)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(.white.opacity(0.16), lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.14), radius: 24, y: 12)
        }
        .clipShape(RoundedRectangle(cornerRadius: 31, style: .continuous))
        .transition(.opacity)
        .zIndex(20)
        .accessibilityElement(children: .contain)
    }

    private func sourceIcon(_ source: Source) -> String {
        switch source {
        case .installed: return "person"
        case .available: return "globe"
        case .trending: return "triangle"
        case .twitter: return "bubble.left.and.bubble.right"
        }
    }

    private func showDataUpdatedToastIfPossible() {
        guard let date = DataRefreshService.lastDisplayableDataUpdateDate() else { return }
        let age = relativeRefreshAge(from: date)
        dataUpdatedText = age == "now" ? "Data Updated now" : "Data Updated \(age) ago"
        dataUpdatedTask?.cancel()
        withAnimation(.easeInOut(duration: 0.15)) {
            showDataUpdatedToast = true
        }
        dataUpdatedTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation(.easeInOut(duration: 0.15)) {
                    showDataUpdatedToast = false
                }
            }
        }
    }

    private func relativeRefreshAge(from date: Date) -> String {
        let seconds = max(0, Int(Date().timeIntervalSince(date)))
        if seconds < 60 { return "now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 48 { return "\(hours)h" }
        return "\(hours / 24)d"
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
        guard !cachedResults.isEmpty else { return }
        let currentIdx = cachedResults.firstIndex { $0.id == selectedId } ?? -1
        let nextIdx = max(0, min(cachedResults.count - 1, currentIdx + delta))
        select(cachedResults[nextIdx], scroll: true)
    }

    // MARK: - Actions

    private func copyInstall(target: InstallTarget) {
        guard let skill = selectedSkill else { return }
        let cmd: String
        let signalName: String
        switch target {
        case .claude:
            cmd = skill.installCmd
            signalName = "skill.copied_to_claude"
        case .codex:
            cmd = skill.installCmd.replacingOccurrences(of: "~/.claude/skills", with: "~/.codex/skills")
            signalName = "skill.copied_to_codex"
        }
        setPasteboard(cmd)
        Analytics.signal(signalName, parameters: analyticsParameters(for: skill))
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

    private func requestDeleteInstalledSkill(_ skill: Skill) {
        deleteError = nil
        skillPendingDelete = skill
    }

    private func crossInstallSkill(_ skill: Skill, target: SkillInstaller.Target) {
        guard crossInstallState.isInstalling == false else { return }
        crossInstallState = .installing
        Task.detached {
            do {
                _ = try LocalSkillCrossInstaller.install(skill, target: target)
                await MainActor.run {
                    Analytics.signal(crossInstallSignalName(for: target), parameters: analyticsParameters(for: skill, target: target))
                    crossInstallState = .idle
                    store.refreshInstalled()
                    refreshResults(selectFirst: false)
                }
            } catch {
                await MainActor.run {
                    Analytics.signal("error.copy_failed", parameters: analyticsParameters(for: skill, target: target, error: error))
                    crossInstallState = .failed(error.localizedDescription)
                    store.refreshInstalled()
                }
            }
        }
    }

    private func crossInstallTarget(for skill: Skill) -> SkillInstaller.Target? {
        let target: SkillInstaller.Target
        let targetOrigin: String
        switch skill.origin {
        case "Claude":
            target = .codex
            targetOrigin = "Codex"
        case "Codex":
            target = .claude
            targetOrigin = "Claude"
        default:
            return nil
        }

        let installName = URL(fileURLWithPath: skill.installCmd, isDirectory: true).lastPathComponent
        guard !installName.isEmpty else { return nil }
        guard FileManager.default.fileExists(atPath: URL(fileURLWithPath: skill.installCmd).appendingPathComponent("SKILL.md").path) else {
            return nil
        }

        let alreadyInstalled = store.installedSkillInstallations.contains { installed in
            installed.origin == targetOrigin &&
            URL(fileURLWithPath: installed.installCmd, isDirectory: true).lastPathComponent == installName
        }
        return alreadyInstalled ? nil : target
    }

    private func crossInstallButtonTitle(for target: SkillInstaller.Target) -> String {
        crossInstallState.isInstalling ? "Installing..." : "Install on \(target.rawValue)"
    }

    private func crossInstallAccessibilityLabel(for skill: Skill, target: SkillInstaller.Target) -> String {
        "Install this \(skill.origin ?? "local") skill on \(target.rawValue)"
    }

    private func deleteInstalledSkill(_ skill: Skill) {
        let fm = FileManager.default
        let installURL = URL(fileURLWithPath: skill.installCmd, isDirectory: true)
        guard isSafeInstalledSkillURL(installURL) else {
            deleteError = "Delete blocked: unexpected skill path"
            skillPendingDelete = nil
            return
        }

        do {
            let isSymlink = skill.isSymlink == true ||
                ((try? installURL.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) ?? false)
            if isSymlink {
                try fm.removeItem(at: installURL)
            } else {
                var trashedURL: NSURL?
                try fm.trashItem(at: installURL, resultingItemURL: &trashedURL)
            }

            skillPendingDelete = nil
            deleteError = nil
            store.refreshInstalled()
            showDetail = false
            clearSelection()
            refreshResults(selectFirst: false)
        } catch {
            deleteError = error.localizedDescription
            skillPendingDelete = nil
        }
    }

    private func isSafeInstalledSkillURL(_ url: URL) -> Bool {
        let path = url.standardizedFileURL.path
        let home = FileManager.default.homeDirectoryForCurrentUser
        let allowedRoots = [
            home.appendingPathComponent(".codex/skills", isDirectory: true),
            home.appendingPathComponent(".claude/skills", isDirectory: true),
            home.appendingPathComponent(".agents/skills", isDirectory: true)
        ].map { $0.standardizedFileURL.path + "/" }
        return allowedRoots.contains { path.hasPrefix($0) }
    }

    private func installGitHubPromptSkill() {
        guard case .ready(let skill) = githubInstallPromptResolution else { return }
        let targets: [SkillInstaller.Target] = [
            githubInstallCodex ? .codex : nil,
            githubInstallClaude ? .claude : nil
        ].compactMap { $0 }
        guard !targets.isEmpty else { return }

        githubInstallPromptStatus = .installing
        Task.detached {
            do {
                for target in targets {
                    _ = try await SkillInstaller.install(skill, target: target)
                    await MainActor.run {
                        Analytics.signal("skill.installed", parameters: analyticsParameters(for: skill, target: target))
                    }
                }
                await MainActor.run {
                    githubInstallPromptStatus = .success("Installed")
                    store.refreshInstalled()
                    localDashboardFilter = nil
                    refreshResults(selectFirst: false)
                }
            } catch {
                await MainActor.run {
                    Analytics.signal("error.install_failed", parameters: analyticsParameters(for: skill, error: error))
                    githubInstallPromptStatus = .failed(error.localizedDescription)
                    store.refreshInstalled()
                }
            }
        }
    }

    private func resetGitHubInstallPromptStatus() {
        if githubInstallPromptStatus != .installing {
            githubInstallPromptStatus = .idle
        }
    }

    private func normalizedGitHubRepoURL(from raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, var components = URLComponents(string: trimmed) else { return nil }
        guard components.scheme == "https" || components.scheme == "http" else { return nil }
        guard components.host?.lowercased() == "github.com" else { return nil }

        let parts = components.path
            .split(separator: "/")
            .map(String.init)
            .filter { !$0.isEmpty }
        guard parts.count == 2 else { return nil }

        var repo = parts[1]
        if repo.hasSuffix(".git") {
            repo.removeLast(4)
        }
        guard !parts[0].isEmpty, !repo.isEmpty else { return nil }

        components.scheme = "https"
        components.host = "github.com"
        components.path = "/\(parts[0])/\(repo)"
        components.query = nil
        components.fragment = nil
        return components.url?.absoluteString
    }

    private func rootSkillCandidate(from normalizedRepoURL: String) -> Skill {
        let url = URL(string: normalizedRepoURL)
        let parts = url?.pathComponents.filter { $0 != "/" } ?? []
        let owner = parts.first ?? ""
        let repo = parts.dropFirst().first ?? "skill"
        return Skill(
            id: "pasted:\(normalizedRepoURL)",
            name: repo,
            description: "Install \(repo) from GitHub.",
            githubUrl: normalizedRepoURL,
            installCmd: "git clone \(normalizedRepoURL) ~/.claude/skills/\(repo)",
            authorHandle: owner,
            tags: [],
            readmeSnippet: nil,
            stars: 0,
            lastUpdated: "",
            firstSeen: "",
            skillMdSha: nil,
            installs: nil,
            trendingRank: nil,
            trendingSource: nil,
            origin: nil,
            isSymlink: nil,
            isLocalOnly: nil
        )
    }

    private func setPasteboard(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }

    private func installSkill(_ skill: Skill, target: SkillInstaller.Target) {
        guard installState(for: target).isDisabled == false else { return }
        setInstallState(.installing, for: target)
        Task.detached {
            do {
                _ = try await SkillInstaller.install(skill, target: target)
                await MainActor.run {
                    guard selectedId == skill.id else { return }
                    Analytics.signal("skill.installed", parameters: analyticsParameters(for: skill, target: target))
                    setInstallState(.installed, for: target)
                    store.refreshInstalled()
                }
            } catch {
                await MainActor.run {
                    guard selectedId == skill.id else { return }
                    Analytics.signal("error.install_failed", parameters: analyticsParameters(for: skill, target: target, error: error))
                    setInstallState(.failed(error.localizedDescription), for: target)
                }
            }
        }
    }

    private func installState(for target: SkillInstaller.Target) -> SkillInstallState {
        switch target {
        case .claude: return claudeInstallState
        case .codex: return codexInstallState
        }
    }

    private func setInstallState(_ state: SkillInstallState, for target: SkillInstaller.Target) {
        switch target {
        case .claude: claudeInstallState = state
        case .codex: codexInstallState = state
        }
    }

    private func resetInstallStates() {
        claudeInstallState = .idle
        codexInstallState = .idle
    }

    private func runStarterSearch(_ term: String) {
        source = .available
        sortKey = .stars
        showDetail = false
        query = term
        debouncedQuery = term
        refreshResults(selectFirst: true)
        searchFocused = true
    }

    private func showTrendingSkills() {
        source = .trending
        sortKey = .trending
        localDashboardFilter = nil
        showDetail = false
        query = ""
        debouncedQuery = ""
        refreshResults(selectFirst: true)
        searchFocused = true
    }

    private func showTwitterSkills() {
        source = .twitter
        sortKey = .stars
        localDashboardFilter = nil
        showDetail = false
        query = ""
        debouncedQuery = ""
        refreshResults(selectFirst: true)
        searchFocused = true
    }

    private func closePopover() {
        (NSApp.delegate as? AppDelegate)?.closePopover()
    }

    private func postDetailVisibility(_ isVisible: Bool) {
        NotificationCenter.default.post(
            name: .detailToggled,
            object: nil,
            userInfo: ["showDetail": isVisible]
        )
    }

    // MARK: - Popover Session

    private func captureSessionIfNeeded() {
        guard !isRestoringSession else { return }
        guard shouldShowDetailPanel, let selectedId, selectedSkill != nil else {
            if !shouldShowDetailPanel {
                savedSession = nil
            }
            return
        }

        savedSession = PopoverSessionState(
            source: source,
            sortKey: sortKey,
            query: query,
            debouncedQuery: debouncedQuery,
            localDashboardFilter: localDashboardFilter,
            selectedId: selectedId
        )
    }

    @discardableResult
    private func restoreSessionIfPossible() -> Bool {
        guard let session = savedSession else { return false }
        guard sessionCanShowDetail(session) else {
            savedSession = nil
            return false
        }

        isRestoringSession = true
        suppressSessionChangeHandlers = true
        defer {
            isRestoringSession = false
            DispatchQueue.main.async {
                suppressSessionChangeHandlers = false
            }
        }

        source = session.source
        sortKey = session.sortKey
        query = session.query
        debouncedQuery = session.debouncedQuery
        localDashboardFilter = session.localDashboardFilter
        cachedResults = computeResults()

        guard let skill = cachedResults.first(where: { $0.id == session.selectedId }) else {
            savedSession = nil
            showDetail = false
            clearSelection()
            return false
        }

        selectedId = nil
        select(skill, scroll: true)
        showDetail = true
        savedSession = session
        return true
    }

    private func sessionCanShowDetail(_ session: PopoverSessionState) -> Bool {
        if session.source == .twitter || session.source == .trending {
            return true
        }
        return !session.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
        (session.source == .installed && session.localDashboardFilter != nil)
    }

    private func resetToDefaultOpenState() {
        isRestoringSession = true
        suppressSessionChangeHandlers = true
        query = ""
        debouncedQuery = ""
        source = .available
        sortKey = .stars
        localDashboardFilter = nil
        showDetail = false
        resetResultsForStarterState()
        savedSession = nil
        isRestoringSession = false
        DispatchQueue.main.async {
            suppressSessionChangeHandlers = false
        }
    }

    // MARK: - Selection

    private func refreshResults(selectFirst: Bool) {
        if shouldShowStarterSearches ||
            (source == .installed &&
             localDashboardFilter == nil &&
             query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
            resetResultsForStarterState()
            return
        }

        cachedResults = computeResults()
        let shouldSelectFirst = selectFirst && !(source == .twitter && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        if shouldSelectFirst {
            select(cachedResults.first, scroll: false)
        } else if let selectedId,
                  let skill = cachedResults.first(where: { $0.id == selectedId }) {
            selectedSkill = skill
        } else {
            clearSelection()
        }
    }

    private func resetResultsForStarterState() {
        cachedResults = []
        selectedId = nil
        selectedSkill = nil
        displayedReadme = nil
        isLoadingReadme = false
        resetInstallStates()
        readmeLoadTask?.cancel()
    }

    private func selectLocalDashboardFilter(_ filter: LocalDashboardFilter) {
        if localDashboardFilter == filter {
            localDashboardFilter = nil
            showDetail = false
            query = ""
            debouncedQuery = ""
            clearSelection()
            resetResultsForStarterState()
            searchFocused = true
            return
        }
        localDashboardFilter = filter
        showDetail = false
        query = ""
        debouncedQuery = ""
        clearSelection()
        refreshResults(selectFirst: false)
        searchFocused = true
    }

    private func selectRecentInstalledSkill(_ recent: InstalledSkillSummary.RecentSkill) {
        guard let skill = store.installedSkillInstallations.first(where: { $0.id == recent.id }) ??
                store.installedSkillInstallations.first(where: { $0.name == recent.name && $0.origin == recent.origin }) else {
            return
        }

        source = .installed
        localDashboardFilter = .all
        showDetail = true
        query = ""
        debouncedQuery = ""
        cachedResults = filteredInstalledSkills(for: .all)
        select(skill, scroll: true)
        searchFocused = true
    }

    private func clearSelection() {
        selectedId = nil
        selectedSkill = nil
        displayedReadme = nil
        isLoadingReadme = false
        deleteError = nil
        crossInstallState = .idle
        readmeHeight = 200
        resetInstallStates()
        readmeLoadTask?.cancel()
    }

    private func filteredInstalledSkills(for filter: LocalDashboardFilter) -> [Skill] {
        let installations = store.installedSkillInstallations
        switch filter {
        case .all:
            return installations
        case .codex:
            return installations.filter { $0.origin == "Codex" }
        case .claude:
            return installations.filter { $0.origin == "Claude" }
        case .other:
            return installations.filter { $0.origin == "Agents" }
        case .linked:
            return installations.filter { $0.isSymlink == true }
        case .localOnly:
            return installations.filter { $0.isLocalOnly == true }
        }
    }

    private func select(_ skill: Skill?, scroll: Bool) {
        guard selectedId != skill?.id else { return }
        selectedId = skill?.id
        selectedSkill = skill
        displayedReadme = nil
        isLoadingReadme = false
        deleteError = nil
        crossInstallState = .idle
        readmeHeight = 200
        resetInstallStates()
        readmeLoadTask?.cancel()

        if scroll {
            scrollTargetId = skill?.id
        }

        guard let skill else { return }
        if source != .installed {
            if SkillInstaller.isInstalled(skill, target: .claude) {
                claudeInstallState = .installed
            }
            if SkillInstaller.isInstalled(skill, target: .codex) {
                codexInstallState = .installed
            }
        }
        isLoadingReadme = true
        readmeLoadTask = Task {
            let readme = await ReadmeLoader.load(for: skill)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard selectedId == skill.id else { return }
                displayedReadme = readme
                isLoadingReadme = false
            }
        }
    }

    private func trackSearchIfNeeded(_ rawQuery: String) {
        let trimmed = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return }
        let searchKey = "\(source.rawValue):\(trimmed)"
        guard searchKey != lastTrackedSearchQuery else { return }
        lastTrackedSearchQuery = searchKey
        Analytics.signal("skill.searched", parameters: [
            "query": trimmed,
            "source": source.rawValue,
            "result_count": "\(cachedResults.count)"
        ])
        if let currentLoadError {
            let errorKey = "\(source.rawValue):\(trimmed):\(currentLoadError)"
            guard errorKey != lastTrackedSearchErrorKey else { return }
            lastTrackedSearchErrorKey = errorKey
            Analytics.signal("error.search_failed", parameters: [
                "query": trimmed,
                "source": source.rawValue,
                "error": currentLoadError
            ])
        }
    }

    private func trackOpenedSkillIfNeeded() {
        guard let selectedId else { return }
        guard selectedId != lastTrackedOpenedSkillId else { return }
        guard let skill = selectedSkill ?? cachedResults.first(where: { $0.id == selectedId }) else { return }
        lastTrackedOpenedSkillId = selectedId
        Analytics.signal("skill.opened", parameters: analyticsParameters(for: skill))
    }

    private func resetTelemetryDedupe() {
        lastTrackedSearchQuery = ""
        lastTrackedSearchErrorKey = ""
        lastTrackedOpenedSkillId = ""
    }

    private func analyticsParameters(for skill: Skill, target: SkillInstaller.Target? = nil, error: Error? = nil) -> [String: String] {
        var parameters: [String: String] = [
            "skill_id": skill.id,
            "skill_name": skill.name,
            "source": source.rawValue
        ]
        if let target {
            parameters["target"] = target.rawValue
        }
        if let origin = skill.origin {
            parameters["origin"] = origin
        }
        if !skill.githubUrl.isEmpty {
            parameters["github_url"] = skill.githubUrl
        }
        if let error {
            parameters["error"] = error.localizedDescription
        }
        return parameters
    }

    private func crossInstallSignalName(for target: SkillInstaller.Target) -> String {
        switch target {
        case .claude: return "skill.copied_to_claude"
        case .codex: return "skill.copied_to_codex"
        }
    }
}

// MARK: - Skill Row

struct SkillRow: View {
    let skill: Skill
    let selected: Bool
    let source: Source
    private let trailingMetricWidth: CGFloat = 60

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if source == .twitter {
                HStack(alignment: .top, spacing: 6) {
                    TwitterSkillContextView(skill: skill)
                        .padding(.bottom, 2)
                    Spacer(minLength: 4)
                    HStack(spacing: 4) {
                        Image(systemName: "heart")
                        Text(formatCompactCount(skill.tweetLikes ?? 0))
                    }
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
                    .frame(width: trailingMetricWidth, alignment: .leading)
                }

                HStack(spacing: 6) {
                    Text(skill.name)
                        .font(.headline)
                        .lineLimit(1)
                    Text("@\(skill.authorHandle)")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                        Text(formatCompactCount(skill.stars))
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .frame(width: trailingMetricWidth, alignment: .leading)
                }
                Text(skill.description)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary.opacity(0.7))
                    .lineLimit(2)
            } else {
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
                        HStack(spacing: 4) {
                            Image(systemName: "star.fill")
                            Text(formatCompactCount(skill.stars))
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .frame(width: trailingMetricWidth, alignment: .leading)
                    } else if source == .trending {
                        HStack(spacing: 4) {
                            Image(systemName: "star.fill")
                            Text(formatCompactCount(skill.installs ?? 0))
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .frame(width: trailingMetricWidth, alignment: .leading)
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
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary.opacity(0.7))
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? Color.accentColor.opacity(0.18) : .clear)
        .contentShape(Rectangle())
    }

    private func originColor(_ origin: String) -> Color {
        switch origin {
        case "Claude": return .blue
        case "Codex":  return .green
        case "Agents": return .purple
        default:       return .secondary
    }
}

private func twitterAuthorLabel(_ skill: Skill) -> String {
    if let handle = skill.tweetAuthorHandle, !handle.isEmpty {
        return "@\(handle)"
    }
    if let name = skill.tweetAuthorName, !name.isEmpty {
        return name
    }
    return "X"
}

private func formatCompactCount(_ value: Int) -> String {
        if value >= 1_000_000 {
            return compactDecimal(Double(value) / 1_000_000) + "M"
        }
        if value >= 1_000 {
            return compactDecimal(Double(value) / 1_000) + "k"
        }
        return "\(value)"
    }

    private func compactDecimal(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        if rounded.truncatingRemainder(dividingBy: 1) == 0 {
            return "\(Int(rounded))"
        }
        return String(format: "%.1f", rounded)
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
