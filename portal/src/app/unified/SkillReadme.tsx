import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { SkillDisplay } from "./model";
import { PublicReadmeClient, publicReadmeId, readmeBrowseUrl, readmeTitle, type SkillDocuments } from "./public-readme";
import { cloudSkillKey, restoreVersionLink, type SavedSkillMd, type SavedSkillMdLoader, type SavedVersions, type SavedVersionsLoader, type SharedSkillMd, type SharedSkillMdLoader } from "../../cloud-save/cloud-save";

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
  if (skill.cloudKey) return [skill.cloudKey];
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
      </div> : !current.doc ? <p className="ua-muted">Turn on sync to read this skill's instructions here.</p>
      : !current.doc.markdown.trim() ? <p className="ua-muted">No instructions beyond the name and description.</p>
      : <div>
        <ReadmeRenderBoundary key={`${id}:${revision}`}>
          <Suspense fallback={<p className="ua-muted" role="status">Loading...</p>}>
            {/* No source page: relative links have nowhere to go, so they show as text. */}
            <MarkdownBody markdown={current.doc.markdown} sourceUrl="about:blank" />
          </Suspense>
        </ReadmeRenderBoundary>
        <p className="ua-muted">{current.doc.truncated ? "Preview shortened. " : ""}Synced {new Date(current.doc.savedAt).toLocaleDateString()}.</p>
      </div>}
  </section>;
}

type SharedState = { id: string; status: "loading" | "ready" | "error"; doc: SharedSkillMd | null };

/** A private Set item's instructions, for people the Set is shared with; checked like the Mac download. */
export function SharedSkillReadme({ releaseId, load }: { releaseId: string; load: SharedSkillMdLoader }) {
  const [revision, setRevision] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  const [state, setState] = useState<SharedState>({ id: "", status: "loading", doc: null });
  useEffect(() => {
    const controller = new AbortController();
    setState({ id: releaseId, status: "loading", doc: null });
    void loader.current(releaseId, controller.signal).then(doc => {
      if (!controller.signal.aborted) setState({ id: releaseId, status: "ready", doc });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ id: releaseId, status: "error", doc: null });
    });
    return () => controller.abort();
  }, [releaseId, revision]);

  const current = state.id === releaseId ? state : { id: releaseId, status: "loading", doc: null };
  return <section className="ua-readme" aria-label="Skill instructions" aria-busy={current.status === "loading"}>
    <h3>Skill instructions</h3>
    {current.status === "loading" ? <p className="ua-muted" role="status">Loading...</p>
      : current.status === "error" || !current.doc ? <div className="ua-readme-error">
        <p className="ua-muted" role="status">Skill instructions unavailable.</p>
        <button className="ua-icon" type="button" title="Retry" aria-label="Retry loading skill instructions" onClick={() => setRevision(value => value + 1)}><RefreshCw /></button>
      </div> : !current.doc.markdown.trim() ? <p className="ua-muted">No instructions beyond the name and description.</p>
      : <div>
        <ReadmeRenderBoundary key={`${releaseId}:${revision}`}>
          <Suspense fallback={<p className="ua-muted" role="status">Loading...</p>}>
            {/* No source page: relative links have nowhere to go, so they show as text. */}
            <MarkdownBody markdown={current.doc.markdown} sourceUrl="about:blank" />
          </Suspense>
        </ReadmeRenderBoundary>
        <p className="ua-muted">{current.doc.truncated ? "Preview shortened. " : ""}The version this Set installs.</p>
      </div>}
  </section>;
}

type VersionsState = { id: string; status: "loading" | "ready" | "error"; saved: SavedVersions | null };

/** An installed skill's saved versions, newest first; an older one can be put back on the Mac that has the skill.
 * Library installs are saved too, so they have versions like any skill. */
export function SavedVersionsList({ skill, liveName, load }: { skill: SkillDisplay; liveName?: string; load: SavedVersionsLoader }) {
  const keys = savedSkillKeys(skill);
  const id = keys.join("\n");
  const loader = useRef(load);
  loader.current = load;
  const [state, setState] = useState<VersionsState>({ id: "", status: "loading", saved: null });
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState({ id, status: "loading", saved: null });
    void loader.current(id.split("\n"), controller.signal).then(saved => {
      if (!controller.signal.aborted) setState({ id, status: "ready", saved });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ id, status: "error", saved: null });
    });
    return () => controller.abort();
  }, [id]);
  const current = state.id === id ? state : null;
  if (!id || !current || current.status !== "ready" || !current.saved || current.saved.versions.length < 2) return null;
  const { key, versions } = current.saved;
  return <section className="ua-saved-versions" aria-label="Synced versions">
    <h3>Synced versions</h3>
    <ul>
      {versions.map((version, index) => <li key={version.id}>
        <span>{new Date(version.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
        {index === 0 ? <small>Current</small> : liveName
          ? <button type="button" className="ua-link" onClick={() => window.location.assign(restoreVersionLink(liveName, key, version.id))}>
              Restore
            </button> : null}
      </li>)}
    </ul>
  </section>;
}
