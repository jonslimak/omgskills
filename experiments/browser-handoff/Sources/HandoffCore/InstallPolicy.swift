import Foundation

package struct InstallPolicy: Sendable {
    package let targetName: String
    package let permitsRemoval: Bool
    package let accepts: @Sendable (InstallCandidate) throws -> Bool

    package init(targetName: String, permitsRemoval: Bool = false,
                 accepts: @escaping @Sendable (InstallCandidate) throws -> Bool) {
        precondition(!targetName.isEmpty && targetName != "." && targetName != ".."
                     && targetName.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0)
                         || (97...122).contains($0) || [45, 46, 95].contains($0) })
        self.targetName = targetName
        self.permitsRemoval = permitsRemoval
        self.accepts = accepts
    }

    package static let publicSkills = InstallPolicy(targetName: "frontend-design") {
        [HandoffRequest.pinnedTestSkillID, HandoffRequest.testSkillID].contains($0.pin.id)
    }
}
