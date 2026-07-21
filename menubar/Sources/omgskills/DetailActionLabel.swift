import SwiftUI

struct DetailActionLabel: View {
    let title: String
    let systemImage: String
    let showsTitle: Bool

    var body: some View {
        if showsTitle {
            Label(title, systemImage: systemImage)
        } else {
            Label(title, systemImage: systemImage)
                .labelStyle(.iconOnly)
        }
    }
}
