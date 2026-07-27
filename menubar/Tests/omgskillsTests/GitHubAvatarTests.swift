import Testing
@testable import omgskills

struct GitHubAvatarTests {
    @Test
    func buildsSizedGitHubAvatarURL() {
        #expect(
            GitHubAvatar.url(for: "openai")?.absoluteString
                == "https://github.com/openai.png?size=96"
        )
    }

    @Test
    func trimsHandleWhitespace() {
        #expect(
            GitHubAvatar.url(for: "  OpenAI \n")?.absoluteString
                == "https://github.com/OpenAI.png?size=96"
        )
    }

    @Test
    func rejectsEmptyHandle() {
        #expect(GitHubAvatar.url(for: " \n ") == nil)
    }
}
