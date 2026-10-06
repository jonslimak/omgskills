import Foundation

public struct HandoffRequest: Equatable, Sendable {
    public let skillID: String
    public let skillName: String

    public static let testScheme = "omgskills-helper-test"
    public static let testSkillID = "anthropics/skills:skills/frontend-design"
    public static let pinnedTestSkillID = "anthropics/claude-plugins-public:frontend-design"

    public static func parse(_ rawURL: String, discoveryOnly: Bool = false) -> HandoffRequest? {
        guard rawURL.utf8.count <= 512,
              rawURL.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
              validPercentEncoding(rawURL),
              let url = URLComponents(string: rawURL),
              url.scheme == testScheme,
              url.host == "install",
              url.user == nil,
              url.password == nil,
              url.port == nil,
              url.path.isEmpty || url.path == "/",
              url.fragment == nil,
              url.queryItems?.count == 1,
              let item = url.queryItems?.first,
              item.name == "id",
              let skillID = item.value,
              (discoveryOnly ? [DiscoveryFixture.id] : [testSkillID, pinnedTestSkillID]).contains(skillID) else {
            return nil
        }

        return HandoffRequest(skillID: skillID, skillName: discoveryOnly ? "OMGSkills discovery check" : "Frontend Design")
    }

    private static func validPercentEncoding(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        for index in bytes.indices where bytes[index] == 37 {
            guard index + 2 < bytes.count,
                  isHex(bytes[index + 1]),
                  isHex(bytes[index + 2]) else {
                return false
            }
        }
        return true
    }

    private static func isHex(_ byte: UInt8) -> Bool {
        (48...57).contains(byte) || (65...70).contains(byte) || (97...102).contains(byte)
    }
}
