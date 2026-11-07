import Foundation

/// Which cloud save record each skill on this Mac uses. The server applies the same rule (cloud-skill-keys.ts),
/// and this Mac also remembers each skill's key, so adding or removing other skills never moves it.
enum CloudSaveKeys {
    /// A saved skill: its key, its SKILL.md name as cloud save compares it (nil when saved before names were
    /// kept), and the Mac that saved its current version.
    struct Record: Codable, Equatable, Sendable {
        let key: String
        let name: String?
        var deviceID: String? = nil
    }

    /// Longest cloud save key the server takes.
    static let maxKeyLength = 200

    /// The keys a skill in this folder may use, in order: the folder name, then "<folder>@<agent>", "<folder>@<agent>-2", …
    static func candidate(folder: String, agent: String, index: Int) -> String {
        guard index > 0 else { return folder }
        let suffix = "@\(agent)" + (index > 1 ? "-\(index)" : "")
        // Whole code points within the server's limit, which counts UTF-16 units.
        var base = String.UnicodeScalarView()
        var length = suffix.utf16.count
        for scalar in folder.unicodeScalars {
            length += scalar.utf16.count
            guard length <= maxKeyLength else { break }
            base.append(scalar)
        }
        return String(base) + suffix
    }

    static func folderKey(of skill: Skill) -> String {
        CloudSaveFolder.key(forFolderName: URL(fileURLWithPath: skill.installCmd).lastPathComponent)
    }

    static func nameKey(of skill: Skill) -> String {
        let name = CloudSaveFolder.key(forFolderName: skill.name)
        return name.isEmpty ? folderKey(of: skill) : name
    }

    /// Whether a key is one of this folder's candidates, including ones whose folder part was cut to fit.
    private static func belongs(_ key: String, to folder: String) -> Bool {
        if key == folder || key.hasPrefix(folder + "@") { return true }
        guard let at = key.lastIndex(of: "@") else { return false }
        var agent = String(key[key.index(after: at)...]), index = 1
        if let dash = agent.lastIndex(of: "-"), dash != agent.startIndex {
            let digits = agent[agent.index(after: dash)...]
            if !digits.isEmpty, digits.allSatisfy({ ("0"..."9").contains($0) }), let number = Int(digits) {
                index = number
                agent = String(agent[..<dash])
            }
        }
        return candidate(folder: folder, agent: agent, index: index) == key
    }

