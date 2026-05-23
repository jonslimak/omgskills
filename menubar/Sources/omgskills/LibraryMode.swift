import Foundation

enum LibraryMode: String, CaseIterable, Identifiable {
    case production
    case shadow

    var id: String { rawValue }

    var label: String {
        switch self {
        case .production: return "Production"
        case .shadow: return "Shadow"
        }
    }

    var shortLabel: String {
        switch self {
        case .production: return "Prod"
        case .shadow: return "Shadow"
        }
    }
}
