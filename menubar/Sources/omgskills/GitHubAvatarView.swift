import SwiftUI

enum GitHubAvatar {
    static let requestSize = 96

    static func url(for handle: String) -> URL? {
        let trimmedHandle = handle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedHandle.isEmpty else { return nil }

        var components = URLComponents()
        components.scheme = "https"
        components.host = "github.com"
        components.path = "/\(trimmedHandle).png"
        components.queryItems = [URLQueryItem(name: "size", value: String(requestSize))]
        return components.url
    }
}

struct GitHubAvatarView: View {
    let handle: String
    let size: CGFloat

    var body: some View {
        AsyncImage(url: GitHubAvatar.url(for: handle)) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            case .empty:
                fallback
                    .redacted(reason: .placeholder)
            case .failure:
                fallback
            @unknown default:
                fallback
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var fallback: some View {
        Circle()
            .fill(.quaternary.opacity(0.6))
            .overlay {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.5))
                    .foregroundStyle(.secondary)
            }
    }
}