    /// Keyed by `installCmd`. A skill's key is its folder name, unless that key holds a different skill. Then:
    /// 1. The key this Mac remembers for the skill, while no other skill holds it. The Mac that saved a key
    ///    last may keep it under a new name (its SKILL.md name was edited).
    /// 2. A saved skill with the same SKILL.md name under this folder's keys (its folder name first).
    /// 3. Otherwise, skills in same-name folders are told apart by SKILL.md name. The one named like its folder
    ///    chooses first (else the one in the first agent alphabetically), and each takes the first key no other
    ///    skill holds: the folder name, then "<folder>@<its first agent>", then "-2", "-3"…
    static func keys(for installations: [Skill], records: [Record] = [], remembered: [String: String] = [:],
                     deviceID: String? = nil) -> [String: String] {
        var keys: [String: String] = [:]
        /// Keys given out in this pass, with the name of the skill holding each.
        var claimed: [String: String] = [:]
        var recordNames: [String: String] = [:]
        var recordDevices: [String: String] = [:]
        for record in records {
            if let name = record.name { recordNames[record.key] = name }
            if let device = record.deviceID { recordDevices[record.key] = device }
        }
        let ordered = installations.sorted { a, b in
            let (folderA, folderB) = (folderKey(of: a), folderKey(of: b))
            let (nameA, nameB) = (nameKey(of: a), nameKey(of: b))
            if (nameA == folderA) != (nameB == folderB) { return nameA == folderA }
            let (agentA, agentB) = ((a.origin ?? "").lowercased(), (b.origin ?? "").lowercased())
            if agentA != agentB { return agentA < agentB }
            return nameA != nameB ? nameA < nameB : a.installCmd < b.installCmd
        }
        // 1. Remembered keys.
        for skill in ordered {
            let folder = folderKey(of: skill), name = nameKey(of: skill)
            guard !folder.isEmpty, let key = remembered[skill.installCmd], belongs(key, to: folder),
                  claimed[key] == nil || claimed[key] == name else { continue }
            let mayRename = deviceID != nil && recordDevices[key] == deviceID
            guard recordNames[key] == nil || recordNames[key] == name || mayRename else { continue }
            keys[skill.installCmd] = key
            claimed[key] = name
        }
        // 2. Saved skills found by name.
        for skill in ordered where keys[skill.installCmd] == nil {
            let folder = folderKey(of: skill), name = nameKey(of: skill)
            guard !folder.isEmpty else { continue }
            let saved = records.filter { $0.name == name && belongs($0.key, to: folder) && (claimed[$0.key] ?? name) == name }
                .map(\.key).sorted { a, b in a == folder || (b != folder && a < b) }.first
            if let saved { keys[skill.installCmd] = saved; claimed[saved] = name }
        }
        // 3. The rest, by folder.
        var groups: [String: [Skill]] = [:]
        var order: [String] = []
        for skill in ordered where keys[skill.installCmd] == nil {
            let folder = folderKey(of: skill)
            if folder.isEmpty { keys[skill.installCmd] = folder; continue }
            if groups[folder] == nil { order.append(folder) }
            groups[folder, default: []].append(skill)
        }
        for folder in order {
            // In preference order already, so each name's first copy decides its agent.
            var names: [String] = []
            var agents: [String: String] = [:]
            var copies: [String: [Skill]] = [:]
            for skill in groups[folder] ?? [] {
                let name = nameKey(of: skill)
                if copies[name] == nil { names.append(name) }
                copies[name, default: []].append(skill)
                let agent = (skill.origin ?? "").lowercased()
                agents[name] = min(agents[name] ?? agent, agent)
            }
            for name in names {
                var index = 0
                var key = folder
                while true {
                    key = candidate(folder: folder, agent: agents[name] ?? "", index: index)
                    let holder = claimed[key] ?? recordNames[key]
                    if holder == nil || holder == name { break }
                    index += 1
                }
                claimed[key] = name
                for copy in copies[name] ?? [] { keys[copy.installCmd] = key }
            }
        }
        return keys
    }

    // MARK: Remembered keys

    nonisolated static var defaultRecord: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("omgskills/cloud-save-keys.json")
    }

    /// What the last cloud save pass knew: each skill folder's key (by path) and the account's saved skills.
    struct Memory: Codable, Equatable {
        var keys: [String: String] = [:]
        var records: [Record] = []
    }

    static func remembered(at url: URL? = defaultRecord) -> Memory {
        guard let url, let data = try? Data(contentsOf: url),
              let memory = try? JSONDecoder().decode(Memory.self, from: data) else { return Memory() }
        return memory
    }

    static func remember(_ memory: Memory, at url: URL? = defaultRecord) {
        guard let url else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(memory).write(to: url, options: .atomic)
    }

    /// Keys for skills here outside a cloud save pass (restore, install, delete): the remembered ones, else the
    /// rule with the account's saved skills (`records` when just read, else the ones the last pass saw).
    static func current(for installations: [Skill], records: [Record]? = nil, at url: URL? = defaultRecord) -> [String: String] {
        let memory = remembered(at: url)
        return keys(for: installations, records: records ?? memory.records, remembered: memory.keys)
    }

    /// The account's saved skills as the key rule reads them.
    static func records(from state: CloudSaveState) -> [Record] {
        state.skills.map { Record(key: $0.key, name: $0.name, deviceID: $0.currentVersion.deviceId) }
    }
}
