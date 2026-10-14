import Foundation

struct CatalogInstallRequest: Equatable, Sendable {
    let catalogID: String
    let target: SkillInstaller.Target

    enum Client: String, Sendable {
        case f1 = "omgskills-f1"
        case setupTest = "omgskills-setup-test"
        case product = "omgskills"
    }

    enum RequestError: Error { case invalid }

    init(url: URL, client: Client) throws {
        guard url.absoluteString.utf8.count <= 4096,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == client.rawValue, components.host == "catalog-install",
              components.user == nil, components.password == nil, components.port == nil,
              components.fragment == nil, components.path.isEmpty,
              let items = components.queryItems, items.count == 3,
              Set(items.map(\.name)) == Set(["v", "id", "agent"]),
              items.first(where: { $0.name == "v" })?.value == "1",
              let id = items.first(where: { $0.name == "id" })?.value,
              Self.validID(id),
              let agent = items.first(where: { $0.name == "agent" })?.value,
              ["claude", "codex"].contains(agent)
        else { throw RequestError.invalid }
        catalogID = id
        target = agent == "claude" ? .claude : .codex
    }

    static func validID(_ id: String) -> Bool {
        !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && id.utf8.count <= 500
            && !id.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0)
                || $0.properties.generalCategory == .format }
    }
}
