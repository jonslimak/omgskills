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
    let installedSelectionAnchor: InstalledSkillSelectionResolver.Anchor?
}

private struct StarterSearch: Identifiable, Hashable {
    let title: String
    let symbol: String
    var id: String { title }

    init(_ title: String, symbol: String) {
        self.title = title
        self.symbol = symbol
    }
}

private struct DescriptionParagraph: Identifiable {
    let id: String
    let text: String
}

private struct DataUpdatedFooterView: View {
    let text: String

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(text)
                .fontWeight(.regular)
            Spacer(minLength: 8)
            Text("v\(appVersion)")
                .fontWeight(.regular)
        }
        .font(.caption2)
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.bottom, 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        "\(text.replacingOccurrences(of: "Data Updated", with: "Library data updated")), app version \(appVersion)"
    }
}

private enum CollectionsIndexKind {
    case all
    case creators
    case companies

    var title: String {
        switch self {
        case .all: return "Collections"
        case .creators: return "Creators"
        case .companies: return "Companies"
        }
    }
}

private extension Array where Element == SkillCollection {
    func sortedByTitle() -> [SkillCollection] {
        sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}

struct ContentView: View {
    private let manualUpdateUIEnabled = false

    let deviceConnectionModel: DeviceConnectionModel
    let updateInstallCoordinator: UpdateInstallCoordinator
    let skillGroupsAuthEnabled: Bool

    @StateObject private var store = SkillsStore()
    @State private var query = ""
    @State private var selectedCreatorHandle: String?
    @State private var selectedId: String?
    @State private var selectedCollectionId: String?
    @State private var activeCollectionListId: String?
    @State private var keyMonitor: Any?
    @State private var sortKey: SortKey = .stars
    @State private var source: Source = .available
    @State private var showDetail = false
    @State private var cachedResults: [Skill] = []
    @State private var cachedInstalledResults: [InstalledSkillDisplayItem] = []
    @State private var selectedSkill: Skill?
    @State private var installedSelectionAnchor: InstalledSkillSelectionResolver.Anchor?
    @State private var displayedReadme: String?
    @State private var isLoadingReadme = false
    @State private var readmeHeight: CGFloat = 200
    @State private var readmeLoadTask: Task<Void, Never>?
    @State private var scrollTargetId: String?
    @State private var updateAvailable = false
    @State private var debouncedQuery = ""
    @State private var showDataUpdatedFooter = false
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
    @State private var isApplyingCreatorFilter = false
    @State private var isApplyingCollectionSelection = false
    @State private var isApplyingCollectionQuery = false
    @State private var activeCollectionsIndex: CollectionsIndexKind?
    @State private var lastTrackedSearchQuery = ""
    @State private var lastTrackedSearchErrorKey = ""
    @State private var lastTrackedOpenedSkillId = ""
    @State private var isSyncPanelPresented = false
    @FocusState private var searchFocused: Bool

    private let detailDescriptionBoxFont: Font = .system(size: 13.5, design: .serif).italic()
    private let tweetDescriptionFont: Font = .body
    private let toolbarSources: [Source] = [.installed, .available]
    private let friendShareText = "I use omgskills.com to find skills and it doesn't suck"
    private let companyCollectionIds: Set<String> = [
        "author-anthropics",
        "author-automattic",
        "author-browser-use",
        "author-clickhouse",
        "author-cloudflare",
        "author-cursor",
        "author-everyinc",
        "author-expo",
        "author-facebook",
        "author-firebase",
        "author-firecrawl",
        "author-flutter",
        "author-getsentry",
        "author-github",
        "author-google-gemini",
        "author-google-labs-code",
        "author-googleworkspace",
        "author-heygen-com",
        "author-higgsfield-ai",
        "author-huggingface",
        "author-langchain-ai",
        "author-lobehub",
        "author-microsoft",
        "author-n8n-io",
        "author-nousresearch",
        "author-openai",
        "author-paperclipai",
        "author-posthog",
        "author-pytorch",
        "author-react",
        "author-shadcn",
        "author-stripe",
        "author-supabase",
        "author-trailofbits",
        "author-vercel",
        "author-vercel-labs",
        "author-warpdotdev"
    ]

