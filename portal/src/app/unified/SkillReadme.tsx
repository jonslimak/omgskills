import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { SkillDisplay } from "./model";
import { PublicReadmeClient, publicReadmeId, readmeBrowseUrl, readmeTitle, type SkillDocuments } from "./public-readme";
import { cloudSkillKey, type SavedSkillMd, type SavedSkillMdLoader } from "../../cloud-save/cloud-save";

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

/** Folder keys of a skill on the user's Macs, which is how cloud save names it. */
export function savedSkillKeys(skill: SkillDisplay): string[] {
  const sources = skill.installed?.sourceSkills ?? [];
  return [...new Set(sources.map(source => cloudSkillKey(source.installationFolder || source.name)))];
}

type SavedState = { id: string; status: "loading" | "ready" | "error"; doc: SavedSkillMd | null };

/** A local skill's instructions, read from its cloud save copy; nothing leaves the Mac for this. */
export function SavedSkillReadme({ skill, load }: { skill: SkillDisplay; load: SavedSkillMdLoader }) {
  const keys = publicReadmeId(skill) ? [] : savedSkillKeys(skill);
  const id = keys.join("\n");
  const [revision, setRevision] = useState(0);
  // The account's API changes identity on re-render; reading it through a ref keeps one request per skill.
  const loader = useRef(load);
  loader.current = load;
  const [state, setState] = useState<SavedState>({ id: "", status: "loading", doc: null });
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState({ id, status: "loading", doc: null });
    void loader.current(id.split("\n"), controller.signal).then(doc => {
      if (!controller.signal.aborted) setState({ id, status: "ready", doc });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ id, status: "error", doc: null });
    });
    return () => controller.abort();
  }, [id, revision]);

  if (!id) return null;
  const current = state.id === id ? state : { id, status: "loading", doc: null };
  return <section className="ua-readme" aria-label="Skill instructions" aria-busy={current.status === "loading"}>
    <h3>Skill instructions</h3>
    {current.status === "loading" ? <p className="ua-muted" role="status">Loading...</p>
      : current.status === "error" ? <div className="ua-readme-error">
        <p className="ua-muted" role="status">Skill instructions unavailable.</p>
        <button className="ua-icon" type="button" title="Retry" aria-label="Retry loading skill instructions" onClick={() => setRevision(value => value + 1)}><RefreshCw /></button>
      </div> : !current.doc ? <p className="ua-muted">Turn on cloud save to read this skill's instructions here.</p>
      : !current.doc.markdown.trim() ? <p className="ua-muted">No instructions beyond the name and description.</p>
      : <div>
        <ReadmeRenderBoundary key={`${id}:${revision}`}>
          <Suspense fallback={<p className="ua-muted" role="status">Loading...</p>}>
            {/* No source page: relative links have nowhere to go, so they show as text. */}
            <MarkdownBody markdown={current.doc.markdown} sourceUrl="about:blank" />
          </Suspense>
        </ReadmeRenderBoundary>
        <p className="ua-muted">{current.doc.truncated ? "Preview shortened. " : ""}From your cloud save, saved {new Date(current.doc.savedAt).toLocaleDateString()}.</p>
      </div>}
  </section>;
}
