import Darwin
import Foundation

public enum InstallAgent: String, CaseIterable, Sendable, Identifiable {
    case codex, claude
    public var id: String { rawValue }
    public var title: String { self == .codex ? "Codex" : "Claude Code" }
    var directory: String { self == .codex ? ".agents" : ".claude" }
}

package struct UserInstallHome: Sendable {
    let url: URL
    let storeID: String
    static let storePath = "Library/Application Support/OMGSkills Helper"
    var storeURL: URL { url.appendingPathComponent(Self.storePath) }

    package static func simulated(in sandbox: InstallSandbox) throws -> Self {
        _ = try sandbox.open().userChild("home", create: true)
        return try Self(home: sandbox.url.appendingPathComponent("home"))
    }

    package static func currentUser() throws -> Self {
        // Only the OS account home is trusted for canonicalization; never a URL or environment path.
        guard let entry = getpwuid(getuid()), let path = entry.pointee.pw_dir,
              let canonical = realpath(path, nil) else { throw InstallFailure.unsafeRoot }
        defer { free(canonical) }
        return try Self(home: URL(fileURLWithPath: String(cString: canonical)))
    }

    private init(home: URL) throws {
        url = home
        let base = try SandboxDirectory.absolute(home)
        try base.userDirectory()
        let support = try base.userChild("Library", create: true).userChild("Application Support", create: true)
        let created = mkdirat(support.fd, "OMGSkills Helper", 0o700) == 0
        guard created || errno == EEXIST else { throw InstallFailure.io }
        let root = try support.child("OMGSkills Helper")
        if created {
            let marker = Marker(schema: 1, owner: Self.owner, id: UUID().uuidString, home: home.path)
            try root.write("store.json", data: JSONEncoder().encode(marker))
        }
        storeID = try Self.marker(root, home: home).id
    }

    func open() throws -> SandboxDirectory {
        let base = try SandboxDirectory.absolute(url)
        try base.userDirectory()
        let root = try base.userChild("Library").userChild("Application Support").child("OMGSkills Helper")
        guard try Self.marker(root, home: url).id == storeID else { throw InstallFailure.invalidRecord }
        return root
    }

    func target(_ agent: InstallAgent, name: String) throws -> SandboxDirectory {
        let base = try SandboxDirectory.absolute(url)
        try base.userDirectory()
        if agent == .codex, try base.info(".codex") != nil {
            let legacy = try base.userChild(".codex")
            if try legacy.info("skills") != nil {
                let skills = try legacy.userChild("skills")
                guard try skills.info(name) == nil else { throw InstallFailure.unmanaged }
            }
        }
        return try base.userChild(agent.directory, create: true).userChild("skills", create: true)
    }

    static let owner = "omgskills-standalone-helper"
    private struct Marker: Codable { let schema: Int; let owner: String; let id: String; let home: String }
    private static func marker(_ root: SandboxDirectory, home: URL) throws -> Marker {
        let (data, mode) = try root.read("store.json", limit: 4096)
        guard mode == 0o600, let marker = try? JSONDecoder().decode(Marker.self, from: data),
              marker.schema == 1, marker.owner == owner, marker.home == home.path,
              UUID(uuidString: marker.id)?.uuidString == marker.id else { throw InstallFailure.invalidRecord }
        return marker
    }
}

package enum InstallLocation: Sendable {
    case sandbox(InstallSandbox)
    case user(UserInstallHome, InstallAgent, policy: InstallPolicy = .publicSkills)

    var id: String { switch self { case .sandbox(let root): root.id; case .user(let home, _, _): home.storeID } }
    var owner: String { switch self { case .sandbox: "omgskills-handoff-test"; case .user: UserInstallHome.owner } }
    var schema: Int { switch self { case .sandbox: 1; case .user: 2 } }
    var policy: InstallPolicy { switch self { case .user(_, _, let policy): policy; case .sandbox: .publicSkills } }
    var targetName: String { policy.targetName }
    var target: String {
        switch self {
        case .sandbox: SandboxInstaller.target
        case .user(let home, let agent, _):
            home.url.appendingPathComponent("\(agent.directory)/skills/\(targetName)").path
        }
    }
    var destination: String {
        switch self { case .sandbox(let root): root.url.appendingPathComponent(target).path; case .user: target }
    }
    private var linkPrefix: String {
        switch self {
        case .sandbox: "../../.managed/versions/"
        case .user(let home, let agent, _): home.storeURL.appendingPathComponent("\(agent.rawValue)/versions").path + "/"
        }
    }
    func link(_ version: String) -> String { linkPrefix + version + "/content" }
    func versionID(from link: String) throws -> String {
        guard link.hasPrefix(linkPrefix), link.hasSuffix("/content") else { throw InstallFailure.unmanaged }
        let id = String(link.dropFirst(linkPrefix.count).dropLast("/content".count))
        guard UUID(uuidString: id)?.uuidString == id else { throw InstallFailure.unmanaged }
        return id
    }
    func open() throws -> SandboxDirectory {
        switch self { case .sandbox(let root): try root.open(); case .user(let home, _, _): try home.open() }
    }
    func directories(_ root: SandboxDirectory) throws -> (SandboxDirectory, SandboxDirectory) {
        switch self {
        case .sandbox:
            return try (root.child(".managed", create: true).child("versions", create: true),
                        root.child("codex", create: true).child("skills", create: true))
        case .user(let home, let agent, _):
            let target = try home.target(agent, name: targetName)
            return try (root.child(agent.rawValue, create: true).child("versions", create: true), target)
        }
    }

    func recheck(root: SandboxDirectory, versions: SandboxDirectory, target: SandboxDirectory) throws {
        let reopened = try open()
        let (currentVersions, currentTarget) = try directories(reopened)
        guard try root.sameDirectory(as: reopened), try versions.sameDirectory(as: currentVersions),
              try target.sameDirectory(as: currentTarget) else { throw InstallFailure.staleReview }
    }
}
