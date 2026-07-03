import SwiftUI

struct CollectionCard: View {
    let collection: SkillCollection
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 10) {
                CollectionAvatarView(collection: collection, size: 30)

                VStack(alignment: .leading, spacing: 2) {
                    Text(collection.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(collection.subtitle)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 6)

                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(collection.title), \(collection.subtitle)")
        .accessibilityHint("Opens this collection")
        .help("Open \(collection.title)")
    }
}

struct CollectionPageView: View {
    let collection: SkillCollection
    let featuredSkills: [Skill]
    let onSelectSkill: (Skill) -> Void
    let onCreatorTap: (String) -> Void
    let onSeeAll: () -> Void
    let onClose: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                if let description = collection.description, !description.isEmpty {
                    Text(description)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }

                Button(action: onSeeAll) {
                    Label(seeAllTitle, systemImage: "arrow.right")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityHint("Shows every skill in this collection")

                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    Text("Featured")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.tertiary)

                    if featuredSkills.isEmpty {
                        Text("No matching skills found")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    } else {
                        LazyVStack(spacing: 0) {
                            ForEach(featuredSkills) { skill in
                                SkillRow(
                                    skill: skill,
                                    selected: false,
                                    source: .available,
                                    onSelect: { onSelectSkill(skill) },
                                    onCreatorTap: onCreatorTap
                                )
                            }
                        }
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                CollectionAvatarView(collection: collection, size: 72)

                VStack(alignment: .leading, spacing: 5) {
                    Text("Collection")
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundStyle(.tertiary)
                    Text(collection.title)
                        .font(.system(size: 28, weight: .bold))
                        .lineLimit(2)
                    Text(collection.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer()

                Button("Close", systemImage: "arrow.left.to.line.compact", action: onClose)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .frame(width: 24, height: 24)
                    .contentShape(Circle())
                    .help("Close")
            }

            Divider()
        }
        .accessibilityElement(children: .combine)
    }

    private var seeAllTitle: String {
        switch collection.type {
        case .author:
            return "See all by @\(collection.authorHandle ?? collection.title)"
        case .topic:
            return "See all"
        }
    }
}

struct CollectionAvatarView: View {
    let collection: SkillCollection
    let size: CGFloat

    var body: some View {
        AsyncImage(url: imageURL) { phase in
            switch phase {
            case .empty:
                fallback
                    .redacted(reason: .placeholder)
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            case .failure:
                fallback
            @unknown default:
                fallback
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)
    }

    private var imageURL: URL? {
        if let imageUrl = collection.imageUrl,
           let url = URL(string: imageUrl) {
            return url
        }
        if collection.type == .author,
           let authorHandle = collection.authorHandle {
            return URL(string: "https://github.com/\(authorHandle).png")
        }
        return nil
    }

    private var fallback: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(.quaternary.opacity(0.6))
            .overlay {
                Image(systemName: collection.type == .author ? "person.crop.square" : "square.grid.2x2")
                    .font(.system(size: size * 0.42))
                    .foregroundStyle(.secondary)
            }
    }
}
