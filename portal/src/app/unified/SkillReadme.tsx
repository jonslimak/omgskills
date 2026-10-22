import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { SkillDisplay } from "./model";
import { PublicReadmeClient, publicReadmeId, type SkillReadme as Readme } from "./public-readme";

const MarkdownBody = lazy(() => import("./ReadmeMarkdown"));
const publicClient = new PublicReadmeClient();
type State = { id: string; status: "loading" | "ready" | "error"; readme: Readme | null };

// An optional renderer/chunk failure must not take down the skill's ordinary details.
class ReadmeRenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p className="ua-muted" role="status">README preview unavailable.</p> : this.props.children;
  }
}

export function SkillReadme({ skill, client = publicClient }: { skill: SkillDisplay; client?: PublicReadmeClient }) {
  const id = publicReadmeId(skill);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ id: "", status: "loading", readme: null });
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState({ id, status: "loading", readme: null });
    void client.load(id, controller.signal).then(readme => {
      if (!controller.signal.aborted) setState({ id, status: "ready", readme });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ id, status: "error", readme: null });
    });
    return () => controller.abort();
  }, [id, client, revision]);

  if (!id) return null;
  const current = state.id === id ? state : { id, status: "loading", readme: null };
  if (current.status === "ready" && !current.readme) return null;
  return <section className="ua-readme" aria-label="Repository README" aria-busy={current.status === "loading"}>
    <h3>README</h3>
    {current.status === "loading" ? <p className="ua-muted" role="status">Loading README...</p>
      : current.status === "error" ? <div className="ua-readme-error">
        <p className="ua-muted" role="status">README unavailable.</p>
        <button className="ua-icon" type="button" title="Retry README" aria-label="Retry README" onClick={() => setRevision(value => value + 1)}><RefreshCw /></button>
      </div> : current.readme && <>
        <ReadmeRenderBoundary key={`${id}:${revision}`}>
          <Suspense fallback={<p className="ua-muted" role="status">Loading README...</p>}>
            <MarkdownBody markdown={current.readme.markdown} sourceUrl={current.readme.sourceUrl} />
          </Suspense>
        </ReadmeRenderBoundary>
        {current.readme.truncated && <p className="ua-muted">README preview shortened.</p>}
        <a className="ua-link" href={current.readme.sourceUrl} target="_blank" rel="noopener noreferrer">View full README <ArrowUpRight /></a>
      </>}
  </section>;
}
