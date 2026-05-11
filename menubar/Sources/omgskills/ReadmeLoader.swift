import CryptoKit
import Foundation

enum ReadmeLoader {
    static func load(for skill: Skill) async -> String? {
        if let cached = cachedReadme(for: skill) {
            return cached
        }

        guard let rawBaseURL = rawBaseURL(for: skill) else { return nil }
        let names = ["README.md", "README.mdx", "README.txt", "README"]

        for branch in ["main", "master"] {
            for name in names {
                guard !Task.isCancelled else { return nil }
                let url = rawBaseURL.appending(path: branch).appending(path: name)
                if let markdown = await fetchMarkdown(from: url) {
                    writeCache(markdown, for: skill)
                    return markdown
                }
            }
        }
        return nil
    }

    private static func rawBaseURL(for skill: Skill) -> URL? {
        guard let repoURL = URL(string: skill.githubUrl),
              repoURL.host?.contains("github.com") == true else {
            return nil
        }

        let parts = repoURL.pathComponents.filter { $0 != "/" }
        guard parts.count >= 2 else { return nil }
        let owner = parts[0]
        let repo = parts[1].replacingOccurrences(of: ".git", with: "")

        return URL(string: "https://raw.githubusercontent.com")!
            .appending(path: owner)
            .appending(path: repo)
    }

    private static func fetchMarkdown(from url: URL) async -> String? {
        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = 12
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let markdown = String(data: data, encoding: .utf8),
                  !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return nil
            }
            return String(markdown.prefix(20_000))
        } catch {
            return nil
        }
    }

    private static func cachedReadme(for skill: Skill) -> String? {
        let url = cacheURL(for: skill)
        return try? String(contentsOf: url, encoding: .utf8)
    }

    private static func writeCache(_ markdown: String, for skill: Skill) {
        do {
            let url = cacheURL(for: skill)
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try markdown.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            print("[ReadmeLoader] Cache write failed: \(error)")
        }
    }

    private static func cacheURL(for skill: Skill) -> URL {
        applicationSupportDirectory()
            .appending(path: "readmes", directoryHint: .isDirectory)
            .appending(path: cacheKey(for: skill) + ".md")
    }

    private static func cacheKey(for skill: Skill) -> String {
        let data = Data(skill.id.utf8)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func applicationSupportDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appending(path: "omgskills", directoryHint: .isDirectory)
    }
}
