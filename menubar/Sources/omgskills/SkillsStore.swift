import Foundation

@MainActor
final class SkillsStore: ObservableObject {
    @Published private(set) var availableSkills: [Skill] = []
    @Published private(set) var installedSkills: [Skill] = []
    @Published private(set) var loadError: String?
    private(set) var searchIndex: SkillSearchIndex?

    init() { load() }

    func load() {
        loadAvailable()
        loadInstalled()
    }

    func refresh() { load() }

    func search(query: String, in pool: [Skill], usingIndex: Bool = true) -> [Skill] {
        if usingIndex {
            return searchIndex?.search(query: query, in: pool) ?? pool
        }
        return linearSearch(query: query, in: pool)
    }

    // MARK: - Private

    private func loadAvailable() {
        guard let url = Bundle.main.url(forResource: "skills", withExtension: "json") else {
            loadError = "skills.json not found in app bundle"
            return
        }
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let skills = try decoder.decode([Skill].self, from: data)
            availableSkills = skills.sorted { $0.stars > $1.stars }
            loadError = nil
            buildIndex(for: availableSkills)
        } catch {
            loadError = "Failed to decode skills.json: \(error)"
        }
    }

    private func loadInstalled() {
        installedSkills = InstalledSkillsScanner.scan()
    }

    private func linearSearch(query: String, in skills: [Skill]) -> [Skill] {
        let terms = query.lowercased().split(separator: " ").map(String.init)
        guard !terms.isEmpty else { return skills }
        return skills.filter { skill in
            let blob = "\(skill.name) \(skill.description) \(skill.authorHandle) \(skill.tags.joined(separator: " "))".lowercased()
            return terms.allSatisfy { blob.contains($0) }
        }
    }

    private func buildIndex(for skills: [Skill]) {
        Task { [weak self] in
            do {
                let index = try await Task.detached(priority: .userInitiated) {
                    try SkillSearchIndex(skills: skills)
                }.value
                self?.searchIndex = index
            } catch {
                print("[SkillsStore] FTS index build failed: \(error)")
            }
        }
    }
}
