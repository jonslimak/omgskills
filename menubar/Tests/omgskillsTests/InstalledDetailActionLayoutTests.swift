import Testing
@testable import omgskills

struct InstalledDetailActionLayoutTests {
    @Test func fiveActionsKeepAllTitles() {
        let layout = InstalledDetailActionLayout(
            showsGitHub: true,
            showsShare: true,
            showsCrossInstall: false
        )

        #expect(layout.visibleActionCount == 5)
        #expect(!layout.usesCompactBookendLabels)
    }

    @Test func sixActionsCompactBookendTitles() {
        let layout = InstalledDetailActionLayout(
            showsGitHub: true,
            showsShare: true,
            showsCrossInstall: true
        )

        #expect(layout.visibleActionCount == 6)
        #expect(layout.usesCompactBookendLabels)
    }
}
