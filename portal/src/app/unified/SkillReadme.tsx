import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { SkillDisplay } from "./model";
import { PublicReadmeClient, publicReadmeId, readmeBrowseUrl, readmeTitle, type SkillDocuments } from "./public-readme";

const MarkdownBody = lazy(() => import("./ReadmeMarkdown"));
const publicClient = new PublicReadmeClient();
type State = { id: string; status: "loading" | "ready" | "error"; docs: SkillDocuments | null };
type Tab = "skill" | "readme";
// The chosen tab carries over to the next skill opened in this session.
let preferredTab: Tab = "skill";

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
  const [tab, setTab] = useState<Tab>(preferredTab);
  const [state, setState] = useState<State>({ id: "", status: "loading", docs: null });
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState({ id, status: "loading", docs: null });
    void client.load(id, controller.signal).then(docs => {
      if (!controller.signal.aborted) setState({ id, status: "ready", docs });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ id, status: "error", docs: null });
    });
    return () => controller.abort();
  }, [id, client, revision]);

  if (!id) return null;
  const current = state.id === id ? state : { id, status: "loading", docs: null };
  if (current.status === "ready" && !current.docs) return null;
  const docs = current.docs;
  const both = !!docs?.skill && !!docs?.readme;
  // Show the chosen tab when it exists, otherwise whichever document the skill has.
  const shown = docs ? (tab === "readme" ? docs.readme ?? docs.skill : docs.skill ?? docs.readme) : null;
  const kind = shown?.kind;
  const title = kind ? readmeTitle(id, kind) : "Skill";
  const choose = (next: Tab) => { preferredTab = next; setTab(next); };
  return <section className="ua-readme" aria-label={title} aria-busy={current.status === "loading"}>
    {both ? <div className="ua-readme-tabs" role="tablist" aria-label="Skill documentation">
      {(["skill", "readme"] as const).map(value => <button key={value} type="button" role="tab"
        aria-selected={(shown?.kind === "skill") === (value === "skill")} onClick={() => choose(value)}>
        {value === "skill" ? "Skill" : "README"}
      </button>)}
    </div> : <h3>{title}</h3>}
    {current.status === "loading" ? <p className="ua-muted" role="status">Loading...</p>
      : current.status === "error" ? <div className="ua-readme-error">
        <p className="ua-muted" role="status">Skill details unavailable.</p>
        <button className="ua-icon" type="button" title="Retry" aria-label="Retry loading skill details" onClick={() => setRevision(value => value + 1)}><RefreshCw /></button>
      </div> : shown && <div role={both ? "tabpanel" : undefined}>
        <ReadmeRenderBoundary key={`${id}:${revision}:${shown.kind}`}>
          <Suspense fallback={<p className="ua-muted" role="status">Loading...</p>}>
            <MarkdownBody markdown={shown.markdown} sourceUrl={shown.sourceUrl} />
          </Suspense>
        </ReadmeRenderBoundary>
        {shown.truncated && <p className="ua-muted">Preview shortened.</p>}
        <a className="ua-link" href={shown.sourceUrl} target="_blank" rel="noopener noreferrer">{kind === "skill" ? "View full SKILL.md" : "View full README"} <ArrowUpRight /></a>
        {kind === "skill" && !docs?.readme && <a className="ua-link" href={readmeBrowseUrl(shown)} target="_blank" rel="noopener noreferrer">View on GitHub <ArrowUpRight /></a>}
      </div>}
  </section>;
}
