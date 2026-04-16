import Foundation

@MainActor
final class SkillsStore: ObservableObject {
    @Published private(set) var availableSkills: [Skill] = []
    @Published private(set) var installedSkills: [Skill] = []
    @Published private(set) var loadError: String?

    init() {
        load()
    }

    func load() {
        loadAvailable()
        loadInstalled()
    }

    func refresh() {
        load()
    }

    private func loadAvailable() {
        guard let url = Bundle.main.url(forResource: "skills", withExtension: "json") else {
            loadError = "skills.json not found in app bundle"
            return
        }
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            availableSkills = try decoder.decode([Skill].self, from: data)
            loadError = nil
        } catch {
            loadError = "Failed to decode skills.json: \(error.localizedDescription)"
        }
    }

    private func loadInstalled() {
        installedSkills = InstalledSkillsScanner.scan()
    }
}
