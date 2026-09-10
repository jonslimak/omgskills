import Foundation

enum AppIncomingURL: Equatable, Sendable {
    case group(DeviceGroupManifestRoute)
    case pairing(URL)
    case unsupported
}

enum GroupInstallDeepLink {
    static func classify(_ url: URL) -> AppIncomingURL {
        if let route = route(from: url) {
            return .group(route)
        }
        if url.scheme?.lowercased() == BrowserPairing.callbackScheme,
           url.host?.lowercased() == "pair" {
            return .pairing(url)
        }
        return .unsupported
    }

    static func route(from url: URL) -> DeviceGroupManifestRoute? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "omgskills",
              components.host?.lowercased() == "group",
              components.path.isEmpty,
              components.fragment == nil,
              components.user == nil,
              components.password == nil,
              components.port == nil else {
            return nil
        }

        let queryItems = components.queryItems ?? []
        guard queryItems.count == 1,
              queryItems[0].name == "url",
              let rawPublicURL = queryItems[0].value,
              let publicURL = URL(string: rawPublicURL),
              let publicComponents = URLComponents(url: publicURL, resolvingAgainstBaseURL: false),
              publicComponents.scheme?.lowercased() == "https",
              publicComponents.host?.lowercased() == "omgskills.com",
              publicComponents.user == nil,
              publicComponents.password == nil,
              publicComponents.port == nil,
              publicComponents.query == nil,
              publicComponents.fragment == nil else {
            return nil
        }

        let parts = publicComponents.path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count == 4,
              parts[0] == "u",
              parts[2] == "sets",
              !publicComponents.path.hasSuffix("/") else {
            return nil
        }
        return try? DeviceGroupManifestRoute(
            handle: String(parts[1]),
            groupSlug: String(parts[3])
        )
    }
}
