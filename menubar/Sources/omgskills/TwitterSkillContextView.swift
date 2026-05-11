import SwiftUI
import AppKit

struct TwitterSkillContextView: View {
    let skill: Skill

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                XTwitterLogoView(size: 12)

                Text(authorLabel)
                    .foregroundStyle(.blue)
                    .lineLimit(1)
                    .font(.headline)
                    .fontWeight(.regular)
            }

            if let tweetText = skill.tweetText, !tweetText.isEmpty {
                Text(tweetText)
                    .font(.system(size: 10))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    private var authorLabel: String {
        if let handle = skill.tweetAuthorHandle, !handle.isEmpty {
            return "@\(handle)"
        }
        if let name = skill.tweetAuthorName, !name.isEmpty {
            return name
        }
        return "X"
    }

    private var accessibilityLabel: String {
        if let tweetText = skill.tweetText, !tweetText.isEmpty {
            return "Tweet by \(authorLabel): \(tweetText)"
        }
        return "Tweet by \(authorLabel)"
    }
}

struct XTwitterLogoView: View {
    let size: CGFloat

    var body: some View {
        if let iconImage = Self.iconImage {
            Image(nsImage: iconImage)
                .resizable()
                .interpolation(.high)
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }

    private static let iconImage: NSImage? = {
        guard let url = AppResource.url(forResource: "x-twitter-logo-block", withExtension: "png") else {
            return nil
        }
        return NSImage(contentsOf: url)
    }()
}
