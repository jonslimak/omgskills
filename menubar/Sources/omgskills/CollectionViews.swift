import SwiftUI

struct CollectionsIndexView: View {
    let title: String
    let collections: [SkillCollection]
    let onOpen: (SkillCollection) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.tertiary)

                if collections.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "square.grid.2x2")
                            .font(.title2)
                            .foregroundStyle(.tertiary)
                        Text("No collections available")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
                    .accessibilityElement(children: .combine)
                } else {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 5) {
                        ForEach(collections) { collection in
                            CollectionCard(collection: collection) {
                                onOpen(collection)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 18)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollIndicators(.never)
    }
}

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
    let selectedSkillId: String?
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

                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Featured")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundStyle(.tertiary)

                        Spacer()

                        Button("See all", action: onSeeAll)
                            .buttonStyle(.plain)
                            .font(.caption)
                            .foregroundStyle(AppUIStyle.activeBlue)
                            .accessibilityLabel(seeAllTitle)
                            .accessibilityHint("Shows every skill in this collection")
                    }
                    .frame(maxWidth: .infinity)

                    if featuredSkills.isEmpty {
                        Text("No matching skills found")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    } else {
                        LazyVStack(spacing: 0) {
                            ForEach(featuredSkills) { skill in
                                SkillRow(
                                    skill: skill,
                                    selected: skill.id == selectedSkillId,
                                    source: .available,
                                    showsCreator: false,
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
                    Text(collection.title)
                        .font(.system(size: 28, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .allowsTightening(true)
                    Text(collection.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer()

                Button(action: onClose) {
                    Image(systemName: "arrow.left")
                        .font(.system(size: 11))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tertiary)
                    .help("Close")
            }
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
        if let imageURL {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .empty:
                    Color.clear
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    Color.clear
                @unknown default:
                    Color.clear
                }
            }
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityHidden(true)
        }
    }

    private var imageURL: URL? {
        if let imageUrl = collection.imageUrl,
           let url = URL(string: imageUrl) {
            return url
        }
        if collection.type == .author,
           let authorHandle = collection.authorHandle {
            return GitHubAvatar.url(for: authorHandle)
        }
        return nil
    }

}
