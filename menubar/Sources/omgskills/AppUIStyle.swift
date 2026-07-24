import AppKit
import SwiftUI

enum AppUIStyle {
    static let activeBlue = Color(nsColor: .systemBlue)
    static let selectedPrimaryText = Color.white
    static let selectedSecondaryText = Color.white.opacity(0.78)
    static let selectedTertiaryText = Color.white.opacity(0.62)
    static let detailTitleText = Color(nsColor: .dynamicColor(light: .hex(0x1D1D1F), dark: .labelColor))
    static let detailBodyText = Color(
        nsColor: .dynamicColor(
            light: .hex(0x3A3A3C),
            dark: .white.withAlphaComponent(0.85)
        )
    )
    static let descriptionBoxBackground = Color(
        nsColor: .dynamicColor(
            light: .hex(0xF7F7F7),
            dark: .white.withAlphaComponent(0.055)
        )
    )
}

extension NSColor {
    static func hex(_ value: UInt32, alpha: CGFloat = 1) -> NSColor {
        NSColor(
            calibratedRed: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: alpha
        )
    }

    static func dynamicColor(light: NSColor, dark: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            appearance.isDarkMode ? dark : light
        }
    }
}

private extension NSAppearance {
    var isDarkMode: Bool {
        bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }
}
