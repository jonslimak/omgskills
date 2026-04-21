import SwiftUI
import WebKit

struct ReadmeWebView: NSViewRepresentable {
    let markdown: String
    @Binding var height: CGFloat

    func makeCoordinator() -> Coordinator { Coordinator(height: $height) }

    func makeNSView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "heightBridge")

        let config = WKWebViewConfiguration()
        config.userContentController = controller

        let webView = PassthroughWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedMarkdown != markdown else { return }
        context.coordinator.loadedMarkdown = markdown
        webView.loadHTMLString(html(for: markdown), baseURL: nil)
    }

    private static let markedJS: String = {
        guard let url = Bundle.module.url(forResource: "marked.min", withExtension: "js"),
              let src = try? String(contentsOf: url) else { return "" }
        return src
    }()

    // MARK: - HTML template

    private func html(for markdown: String) -> String {
        let escaped = markdown
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "`", with: "\\`")
            .replacingOccurrences(of: "$", with: "\\$")
        return """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <style>\(css)</style>
        </head>
        <body>
        <div id="root"></div>
        <script>\(Self.markedJS)</script>
        <script>
          marked.use({ breaks: true, gfm: true });
          document.getElementById('root').innerHTML = marked.parse(`\(escaped)`);
          function reportHeight() {
            window.webkit.messageHandlers.heightBridge.postMessage(document.documentElement.scrollHeight);
          }
          // Report after parse + after layout settles
          reportHeight();
          requestAnimationFrame(reportHeight);
        </script>
        </body>
        </html>
        """
    }

    private var css: String { """
        :root {
          --text: #1c1c1e;
          --muted: rgba(0,0,0,0.5);
          --code-bg: rgba(0,0,0,0.06);
          --pre-bg: rgba(0,0,0,0.04);
          --border: rgba(0,0,0,0.1);
          --link: #007AFF;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --text: rgba(255,255,255,0.85);
            --muted: rgba(255,255,255,0.45);
            --code-bg: rgba(255,255,255,0.1);
            --pre-bg: rgba(255,255,255,0.06);
            --border: rgba(255,255,255,0.1);
            --link: #0A84FF;
          }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 13px;
          line-height: 1.6;
          color: var(--text);
          background: transparent;
          word-wrap: break-word;
          overflow: hidden;
        }
        h1,h2,h3,h4,h5,h6 { font-weight: 600; line-height: 1.3; margin: 10px 0 4px; }
        h1 { font-size: 17px; } h2 { font-size: 15px; } h3 { font-size: 13px; }
        h4,h5,h6 { font-size: 12px; }
        p { margin: 5px 0; }
        a { color: var(--link); text-decoration: none; }
        a:hover { text-decoration: underline; }
        code {
          font-family: "SF Mono", Menlo, monospace;
          font-size: 11.5px;
          background: var(--code-bg);
          padding: 1px 4px;
          border-radius: 4px;
        }
        pre {
          background: var(--pre-bg);
          border-radius: 6px;
          padding: 10px 12px;
          overflow-x: auto;
          margin: 6px 0;
        }
        pre code { background: none; padding: 0; }
        ul, ol { padding-left: 18px; margin: 4px 0; }
        li { margin: 2px 0; }
        blockquote {
          border-left: 3px solid var(--border);
          padding-left: 10px;
          margin: 6px 0;
          color: var(--muted);
        }
        hr { border: none; border-top: 1px solid var(--border); margin: 10px 0; }
        img { display: none; }
        table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0; }
        th, td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; }
        th { background: var(--code-bg); font-weight: 600; }
        [align="center"] { text-align: center; }
    """ }

    // MARK: - Passthrough scroll

    private class PassthroughWebView: WKWebView {
        override func scrollWheel(with event: NSEvent) {
            nextResponder?.scrollWheel(with: event)
        }
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var loadedMarkdown: String?
        private var height: Binding<CGFloat>

        init(height: Binding<CGFloat>) { self.height = height }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            if let h = message.body as? CGFloat {
                Task { @MainActor in
                    self.height.wrappedValue = max(h, 20)
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript("document.documentElement.scrollHeight") { result, _ in
                if let h = result as? CGFloat, h > 0 {
                    Task { @MainActor in
                        self.height.wrappedValue = h
                    }
                }
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .linkActivated, let url = action.request.url {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }
    }
}