    private let starterSearchGroups: [(String, [StarterSearch])] = [
        ("Design + Apps", [
            StarterSearch("Design system", symbol: "paintbrush"),
            StarterSearch("SwiftUI", symbol: "swift"),
            StarterSearch("App Store", symbol: "app.badge"),
            StarterSearch("React", symbol: "atom"),
            StarterSearch("Remotion", symbol: "play.rectangle"),
            StarterSearch("Landing page", symbol: "macwindow")
        ]),
        ("Marketing", [
            StarterSearch("Brand", symbol: "paintpalette"),
            StarterSearch("SEO", symbol: "text.magnifyingglass"),
            StarterSearch("Social media", symbol: "person.2"),
            StarterSearch("Blog", symbol: "text.quote"),
            StarterSearch("Scraping", symbol: "globe"),
            StarterSearch("Market research", symbol: "scope")
        ]),
        ("Coding", [
            StarterSearch("Code review", symbol: "checkmark.seal"),
            StarterSearch("Playwright", symbol: "checklist"),
            StarterSearch("Debugging", symbol: "ladybug"),
            StarterSearch("Security audit", symbol: "lock.shield"),
            StarterSearch("API design", symbol: "point.3.connected.trianglepath.dotted"),
            StarterSearch("Refactoring", symbol: "arrow.triangle.2.circlepath")
        ]),
        ("Practical", [
            StarterSearch("MCP server", symbol: "server.rack"),
            StarterSearch("Deep research", symbol: "doc.text.magnifyingglass"),
            StarterSearch("Humanizer", symbol: "person.crop.circle.badge.checkmark"),
            StarterSearch("Deck", symbol: "rectangle.on.rectangle"),
            StarterSearch("PDF", symbol: "doc.text"),
            StarterSearch("Excel", symbol: "tablecells")
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

    private var queryMatchesSelectedCreator: Bool {
        guard let selectedCreatorHandle else { return false }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.hasPrefix("@") && normalizedCreatorHandle(trimmed) == selectedCreatorHandle
    }

    private var searchQueryForResults: String {
        queryMatchesSelectedCreator ? "" : debouncedQuery
    }

    private var selectedCollection: SkillCollection? {
        guard let selectedCollectionId else { return nil }
        return store.collection(id: selectedCollectionId)
    }
    
    private func computeResults() -> [Skill] {
        if let activeCollectionListId,
           let collection = store.collection(id: activeCollectionListId) {
            return Array(store.allSkills(for: collection).prefix(150))
        }

        let languageFilteredBaseSkills = source == .twitter
            ? baseSkills.filter(\.hasEnglishLikeTweetText)
            : baseSkills
        let creatorFiltered = skillsFilteredBySelectedCreator(languageFilteredBaseSkills)
        let searched = store.search(query: searchQueryForResults, in: creatorFiltered, source: source, usingIndex: source != .installed)
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

    private func computeInstalledResults() -> [InstalledSkillDisplayItem] {
        let matching = store.installedDisplayItems.filter {
            $0.matches(query: searchQueryForResults)
        }
        let sorted: [InstalledSkillDisplayItem] = switch sortKey {
        case .lastUpdated:
            matching.sorted { $0.representative.lastUpdated > $1.representative.lastUpdated }
        case .firstSeen:
            matching.sorted { $0.representative.firstSeen > $1.representative.firstSeen }
        case .trending, .stars, .name:
            matching.sorted {
                let order = $0.displayName.localizedCompare($1.displayName)
                if order != .orderedSame {
                    return order == .orderedAscending
                }
                return $0.id < $1.id
            }
        }
        return Array(sorted.prefix(150))
    }

    private var usesUnifiedInstalledResults: Bool {
        source == .installed && localDashboardFilter == .all
    }

    private var isCollectionsIndexPresented: Bool {
        activeCollectionsIndex != nil
    }

    private var collectionsForActiveIndex: [SkillCollection] {
        guard let activeCollectionsIndex else { return [] }
        switch activeCollectionsIndex {
        case .all:
            return store.collections
        case .creators:
            return store.collections.filter {
                $0.type == .author && !companyCollectionIds.contains($0.id)
            }.sortedByTitle()
        case .companies:
            return store.collections.filter {
                companyCollectionIds.contains($0.id)
            }.sortedByTitle()
        }
    }

    private var visibleResultsAreEmpty: Bool {
        usesUnifiedInstalledResults ? cachedInstalledResults.isEmpty : cachedResults.isEmpty
    }

    private var visibleResultCount: Int {
        usesUnifiedInstalledResults ? cachedInstalledResults.count : cachedResults.count
    }

    var body: some View {
        dataObservedContent
    }

    private var baseContent: some View {
        VStack(spacing: 0) {
            toolbar
            searchField
            Divider()
            masterDetail
        }
        .overlay {
            if skillPendingDelete != nil {
                deleteConfirmationOverlay
            }
        }
        .frame(width: shouldShowDetailPanel ? 750 : 400, height: 855)
        .sheet(isPresented: $isSyncPanelPresented) {
            if skillGroupsAuthEnabled {
                syncPanel
            }
        }
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
            updateSearchFocusAfterOpen()
        }
        .onDisappear {
            captureSessionIfNeeded()
            removeKeyMonitor()
            dataUpdatedTask?.cancel()
            readmeLoadTask?.cancel()
            resetInstallStates()
            showDataUpdatedFooter = false
        }
        .task(id: query) {
            guard !isCollectionsIndexPresented else { return }
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
    }

    private var sessionObservedContent: some View {
        baseContent
        .onReceive(NotificationCenter.default.publisher(for: .popoverDidOpen)) { _ in
            resetTelemetryDedupe()
            Analytics.signal("popover.opened")
            store.refreshInstalled()
            if restoreSessionIfPossible() {
                postDetailVisibility(shouldShowDetailPanel)
            } else {
                resetToDefaultOpenState()
            }
            updateSearchFocusAfterOpen()
        }
        .onReceive(NotificationCenter.default.publisher(for: .libraryDataDidRefresh)) { _ in
            Task {
                await store.reloadLibraryData()
                refreshResults(selectFirst: selectedId == nil)
                if source == .installed {
                    showDataUpdatedFooterIfPossible()
                }
            }
        }
        .onChange(of: query) { _, newValue in
            guard !suppressSessionChangeHandlers else { return }
            guard !isCollectionsIndexPresented else { return }
            if isApplyingCollectionQuery {
                isApplyingCollectionQuery = false
            } else if !newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                selectedCollectionId = nil
                activeCollectionListId = nil
            }
            updateCreatorFilter(forQuery: newValue)
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
    }

    private var dataObservedContent: some View {
        sessionObservedContent
        .onChange(of: sortKey)  { _, _ in
            guard !suppressSessionChangeHandlers else { return }
            refreshResults(selectFirst: true)
            captureSessionIfNeeded()
        }
        .onChange(of: source)   { _, newSource in
            guard !suppressSessionChangeHandlers else { return }
            let applyingCollectionSelection = isApplyingCollectionSelection
            if applyingCollectionSelection {
                isApplyingCollectionSelection = false
            } else {
                selectedCollectionId = nil
                activeCollectionListId = nil
            }
            if isApplyingCreatorFilter {
                isApplyingCreatorFilter = false
            } else if !applyingCollectionSelection {
                selectedCreatorHandle = nil
            }
            if newSource == .installed {
                showDataUpdatedFooterIfPossible()
            } else {
                showDataUpdatedFooter = false
            }
            if source != .installed { localDashboardFilter = nil }
            if source == .trending { sortKey = .trending }
            else if sortKey == .trending { sortKey = .stars }
            refreshResults(selectFirst: true)
            searchFocused = true
            captureSessionIfNeeded()
        }
        .onChange(of: localDashboardFilter) { _, _ in
            guard !suppressSessionChangeHandlers else { return }
            if localDashboardFilter != nil {
                selectedCreatorHandle = nil
            }
            captureSessionIfNeeded()
        }
        .onChange(of: store.searchIndexVersion) { _, _ in
            refreshResults(selectFirst: source != .installed)
        }
        .onChange(of: githubInstallURLText) { _, _ in resetGitHubInstallPromptStatus() }
        .onChange(of: githubInstallCodex) { _, _ in resetGitHubInstallPromptStatus() }
        .onChange(of: githubInstallClaude) { _, _ in resetGitHubInstallPromptStatus() }
        .onReceive(NotificationCenter.default.publisher(for: .updateAvailabilityChanged)) { note in
            updateAvailable = (note.userInfo?["available"] as? Bool) ?? false
        }
    }

    private var syncPanel: some View {
        SkillSyncView(
            connectionModel: deviceConnectionModel,
            updateCoordinator: updateInstallCoordinator,
            installations: store.installedSkillInstallations,
            isReady: store.isInstalledIdentityReady
        )
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

                if source == .twitter || source == .trending || isCollectionsIndexPresented {
                    Button {
                        resetToDefaultOpenState()
                        postDetailVisibility(false)
                        searchFocused = true
                    } label: {
                        Image(systemName: "arrow.left")
                            .font(.system(size: 11))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tertiary)
                    .help("Back")
                }

                Spacer()

                if manualUpdateUIEnabled && updateAvailable {
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
                        Button {
                            if isCollectionsIndexPresented && s == .available {
                                resetToDefaultOpenState()
                                postDetailVisibility(false)
                            } else {
                                activeCollectionsIndex = nil
                                source = s
                            }
                        } label: {
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
        !isCollectionsIndexPresented && !visibleResultsAreEmpty
    }

    private var shouldSelectFirstResult: Bool {
        !(showDetail && (selectedId != nil || selectedCollectionId != nil))
    }

    private var isEmptyStartState: Bool {
        (shouldShowStarterSearches && selectedCollectionId == nil) ||
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
                    selectedCreatorHandle = nil
                    selectedCollectionId = nil
                    activeCollectionListId = nil
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
        } else if let collection = selectedCollection {
            if shouldShowDetailPanel {
                HStack(spacing: 0) {
                    collectionPage(collection)
                        .frame(width: 320)
                    Divider()
                    detailPane
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                collectionPage(collection)
            }
        } else if isCollectionsIndexPresented {
            CollectionsIndexView(
                title: activeCollectionsIndex?.title ?? "Collections",
                collections: collectionsForActiveIndex,
                onOpen: { collection in
                    selectCollection(collection)
                }
            )
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
        } else if source == .installed, localDashboardFilter != nil, visibleResultsAreEmpty {
            localFilteredList
        } else if visibleResultsAreEmpty {
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

    private func collectionPage(_ collection: SkillCollection) -> some View {
        CollectionPageView(
            collection: collection,
            featuredSkills: store.featuredSkills(for: collection),
            selectedSkillId: selectedId,
            onSelectSkill: { skill in
                selectSkillFromCollection(skill)
            },
            onCreatorTap: { handle in
                openAuthorOrFilter(handle)
            },
            onSeeAll: {
                showAllSkills(in: collection)
            },
            onClose: closeCollectionPage
        )
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
        !isCollectionsIndexPresented &&
        source == .available &&
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        activeCollectionListId == nil &&
        selectedCollectionId == nil
    }

    private var shouldShowLocalDashboard: Bool {
        source == .installed &&
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var starterSearchesView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Top Creators")
                        .font(.system(size: 10, weight: .semibold))
                        .fontWeight(.semibold)
                        .foregroundStyle(.tertiary)
                    HStack(alignment: .top, spacing: 8) {
                        trendingStarterButton("Creators", icon: "person.crop.square", action: showCreatorCollections)
                        trendingStarterButton("Companies", icon: "building.2", action: showCompanyCollections)
                    }
                }

                ForEach(starterSearchGroups, id: \.0) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(group.0)
                            .font(.system(size: 10, weight: .semibold))
                            .fontWeight(.semibold)
                            .foregroundStyle(.tertiary)
                        let columns = balancedStarterSearchColumns(group.1)
                        HStack(alignment: .top, spacing: 8) {
                            starterSearchColumn(columns.left)
                            starterSearchColumn(columns.right)
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
                        trendingStarterButton("Collections", icon: "square.grid.2x2", action: showCollections)
                    }
                }

                HStack {
                    NativeShareButton(
                        title: "Send to a friend",
                        systemImage: "square.and.arrow.up",
                        item: friendShareText,
                        style: .plain,
                        help: "Share omgskills",
                        onShareStarted: {
                            Analytics.signal("app.share_started", parameters: [
                                "share_location": "discover_default"
                            ])
                        }
                    )
                    Spacer()
                }
                .padding(.horizontal, 9)
                .offset(y: -12)
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

    private func balancedStarterSearchColumns(_ searches: [StarterSearch]) -> (left: [StarterSearch], right: [StarterSearch]) {
        let leftCount = (searches.count + 1) / 2
        return (
            Array(searches.prefix(leftCount)),
            Array(searches.dropFirst(leftCount))
        )
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
                    logicalSkillCount: store.installedDisplayItems.count,
                    selectedFilter: localDashboardFilter,
                    onSelectFilter: selectLocalDashboardFilter,
                    onSelectRecentSkill: selectRecentInstalledSkill
                )

                if localDashboardFilter != nil {
                    if visibleResultsAreEmpty {
                        emptyView
                    } else {
                        skillsListRows
                    }
                }
            }
            .scrollIndicators(.never)

            if localDashboardFilter == nil {
                if skillGroupsAuthEnabled {
                    Button {
                        store.refreshInstalled()
                        isSyncPanelPresented = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .foregroundStyle(.secondary)
                            Text("Resync")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .font(.system(size: 11, weight: .medium))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 7)
                        .background(Color.primary.opacity(0.055))
                        .clipShape(.rect(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .disabled(!store.isInstalledIdentityReady)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 8)
                    .help("Resync installed skills with the web portal")
                }

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
                if showDataUpdatedFooter {
                    DataUpdatedFooterView(text: dataUpdatedText)
                        .transition(.opacity)
                }
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
                if visibleResultsAreEmpty {
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
            if usesUnifiedInstalledResults {
                ForEach(cachedInstalledResults) { item in
                    InstalledSkillRow(
                        item: item,
                        selectedSkillId: selectedId,
                        onSelectSkill: { skill in
                            selectInstalledSkill(skill, in: item)
                        },
                        onCreatorTap: { handle in
                            openAuthorOrFilter(handle)
                        }
                    )
                    .id(item.id)
                }
            } else {
                ForEach(cachedResults) { skill in
                    SkillRow(
                        skill: skill,
                        selected: skill.id == selectedId,
                        source: source,
                        onSelect: {
                            selectSkillFromRow(skill)
                        },
                        onCreatorTap: { handle in
                            openAuthorOrFilter(handle)
                        }
                    )
                    .id(skill.id)
                    .padding(.bottom, source == .twitter ? 10 : 0)
                }
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
                    // Name + metadata
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        VStack(alignment: .leading, spacing: 6) {
                            skillTitleView(for: skill)
                            detailMetadataLine(for: skill)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .layoutPriority(1)
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

                    // Stats
                    if source == .trending {
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
                    }

                    // Action buttons
                    detailActions(skill)

                    if source == .twitter,
                       let tweetText = skill.tweetText,
                       !tweetText.isEmpty {
                        twitterTweetCard(skill, tweetText: tweetText)
                    }

                    // Full description
                    if !skill.description.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(descriptionParagraphs(skill.description)) { paragraph in
                                Text(paragraph.text)
                                    .lineSpacing(1)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                            .font(detailDescriptionBoxFont)
                            .foregroundStyle(AppUIStyle.detailBodyText)
                            .textSelection(.enabled)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(AppUIStyle.descriptionBoxBackground)
                            )
                            .padding(.bottom, 16)
                    }

                    if isLoadingReadme {
                        ProgressView()
                            .controlSize(.small)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else if let readme = displayedReadme, !readme.isEmpty {
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
    private func skillTitleView(for skill: Skill) -> some View {
        if !skill.githubUrl.isEmpty, let url = URL(string: skill.githubUrl) {
            Button {
                NSWorkspace.shared.open(url)
            } label: {
                skillTitleText(skill.name)
            }
            .buttonStyle(.plain)
            .help("Open GitHub")
        } else {
            skillTitleText(skill.name)
        }
    }

    private func skillTitleText(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 22, weight: .semibold))
            .tracking(-0.2)
            .lineLimit(1)
            .minimumScaleFactor(0.35)
            .allowsTightening(true)
            .truncationMode(.tail)
            .foregroundStyle(AppUIStyle.detailTitleText)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func detailMetadataLine(for skill: Skill) -> some View {
        let hasAttribution = hasDetailAttribution(for: skill)
        let starCount = detailStarCount(for: skill)
        let featuredAuthorCollection = featuredAuthorCollection(for: skill)
        let isFeaturedCreator = featuredAuthorCollection != nil
        let hasUpdatedAge = relativeUpdatedAge(skill.lastUpdated) != nil

        return HStack(spacing: 5) {
            if hasAttribution {
                authorAttributionButton(for: skill, featuredCollection: featuredAuthorCollection)
            }

            if let starCount {
                if hasAttribution {
                    metadataSeparator
                }
                HStack(spacing: 4) {
                    Image(systemName: "star")
                        .font(.system(size: 11))
                    Text(formatCompactCount(starCount))
                }
            }

            if isFeaturedCreator {
                if hasAttribution || starCount != nil {
                    metadataSeparator
                }
                Image(systemName: "crown")
                    .font(.system(size: 11))
                    .accessibilityLabel("Featured creator")
            }

            if hasUpdatedAge {
                if hasAttribution || starCount != nil || isFeaturedCreator {
                    metadataSeparator
                }
                updatedAgeLabel(for: skill)
            }
        }
        .font(.system(size: 12.5))
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }

    private var metadataSeparator: some View {
        Text("•")
            .foregroundStyle(.tertiary)
    }

    private func detailStarCount(for skill: Skill) -> Int? {
        source == .installed ? store.catalogSkill(for: skill)?.stars : skill.stars
    }

    private func featuredAuthorCollection(for skill: Skill) -> SkillCollection? {
        guard !skill.authorHandle.isEmpty else { return nil }
        return store.authorCollection(for: skill.authorHandle)
    }

    @ViewBuilder
    private func updatedAgeLabel(for skill: Skill) -> some View {
        if let updatedAge = relativeUpdatedAge(skill.lastUpdated) {
            Text("Updated \(updatedAge) ago")
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
    }

    private func hasDetailAttribution(for skill: Skill) -> Bool {
        !skill.authorHandle.isEmpty || (skill.discoverAttributionText != nil && source == .available)
    }

    private func installButtonTitle(for target: SkillInstaller.Target, state: SkillInstallState) -> String {
        if case .installed = state {
            return target.rawValue
        }
        return state.buttonTitle(for: target)
    }

    private func installButtonSystemImage(for state: SkillInstallState) -> String {
        if case .installed = state {
            return "checkmark"
        }
        return "square.and.arrow.down"
    }

    @ViewBuilder
    private func detailActions(_ skill: Skill) -> some View {
        if source == .installed {
            let githubURL = skill.githubUrl.isEmpty ? nil : URL(string: skill.githubUrl)
            let shareText = skillShareText(skill)
            let crossInstallTarget = crossInstallTarget(for: skill)
            let actionLayout = InstalledDetailActionLayout(
                showsGitHub: githubURL != nil,
                showsShare: shareText != nil,
                showsCrossInstall: crossInstallTarget != nil
            )

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Button {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: skill.installCmd)])
                    } label: {
                        DetailActionLabel(
                            title: "Open",
                            systemImage: "folder",
                            showsTitle: !actionLayout.usesCompactBookendLabels
                        )
                    }
                    .accessibilityLabel("Open in Finder")
                    .help("Open in Finder")
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    Button {
                        let url = URL(fileURLWithPath: skill.installCmd).appendingPathComponent("SKILL.md")
                        NSWorkspace.shared.open(url)
                    } label: {
                        Label("SKILL.md", systemImage: "doc.text")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    if let crossInstallTarget {
                        Button {
                            crossInstallSkill(skill, target: crossInstallTarget)
                        } label: {
                            Label(
                                crossInstallButtonTitle(for: crossInstallTarget),
                                systemImage: "arrow.triangle.branch"
                            )
                        }
                        .disabled(crossInstallState.isInstalling)
                        .accessibilityLabel(
                            crossInstallAccessibilityLabel(for: skill, target: crossInstallTarget)
                        )
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    Button(role: .destructive) {
                        requestDeleteInstalledSkill(skill)
                    } label: {
                        DetailActionLabel(
                            title: "Delete",
                            systemImage: "trash",
                            showsTitle: !actionLayout.usesCompactBookendLabels
                        )
                    }
                    .accessibilityLabel("Delete installed skill")
                    .help("Delete installed skill")
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    if let githubURL {
                        Button {
                            NSWorkspace.shared.open(githubURL)
                        } label: {
                            Label("GitHub", systemImage: "arrow.up.right")
                        }
                        .buttonStyle(DetailPlainActionButtonStyle())
                        .controlSize(.small)
                        .fixedSize(horizontal: true, vertical: false)
                    }
                    if let shareText {
                        NativeShareButton(
                            title: "Share",
                            systemImage: "square.and.arrow.up",
                            item: shareText,
                            style: .borderless,
                            onShareStarted: {
                                trackSkillShareStarted(skill, location: "detail_actions")
                            }
                        )
                            .frame(height: 21)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }

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
                        Label(
                            installButtonTitle(for: .claude, state: claudeInstallState),
                            systemImage: installButtonSystemImage(for: claudeInstallState)
                        )
                    }
                    .disabled(claudeInstallState.isDisabled)
                    .buttonStyle(DetailInstallButtonStyle(state: claudeInstallState))
                    .controlSize(.small)
                    .accessibilityLabel(installButtonTitle(for: .claude, state: claudeInstallState))
                    .accessibilityHint("Installs this skill as a global Claude skill")

                    Button {
                        installSkill(skill, target: .codex)
                    } label: {
                        Label(
                            installButtonTitle(for: .codex, state: codexInstallState),
                            systemImage: installButtonSystemImage(for: codexInstallState)
                        )
                    }
                    .disabled(codexInstallState.isDisabled)
                    .buttonStyle(DetailInstallButtonStyle(state: codexInstallState))
                    .controlSize(.small)
                    .accessibilityLabel(installButtonTitle(for: .codex, state: codexInstallState))
                    .accessibilityHint("Installs this skill as a global Codex skill")

                    if !skill.githubUrl.isEmpty, let url = URL(string: skill.githubUrl) {
                        Button {
                            NSWorkspace.shared.open(url)
                        } label: {
                            Label("GitHub", systemImage: "arrow.up.right")
                        }
                        .buttonStyle(DetailPlainActionButtonStyle())
                        .controlSize(.small)
                    }
                    if let shareText = skillShareText(skill) {
                        NativeShareButton(
                            title: "Share",
                            systemImage: "square.and.arrow.up",
                            item: shareText,
                            style: .borderless,
                            onShareStarted: {
                                trackSkillShareStarted(skill, location: "detail_actions")
                            }
                        )
                            .frame(height: 21)
                    }
                }

                if let message = claudeInstallState.errorMessage ?? codexInstallState.errorMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
    }

    @ViewBuilder
    private func authorAttributionButton(
        for skill: Skill,
        featuredCollection: SkillCollection? = nil
    ) -> some View {
        if !skill.authorHandle.isEmpty {
            Button {
                openAuthorOrFilter(skill.authorHandle)
            } label: {
                HStack(spacing: 5) {
                    GitHubAvatarView(handle: skill.authorHandle, size: 18)
                    Text("@\(skill.authorHandle)")
                }
                .foregroundStyle(.secondary)
            }
            .font(.system(size: 12.5))
            .buttonStyle(.plain)
            .accessibilityLabel("Show skills by @\(skill.authorHandle)")
            .help("Show skills by @\(skill.authorHandle)")
        } else if let attribution = skill.discoverAttributionText, source == .available {
            Text(attribution)
                    .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
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
                .font(tweetDescriptionFont)
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

    private func descriptionParagraphs(_ text: String) -> [DescriptionParagraph] {
        let normalized = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let explicitParagraphs = normalized
            .components(separatedBy: .newlines)
            .map(cleanDescriptionParagraph)
            .filter { !$0.isEmpty }

        let paragraphs: [String]
        if explicitParagraphs.count > 1 {
            paragraphs = explicitParagraphs
        } else {
            paragraphs = normalized
                .components(separatedBy: ". ")
                .map(cleanDescriptionParagraph)
                .filter { !$0.isEmpty }
                .map { $0.hasSuffix(".") ? $0 : $0 + "." }
        }

        return paragraphs.enumerated().map { index, paragraph in
            DescriptionParagraph(id: "\(index)-\(paragraph)", text: paragraph)
        }
    }

    private func cleanDescriptionParagraph(_ text: String) -> String {
        var cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        for prefix in ["• ", "- ", "* "] where cleaned.hasPrefix(prefix) {
            cleaned.removeFirst(prefix.count)
            return cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return cleaned
    }

    private func relativeUpdatedAge(_ iso: String, now: Date = Date()) -> String? {
        guard let date = parseSkillDate(iso) else { return nil }
        let elapsedDays = max(0, Calendar.current.dateComponents([.day], from: date, to: now).day ?? 0)

        if elapsedDays == 0 { return "today" }
        if elapsedDays < 21 { return "\(elapsedDays)d" }
        if elapsedDays < 56 { return "\(elapsedDays / 7)w" }
        if elapsedDays < 365 { return "\(max(1, elapsedDays / 30))mo" }
        return "\(max(1, elapsedDays / 365))y"
    }

    private func parseSkillDate(_ rawValue: String) -> Date? {
        let isoFormatter = ISO8601DateFormatter()
        if let date = isoFormatter.date(from: rawValue) {
            return date
        }

        let dateOnlyFormatter = DateFormatter()
        dateOnlyFormatter.calendar = Calendar(identifier: .gregorian)
        dateOnlyFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateOnlyFormatter.dateFormat = "yyyy-MM-dd"
        return dateOnlyFormatter.date(from: String(rawValue.prefix(10)))
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

    private func showDataUpdatedFooterIfPossible() {
        guard let date = DataRefreshService.lastDisplayableDataUpdateDate() else { return }
        let age = relativeRefreshAge(from: date)
        dataUpdatedText = age == "now" ? "Data Updated now" : "Data Updated \(age) ago"
        dataUpdatedTask?.cancel()
        withAnimation(.easeInOut(duration: 0.15)) {
            showDataUpdatedFooter = true
        }
        dataUpdatedTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation(.easeInOut(duration: 0.15)) {
                    showDataUpdatedFooter = false
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
        if usesUnifiedInstalledResults {
            guard !cachedInstalledResults.isEmpty else { return }
            let currentIdx = cachedInstalledResults.firstIndex {
                $0.contains(skillId: selectedId) || $0.id == installedSelectionAnchor?.itemId
            } ?? -1
            let nextIdx = max(0, min(cachedInstalledResults.count - 1, currentIdx + delta))
            let item = cachedInstalledResults[nextIdx]
            select(item.representative, scroll: true, installedItem: item)
            return
        }

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
        Task { @MainActor in
            let activity = updateInstallCoordinator.beginActivity(.localCrossInstall)
            defer { activity.finish() }
            do {
                _ = try await Task.detached {
                    try LocalSkillCrossInstaller.install(skill, target: target)
                }.value
                Analytics.signal(crossInstallSignalName(for: target), parameters: analyticsParameters(for: skill, target: target))
                crossInstallState = .idle
                store.refreshInstalled()
                refreshResults(selectFirst: false)
            } catch {
                Analytics.signal("error.copy_failed", parameters: analyticsParameters(for: skill, target: target, error: error))
                crossInstallState = .failed(error.localizedDescription)
                store.refreshInstalled()
            }
        }
    }

    private func deleteInstalledSkill(_ skill: Skill) {
        do {
            try updateInstallCoordinator.withActivity(.localSkillDelete) {
                let result = try InstalledSkillUninstaller.uninstall(skill)
                skillPendingDelete = nil
                deleteError = result.provenanceCleanupWarning
                store.refreshInstalled()
                refreshResults(selectFirst: false)
                if selectedSkill == nil {
                    showDetail = false
                }
            }
        } catch {
            deleteError = error.localizedDescription
            skillPendingDelete = nil
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

    private func installGitHubPromptSkill() {
        guard case .ready(let skill) = githubInstallPromptResolution else { return }
        let targets: [SkillInstaller.Target] = [
            githubInstallCodex ? .codex : nil,
            githubInstallClaude ? .claude : nil
        ].compactMap { $0 }
        guard !targets.isEmpty else { return }

        githubInstallPromptStatus = .installing
        Task { @MainActor in
            let activity = updateInstallCoordinator.beginActivity(.gitHubInstallPrompt)
            defer { activity.finish() }
            do {
                for target in targets {
                    _ = try await Task.detached {
                        try await SkillInstaller.install(skill, target: target)
                    }.value
                    Analytics.signal("skill.installed", parameters: analyticsParameters(for: skill, target: target))
                }
                githubInstallPromptStatus = .success("Installed")
                store.refreshInstalled()
                localDashboardFilter = nil
                refreshResults(selectFirst: false)
            } catch {
                Analytics.signal("error.install_failed", parameters: analyticsParameters(for: skill, error: error))
                githubInstallPromptStatus = .failed(error.localizedDescription)
                store.refreshInstalled()
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
        Task { @MainActor in
            let activity = updateInstallCoordinator.beginActivity(.skillInstall)
            defer { activity.finish() }
            do {
                _ = try await Task.detached {
                    try await SkillInstaller.install(skill, target: target)
                }.value
                guard selectedId == skill.id else { return }
                Analytics.signal("skill.installed", parameters: analyticsParameters(for: skill, target: target))
                setInstallState(.installed, for: target)
                store.refreshInstalled()
            } catch {
                guard selectedId == skill.id else { return }
                Analytics.signal("error.install_failed", parameters: analyticsParameters(for: skill, target: target, error: error))
                setInstallState(.failed(error.localizedDescription), for: target)
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
        activeCollectionsIndex = nil
        selectedCreatorHandle = nil
        selectedCollectionId = nil
        activeCollectionListId = nil
        source = .available
        sortKey = .stars
        showDetail = false
        clearSkillSelection()
        query = term
        debouncedQuery = term
        refreshResults(selectFirst: false)
        searchFocused = true
    }

    private func showTrendingSkills() {
        activeCollectionsIndex = nil
        selectedCreatorHandle = nil
        selectedCollectionId = nil
        activeCollectionListId = nil
        source = .trending
        sortKey = .trending
        localDashboardFilter = nil
        showDetail = false
        clearSkillSelection()
        query = ""
        debouncedQuery = ""
        refreshResults(selectFirst: true)
        searchFocused = true
    }

    private func showTwitterSkills() {
        activeCollectionsIndex = nil
        selectedCreatorHandle = nil
        selectedCollectionId = nil
        activeCollectionListId = nil
        source = .twitter
        sortKey = .stars
        localDashboardFilter = nil
        showDetail = false
        clearSkillSelection()
        query = ""
        debouncedQuery = ""
        refreshResults(selectFirst: true)
        searchFocused = true
    }

    private func showCollections() {
        showCollectionsIndex(.all)
    }

    private func showCreatorCollections() {
        showCollectionsIndex(.creators)
    }

    private func showCompanyCollections() {
        showCollectionsIndex(.companies)
    }

    private func showCollectionsIndex(_ kind: CollectionsIndexKind) {
        selectedCreatorHandle = nil
        selectedCollectionId = nil
        activeCollectionListId = nil
        localDashboardFilter = nil
        showDetail = false
        query = ""
        debouncedQuery = ""
        clearSelection()
        activeCollectionsIndex = kind
        source = .available
        sortKey = .stars
        searchFocused = false
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
            selectedId: selectedId,
            installedSelectionAnchor: usesUnifiedInstalledResults ? installedSelectionAnchor : nil
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
        if usesUnifiedInstalledResults {
            cachedResults = []
            cachedInstalledResults = computeInstalledResults()
            guard let resolution = InstalledSkillSelectionResolver.resolve(
                items: cachedInstalledResults,
                selectedSkillId: session.selectedId,
                anchor: session.installedSelectionAnchor
            ) else {
                savedSession = nil
                showDetail = false
                clearSelection()
                return false
            }
            selectedId = nil
            installedSelectionAnchor = nil
            select(
                resolution.skill,
                scroll: true,
                installedItem: resolution.item
            )
        } else {
            cachedInstalledResults = []
            cachedResults = computeResults()
            guard let skill = cachedResults.first(where: { $0.id == session.selectedId }) else {
                savedSession = nil
                showDetail = false
                clearSelection()
                return false
            }
            selectedId = nil
            installedSelectionAnchor = nil
            select(skill, scroll: true)
        }
        showDetail = true
        savedSession = PopoverSessionState(
            source: source,
            sortKey: sortKey,
            query: query,
            debouncedQuery: debouncedQuery,
            localDashboardFilter: localDashboardFilter,
            selectedId: selectedId ?? session.selectedId,
            installedSelectionAnchor: installedSelectionAnchor
        )
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
        activeCollectionsIndex = nil
        query = ""
        selectedCreatorHandle = nil
        selectedCollectionId = nil
        activeCollectionListId = nil
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

    private func updateSearchFocusAfterOpen() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            searchFocused = !shouldShowDetailPanel && !isCollectionsIndexPresented
        }
    }

    // MARK: - Selection

    private func normalizedCreatorHandle(_ rawHandle: String) -> String {
        var handle = rawHandle.trimmingCharacters(in: .whitespacesAndNewlines)
        while handle.hasPrefix("@") {
            handle.removeFirst()
        }
        return handle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func skillsFilteredBySelectedCreator(_ skills: [Skill]) -> [Skill] {
        guard let selectedCreatorHandle else { return skills }
        return skills.filter { normalizedCreatorHandle($0.authorHandle) == selectedCreatorHandle }
    }

    private func updateCreatorFilter(forQuery newValue: String) {
        guard let selectedCreatorHandle else { return }
        let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.hasPrefix("@") || normalizedCreatorHandle(trimmed) != selectedCreatorHandle {
            self.selectedCreatorHandle = nil
        }
    }

    private func filterByCreator(_ rawHandle: String) {
        let handle = normalizedCreatorHandle(rawHandle)
        guard !handle.isEmpty else { return }

        activeCollectionsIndex = nil
        selectedCollectionId = nil
        activeCollectionListId = nil
        if source != .installed {
            if source != .available {
                isApplyingCreatorFilter = true
            }
            source = .available
        }
        localDashboardFilter = nil
        selectedCreatorHandle = handle
        query = "@\(handle)"
        debouncedQuery = query
        refreshResults(selectFirst: true)
        searchFocused = true
    }

    private func openAuthorOrFilter(_ rawHandle: String) {
        let handle = normalizedCreatorHandle(rawHandle)
        guard !handle.isEmpty else { return }
        if let collection = store.authorCollection(for: handle) {
            selectCollection(collection, showAuthorQuery: true)
        } else {
            filterByCreator(handle)
        }
    }

    private func selectCollection(_ collection: SkillCollection, showAuthorQuery: Bool = false) {
        activeCollectionListId = nil
        selectedId = nil
        selectedSkill = nil
        displayedReadme = nil
        isLoadingReadme = false
        deleteError = nil
        crossInstallState = .idle
        readmeHeight = 200
        resetInstallStates()
        readmeLoadTask?.cancel()
        selectedCollectionId = collection.id
        if source != .available {
            isApplyingCollectionSelection = true
        }
        source = .available
        localDashboardFilter = nil
        if showAuthorQuery, let authorHandle = collection.authorHandle {
            let handle = normalizedCreatorHandle(authorHandle)
            selectedCreatorHandle = handle
            isApplyingCollectionQuery = true
            query = "@\(handle)"
            debouncedQuery = query
        } else {
            selectedCreatorHandle = nil
            query = ""
            debouncedQuery = ""
        }
        showDetail = false
    }

    private func showAllSkills(in collection: SkillCollection) {
        switch collection.type {
        case .author:
            if let authorHandle = collection.authorHandle {
                filterByCreator(authorHandle)
            }
        case .topic:
            activeCollectionsIndex = nil
            selectedCollectionId = nil
            activeCollectionListId = collection.id
            selectedCreatorHandle = nil
            if source != .available {
                isApplyingCollectionSelection = true
            }
            source = .available
            sortKey = .stars
            localDashboardFilter = nil
            query = ""
            debouncedQuery = ""
            showDetail = false
            cachedInstalledResults = []
            cachedResults = Array(store.allSkills(for: collection).prefix(150))
            clearSkillSelection()
            searchFocused = true
        }
    }

    private func selectSkillFromRow(_ skill: Skill) {
        select(skill, scroll: false)
        withAnimation(.easeInOut(duration: 0.15)) {
            showDetail = true
        }
    }

    private func selectInstalledSkill(_ skill: Skill, in item: InstalledSkillDisplayItem) {
        select(skill, scroll: false, installedItem: item)
        withAnimation(.easeInOut(duration: 0.15)) {
            showDetail = true
        }
    }

    private func selectSkillFromCollection(_ skill: Skill) {
        select(skill, scroll: false, preserveCollection: true)
        withAnimation(.easeInOut(duration: 0.15)) {
            showDetail = true
        }
    }

    private func closeCollectionPage() {
        let returnsToCollectionsIndex = isCollectionsIndexPresented
        selectedCollectionId = nil
        activeCollectionListId = nil
        selectedCreatorHandle = nil
        query = ""
        debouncedQuery = ""
        showDetail = false
        clearSelection()
        if returnsToCollectionsIndex {
            cachedResults = []
            cachedInstalledResults = []
            searchFocused = false
        } else {
            resetResultsForStarterState()
            searchFocused = true
        }
    }

    private func refreshResults(selectFirst: Bool) {
        if isCollectionsIndexPresented {
            cachedResults = []
            cachedInstalledResults = []
            return
        }

        if selectedCollectionId != nil {
            cachedResults = []
            cachedInstalledResults = []
            return
        }

        if shouldShowStarterSearches ||
            (source == .installed &&
             localDashboardFilter == nil &&
             query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
            resetResultsForStarterState()
            return
        }

        if usesUnifiedInstalledResults {
            let shouldSelectFirst = selectFirst && showDetail
            cachedResults = []
            cachedInstalledResults = computeInstalledResults()
            if shouldSelectFirst, let firstItem = cachedInstalledResults.first {
                select(firstItem.representative, scroll: false, installedItem: firstItem)
            } else if showDetail,
                      let resolution = InstalledSkillSelectionResolver.resolve(
                items: cachedInstalledResults,
                selectedSkillId: selectedId,
                anchor: installedSelectionAnchor
            ) {
                select(
                    resolution.skill,
                    scroll: false,
                    installedItem: resolution.item
                )
            } else {
                clearSkillSelection()
            }
            return
        }

        cachedInstalledResults = []
        installedSelectionAnchor = nil
        cachedResults = computeResults()
        let shouldSelectFirst = selectFirst &&
            showDetail &&
            !(source == .twitter && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        if shouldSelectFirst {
            select(cachedResults.first, scroll: false)
        } else if showDetail,
                  let selectedId,
                  let skill = cachedResults.first(where: { $0.id == selectedId }) {
            selectedSkill = skill
        } else {
            clearSkillSelection()
        }
    }

    private func resetResultsForStarterState() {
        cachedResults = []
        cachedInstalledResults = []
        selectedCreatorHandle = nil
        selectedCollectionId = nil
        activeCollectionListId = nil
        selectedId = nil
        selectedSkill = nil
        installedSelectionAnchor = nil
        displayedReadme = nil
        isLoadingReadme = false
        resetInstallStates()
        readmeLoadTask?.cancel()
    }

    private func selectLocalDashboardFilter(_ filter: LocalDashboardFilter) {
        if localDashboardFilter == filter {
            selectedCreatorHandle = nil
            selectedCollectionId = nil
            activeCollectionListId = nil
            localDashboardFilter = nil
            showDetail = false
            query = ""
            debouncedQuery = ""
            clearSelection()
            resetResultsForStarterState()
            searchFocused = true
            return
        }
        selectedCreatorHandle = nil
        selectedCollectionId = nil
        activeCollectionListId = nil
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
        selectedCreatorHandle = nil
        selectedCollectionId = nil
        activeCollectionListId = nil
        localDashboardFilter = .all
        showDetail = true
        query = ""
        debouncedQuery = ""
        cachedResults = []
        cachedInstalledResults = computeInstalledResults()
        if let item = cachedInstalledResults.first(where: { $0.contains(skillId: skill.id) }) {
            select(skill, scroll: true, installedItem: item)
        } else {
            select(skill, scroll: true)
        }
        searchFocused = true
    }

    private func clearSelection() {
        selectedCollectionId = nil
        clearSkillSelection()
    }

    private func clearSkillSelection() {
        selectedId = nil
        selectedSkill = nil
        installedSelectionAnchor = nil
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

    private func select(
        _ skill: Skill?,
        scroll: Bool,
        preserveCollection: Bool = false,
        installedItem: InstalledSkillDisplayItem? = nil
    ) {
        let nextInstalledSelectionAnchor = installedItem?.selectionAnchor
        if selectedId == skill?.id {
            selectedSkill = skill
            installedSelectionAnchor = nextInstalledSelectionAnchor
            if scroll {
                scrollTargetId = installedItem?.id ?? skill?.id
            }
            return
        }
        if !preserveCollection {
            selectedCollectionId = nil
        }
        selectedId = skill?.id
        selectedSkill = skill
        installedSelectionAnchor = nextInstalledSelectionAnchor
        displayedReadme = nil
        isLoadingReadme = false
        deleteError = nil
        crossInstallState = .idle
        readmeHeight = 200
        resetInstallStates()
        readmeLoadTask?.cancel()

        if scroll {
            scrollTargetId = installedItem?.id ?? skill?.id
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
            "result_count": "\(visibleResultCount)"
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

    private func trackSkillShareStarted(_ skill: Skill, location: String) {
        var parameters = analyticsParameters(for: skill)
        parameters["share_location"] = location
        Analytics.signal("skill.share_started", parameters: parameters)
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
    var showsCreator = true
    let onSelect: () -> Void
    let onCreatorTap: (String) -> Void
    private let tweetPostedAgeWidth: CGFloat = 30
    private let trailingMetricWidth: CGFloat = 60

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if source == .twitter {
                HStack(alignment: .top, spacing: 6) {
                    Button(action: onSelect) {
                        TwitterSkillContextView(skill: skill, selected: selected)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 2)
                    Spacer(minLength: 4)
                    Text(relativeTweetPostedAt(skill.tweetPostedAt) ?? "")
                        .font(.caption)
                        .foregroundStyle(rowTertiaryColor)
                        .monospacedDigit()
                        .frame(width: tweetPostedAgeWidth, alignment: .trailing)
                    HStack(spacing: 4) {
                        Image(systemName: "heart")
                        Text(formatCompactCount(skill.tweetLikes ?? 0))
                    }
                    .font(.caption)
                    .foregroundStyle(rowTertiaryColor)
                    .monospacedDigit()
                    .frame(width: trailingMetricWidth, alignment: .leading)
                }

                HStack(spacing: 6) {
                    rowTextButton(skill.name, font: .headline, color: rowPrimaryColor, lineLimit: 1)
                    creatorButton
                    Spacer(minLength: 4)
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                        Text(formatCompactCount(skill.stars))
                    }
                    .font(.caption)
                    .foregroundStyle(rowSecondaryColor)
                    .monospacedDigit()
                    .frame(width: trailingMetricWidth, alignment: .leading)
                }
            } else {
                HStack(spacing: 6) {
                    rowTextButton(skill.name, font: .headline, color: rowPrimaryColor, lineLimit: 1)
                    creatorButton
                    Spacer(minLength: 4)
                    if source == .available {
                        HStack(spacing: 4) {
                            Image(systemName: "star.fill")
                            Text(formatCompactCount(skill.stars))
                        }
                        .font(.caption)
                        .foregroundStyle(rowSecondaryColor)
                        .monospacedDigit()
                        .frame(width: trailingMetricWidth, alignment: .leading)
                    } else if source == .trending {
                        HStack(spacing: 4) {
                            Image(systemName: "star.fill")
                            Text(formatCompactCount(skill.installs ?? 0))
                        }
                        .font(.caption)
                        .foregroundStyle(rowSecondaryColor)
                        .monospacedDigit()
                        .frame(width: trailingMetricWidth, alignment: .leading)
                    } else if let origin = skill.origin, origin != "Agents" {
                        SkillOriginBadge(origin: origin, selected: selected)
                    }
                }
                rowTextButton(skill.description, font: .system(size: 10), color: rowDescriptionColor, lineLimit: 2, fillWidth: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(selected ? AppUIStyle.activeBlue : .clear)
        )
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
    }

    private func rowTextButton(_ text: String, font: Font, color: Color, lineLimit: Int, fillWidth: Bool = false) -> some View {
        Button(action: onSelect) {
            Text(text)
                .font(font)
                .foregroundStyle(color)
                .lineLimit(lineLimit)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: fillWidth ? .infinity : nil, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var creatorButton: some View {
        if showsCreator, !skill.authorHandle.isEmpty {
            Button {
                onCreatorTap(skill.authorHandle)
            } label: {
                Text("@\(skill.authorHandle)")
                    .font(.caption)
                    .foregroundStyle(rowTertiaryColor)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Show all skills by @\(skill.authorHandle)")
            .help("Show all skills by @\(skill.authorHandle)")
        } else if showsCreator, source == .available, let attribution = skill.discoverAttributionText {
            Text(attribution.replacingOccurrences(of: "via ", with: ""))
                .font(.caption)
                .foregroundStyle(rowTertiaryColor)
                .lineLimit(1)
        }
    }

    private var rowPrimaryColor: Color {
        selected ? AppUIStyle.selectedPrimaryText : .primary
    }

    private var rowSecondaryColor: Color {
        selected ? AppUIStyle.selectedSecondaryText : .secondary
    }

    private var rowTertiaryColor: Color {
        selected ? AppUIStyle.selectedTertiaryText : Color(nsColor: .tertiaryLabelColor)
    }

    private var rowDescriptionColor: Color {
        selected ? AppUIStyle.selectedSecondaryText : AppUIStyle.feedDescriptionText
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

private func relativeTweetPostedAt(_ rawValue: String?) -> String? {
    guard let rawValue,
          let date = parseTweetPostedAt(rawValue) else {
        return nil
    }

    let seconds = max(0, Int(Date().timeIntervalSince(date)))
    if seconds < 60 { return "now" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h" }
    return "\(hours / 24)d"
}

private func parseTweetPostedAt(_ rawValue: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: rawValue) {
        return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: rawValue)
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

private struct DetailInstallButtonStyle: ButtonStyle {
    let state: SkillInstallState

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: NSFont.systemFontSize(for: .small), weight: .medium))
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, 12)
            .frame(height: 21)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(backgroundColor.opacity(configuration.isPressed ? 0.82 : 1))
            )
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private var foregroundColor: Color {
        if case .installed = state {
            return .secondary
        }
        return .white
    }

    private var backgroundColor: Color {
        if case .installed = state {
            return Color.primary.opacity(0.08)
        }
        return AppUIStyle.activeBlue
    }
}

private struct DetailPlainActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: NSFont.systemFontSize(for: .small), weight: .medium))
            .foregroundStyle(.primary)
            .padding(.horizontal, 8)
            .frame(height: 21)
            .opacity(configuration.isPressed ? 0.65 : 1)
            .contentShape(Rectangle())
    }
}

private struct NativeShareButton: NSViewRepresentable {
    enum Style {
        case bordered
        case borderless
        case plain
    }

    let title: String
    let systemImage: String
    let item: String
    var style: Style = .bordered
    var help: String?
    var onShareStarted: (() -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(item: item, onShareStarted: onShareStarted)
    }

    func makeNSView(context: Context) -> NSButton {
        let button = NSButton(title: "", target: context.coordinator, action: #selector(Coordinator.share(_:)))
        button.image = NSImage(systemSymbolName: systemImage, accessibilityDescription: title)
        button.imagePosition = .imageLeading
        button.imageHugsTitle = style != .bordered
        button.controlSize = .small
        button.bezelStyle = .rounded
        button.isBordered = style == .bordered
        configureTitle(for: button)
        context.coordinator.configureShine(for: button, title: title, style: style)
        button.toolTip = help
        button.setContentHuggingPriority(.required, for: .horizontal)
        button.setContentHuggingPriority(.required, for: .vertical)
        button.setContentCompressionResistancePriority(.required, for: .horizontal)
        button.setContentCompressionResistancePriority(.required, for: .vertical)
        button.setAccessibilityLabel(title)
        return button
    }

    func updateNSView(_ button: NSButton, context: Context) {
        context.coordinator.item = item
        context.coordinator.onShareStarted = onShareStarted
        button.image = NSImage(systemSymbolName: systemImage, accessibilityDescription: title)
        button.imageHugsTitle = style != .bordered
        button.isBordered = style == .bordered
        configureTitle(for: button)
        context.coordinator.configureShine(for: button, title: title, style: style)
        button.toolTip = help
        button.invalidateIntrinsicContentSize()
        button.setAccessibilityLabel(title)
    }

    private func configureTitle(for button: NSButton) {
        let font = NSFont.systemFont(
            ofSize: style == .plain ? 11 : NSFont.systemFontSize(for: .small),
            weight: style == .borderless ? .medium : .regular
        )
        button.font = font
        switch style {
        case .plain:
            button.contentTintColor = .tertiaryLabelColor
            let titleAttributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: NSColor.tertiaryLabelColor
            ]
            let spacer = NSMutableAttributedString(string: " ", attributes: titleAttributes)
            spacer.append(NSAttributedString(string: title, attributes: titleAttributes))
            button.attributedTitle = spacer
        case .borderless:
            button.contentTintColor = .labelColor
            button.title = title
        case .bordered:
            button.contentTintColor = nil
            button.title = title
        }
    }

    final class Coordinator: NSObject {
        var item: String
        var onShareStarted: (() -> Void)?
        private var picker: NSSharingServicePicker?
        private var closeTask: Task<Void, Never>?
        private weak var shineButton: NSButton?
        private var shineTimer: Timer?
        private var shineIndex = 0
        private var shineTitle = ""

        init(item: String, onShareStarted: (() -> Void)?) {
            self.item = item
            self.onShareStarted = onShareStarted
        }

        deinit {
            closeTask?.cancel()
            shineTimer?.invalidate()
        }

        @MainActor
        func configureShine(for button: NSButton, title: String, style: Style) {
            guard style == .plain,
                  NSWorkspace.shared.accessibilityDisplayShouldReduceMotion == false else {
                stopShine()
                return
            }

            shineButton = button
            shineTitle = title
            applyShineTitle(title, to: button)
            guard shineTimer == nil else { return }

            shineTimer = Timer.scheduledTimer(
                timeInterval: 0.18,
                target: self,
                selector: #selector(updateShine),
                userInfo: nil,
                repeats: true
            )
        }

        @MainActor
        private func stopShine() {
            shineTimer?.invalidate()
            shineTimer = nil
            shineButton = nil
            shineTitle = ""
            shineIndex = 0
        }

        @MainActor @objc private func updateShine() {
            guard let shineButton else { return }
            shineIndex = (shineIndex + 1) % max(shineTitle.count + 5, 1)
            applyShineTitle(shineTitle, to: shineButton)
        }

        @MainActor
        private func applyShineTitle(_ title: String, to button: NSButton) {
            let font = NSFont.systemFont(ofSize: 11)
            let text = " \(title)"
            let baseColor = NSColor.tertiaryLabelColor
            let shineColor = NSColor.secondaryLabelColor
            let attributed = NSMutableAttributedString(
                string: text,
                attributes: [
                    .font: font,
                    .foregroundColor: baseColor
                ]
            )

            let titleStart = 1
            let titleLength = title.count
            for offset in 0..<3 {
                let rawIndex = shineIndex - offset
                guard rawIndex >= 0, rawIndex < titleLength else { continue }
                attributed.addAttribute(
                    .foregroundColor,
                    value: shineColor,
                    range: NSRange(location: titleStart + rawIndex, length: 1)
                )
            }

            button.attributedTitle = attributed
        }

        @MainActor @objc func share(_ sender: NSButton) {
            closeTask?.cancel()
            onShareStarted?()
            NotificationCenter.default.post(name: .sharePickerDidOpen, object: nil)
            NSApp.activate(ignoringOtherApps: true)
            let picker = NSSharingServicePicker(items: [item])
            self.picker = picker
            picker.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
            scheduleClose()
        }

        @MainActor private func scheduleClose() {
            closeTask?.cancel()
            closeTask = Task { @MainActor in
                try? await Task.sleep(for: .seconds(8))
                picker = nil
                NotificationCenter.default.post(name: .sharePickerDidClose, object: nil)
            }
        }
    }
}
