import Foundation

public enum HelperIdentity {
    public static let bundleID = "com.omgskills.helper"
    public static let scheme = "omgskills-helper"
    public static let name = "OMGSkills Helper"

    public static func verify(bundleID: String?, currentPID: Int32, runningPIDs: [Int32]) throws {
        guard bundleID == self.bundleID else { throw HelperLaunchFailure.invalidBundle }
        guard !runningPIDs.contains(where: { $0 != currentPID }) else { throw HelperLaunchFailure.otherCopy }
    }
}

public enum HelperLaunchFailure: LocalizedError, Equatable {
    case invalidBundle, otherCopy

    public var errorDescription: String? {
        switch self {
        case .invalidBundle: "Open the OMGSkills Helper app bundle. This executable cannot run on its own."
        case .otherCopy: "Another copy of OMGSkills Helper is running. Quit the extra copy and reopen the link."
        }
    }
}
