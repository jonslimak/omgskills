import Foundation

enum AppRuntimeConfiguration {
    static let bundledLibraryPreviewKey = "OMGSkillsBundledLibraryPreview"

    static var usesBundledLibraryPreview: Bool {
        usesBundledLibraryPreview(infoDictionary: Bundle.main.infoDictionary ?? [:])
    }

    static func usesBundledLibraryPreview(
        infoDictionary: [String: Any]
    ) -> Bool {
        infoDictionary[bundledLibraryPreviewKey] as? Bool == true
    }
}
