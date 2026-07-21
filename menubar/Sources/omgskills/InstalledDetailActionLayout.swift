struct InstalledDetailActionLayout: Equatable, Sendable {
    let showsGitHub: Bool
    let showsShare: Bool
    let showsCrossInstall: Bool

    var visibleActionCount: Int {
        3 + [showsGitHub, showsShare, showsCrossInstall].count(where: { $0 })
    }

    var usesCompactBookendLabels: Bool {
        visibleActionCount > 5
    }
}
