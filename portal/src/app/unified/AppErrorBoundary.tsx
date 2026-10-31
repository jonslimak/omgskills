import { Component, type CSSProperties, type ReactNode } from "react";

// Inline, so the screen still works if the app's stylesheet is what failed.
const screen: CSSProperties = { maxWidth: 480, margin: "15vh auto", padding: "0 16px", font: "16px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif" };

// A render error anywhere in the app shows a way out instead of a blank page. On a static
// library page the app root is still hidden until it is ready, so the static page stays.
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("omgskills app error", error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main style={screen} role="alert">
        <h1>Something went wrong</h1>
        <p>omgskills hit an unexpected error. Reloading usually fixes it.</p>
        <p>
          <button type="button" onClick={() => location.reload()}>Reload</button>{" "}
          <a href="https://omgskills.com/support/">Get help</a>
        </p>
      </main>
    );
  }
}
