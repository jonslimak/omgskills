import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { agentKind, type SkillDisplay } from "./model";
import { catalogInstallAction, catalogInstallClients, type CatalogInstallAgent } from "./public-install";
import { CatalogInstallIntentStore, CatalogInstallSetupSession } from "./catalog-install-intent";
import { refreshInstallSkill } from "./PublicInstallSetup";
import { productionDistribution } from "./production-distribution";
import { AgentSetupPrompt } from "./AgentSetupPrompt";
import type { CandidateDistribution } from "../../candidate/distribution";
import "./install-setup.css";

export function CatalogInstallSetup({ skill, detailReady, returnRoute, store, distribution, appKnown = false }: {
  skill: SkillDisplay; detailReady: boolean; returnRoute: string; store: CatalogInstallIntentStore;
  distribution?: CandidateDistribution;
  /** The account has a connected Mac, so the app is most likely installed. */
  appKnown?: boolean;
}) {
  const saved = store.read().intent;
  // Start on the agent that doesn't have the skill yet.
  const [agent, setAgent] = useState<CatalogInstallAgent>(() => saved && saved.catalogId === skill.catalogId ? saved.agent
    : skill.installed?.sources.some(source => agentKind(source) === "claude")
      && !skill.installed.sources.some(source => agentKind(source) === "codex") ? "codex" : "claude");
  const selectId = useId();
  const pick = (next: CatalogInstallAgent) => { store.clear(); setAgent(next); };
  // Once "I have the app" checks out, switching agents stays on Install now.
  const [confirmed, setConfirmed] = useState(false);
  if (store.client === "production") return <section className="ua-install-setup ua-install-pop" aria-label="Install skill">
    <ProductionInstall key={agent} skill={skill} detailReady={detailReady} returnRoute={returnRoute} store={store} agent={agent}
      appKnown={appKnown || confirmed} onAppConfirmed={() => setConfirmed(true)}
      picker={<div className="ua-install-agents" role="group" aria-label="Agent">
      {(["claude", "codex"] as const).map(kind => <button key={kind} type="button" aria-pressed={agent === kind}
        className="ua-install-agent" onClick={() => pick(kind)}>
        <span className="ua-agent-logo" data-agent={kind} aria-hidden="true" />{kind === "claude" ? "Claude" : "Codex"}
      </button>)}
    </div>} />
  </section>;
  const picker = <>
    <label className="ua-sr" htmlFor={selectId}>Agent</label>
    <select id={selectId} value={agent} onChange={event => pick(event.target.value as CatalogInstallAgent)}>
      <option value="claude">Claude</option><option value="codex">Codex</option>
    </select>
  </>;
  return <section className="ua-install-setup" aria-label="Install skill">
    <CatalogInstallControls key={agent} skill={skill} detailReady={detailReady} returnRoute={returnRoute} store={store} agent={agent}
      distribution={distribution} picker={picker} />
  </section>;
}

function useInstallSession(skill: SkillDisplay, agent: CatalogInstallAgent, returnRoute: string, store: CatalogInstallIntentStore) {
  const [session] = useState(() => new CatalogInstallSetupSession({ catalogId: skill.catalogId ?? "", agent,
    returnRoute, store, refresh: refreshInstallSkill, open: href => window.location.assign(href) }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    const abort = () => session.abort();
    window.addEventListener("pagehide", abort);
    return () => { window.removeEventListener("pagehide", abort); abort(); };
  }, [session]);
  return { session, state };
}

/** The published app: one Install now when the app is there, else Download or an agent prompt. Few words. */
function ProductionInstall({ skill, detailReady, returnRoute, store, agent, appKnown, onAppConfirmed, picker }: {
  skill: SkillDisplay; detailReady: boolean; returnRoute: string; store: CatalogInstallIntentStore; agent: CatalogInstallAgent; appKnown: boolean;
  onAppConfirmed: () => void; picker: ReactNode;
}) {
  const { session, state } = useInstallSession(skill, agent, returnRoute, store);
  useEffect(() => { if (state.phase === "ready") onAppConfirmed(); }, [state.phase, onAppConfirmed]);
  const app = productionDistribution;
  const action = detailReady ? catalogInstallAction(skill, agent, store.client) : { href: null, reason: "Loading..." };
  const busy = state.phase === "checking";
  const ready = state.phase === "idle" || state.phase === "ready";
  // A connected Mac means the app is there; "Don't have the Mac install helper?" (or a saved setup) shows how to get it.
  const getApp = state.phase === "setup" || (!appKnown && state.phase === "idle");
  // Only what needs the person: approving in the app, or what went wrong.
  const status = !action.href ? (detailReady ? action.reason : "")
    : state.restartRequired ? "This request is out of date."
    : state.phase === "opening" ? `Approve it in the ${catalogInstallClients[store.client].name} app.` : state.phase === "blocked" ? state.message : "";
  const install = ready
    ? <button type="button" className="ua-primary ua-install-now" disabled={!action.href}
        onClick={() => session.open(skill)} data-humblytics="App Install Start"><Download /> Install now</button>
    : <button type="button" className="ua-primary ua-install-now" disabled={!action.href || busy || state.restartRequired}
        onClick={() => void session.retry()}><RefreshCw /> {busy ? "Checking..." : "Install now"}</button>;
  return <div className="ua-install-pop" aria-busy={busy}>
    {getApp ? <>
      <p className="ua-install-lead">Get the Mac install helper.<br /><small>Not sure? Have your agent <a href="https://omgskills.com/safety/" target="_blank" rel="noreferrer">check it's safe</a>.</small></p>
      <div className="ua-install-get">
        <a className="ua-primary ua-install-now" href={app.url} rel="noreferrer" data-humblytics="App Setup Download"
          onClick={() => { if (state.phase === "idle") session.showSetup(skill); }}><Download /> Download app</a>
        <AgentSetupPrompt />
      </div>
    </> : <>
      {picker}
      {install}
      <button type="button" className="ua-link ua-install-switch" disabled={!action.href || busy || state.restartRequired}
        onClick={() => session.showSetup(skill)}>Don't have the Mac install helper?</button>
    </>}
    <p role="status" className="ua-install-status">{getApp ? "" : status}</p>
    {state.restartRequired && <button type="button" className="ua-link ua-install-switch" onClick={() => session.reset()}>Start over</button>}
  </div>;
}

function CatalogInstallControls({ skill, detailReady, returnRoute, store, agent, distribution, picker }: {
  skill: SkillDisplay; detailReady: boolean; returnRoute: string; store: CatalogInstallIntentStore; agent: CatalogInstallAgent;
  distribution?: CandidateDistribution; picker: ReactNode;
}) {
  const downloadId = useId();
  const appName = catalogInstallClients[store.client].name;
  const download = store.client === "candidate" && distribution?.client === "candidate" ? distribution : undefined;
  const { session, state } = useInstallSession(skill, agent, returnRoute, store);
  const action = detailReady ? catalogInstallAction(skill, agent, store.client) : { href: null, reason: "Waiting for current catalog details." };
  const busy = state.phase === "checking";
  const ready = state.phase === "idle" || state.phase === "ready";
  return <div aria-busy={busy}>
    <div className="ua-install-buttons">
      {picker}
      <div className="ua-install-confirm">
        {ready ? <button type="button" className="ua-f1-install ua-primary" disabled={!action.href}
          onClick={() => session.open(skill)} data-humblytics="App Install Start">Open in {appName} <Download /></button>
          : <button type="button" className="ua-f1-install ua-primary" disabled={!action.href || busy || state.restartRequired}
            onClick={() => void session.retry()}><RefreshCw /> {busy ? "Checking details..." : "Try opening again"}</button>}
        {state.phase !== "setup" && <button type="button" className="ua-link ua-install-setup-link" disabled={!action.href || busy || state.restartRequired}
          onClick={() => session.showSetup(skill)}>Set up the Mac app</button>}
      </div>
    </div>
    <p role="status">{!action.href ? action.reason : state.message}</p>
    <p>Approve installation in the Mac app. No account is needed for public skills. Automatic skill updates: Coming soon.</p>
    {state.phase === "setup" && <div className="ua-install-help">
      <h4>Mac setup</h4>
      {download ? <>
        <p>Apple silicon Mac, macOS {download.minimumOS} or later. Candidate {download.version} (build {download.build}). Disposable VM only.</p>
        <p>This test candidate uses the public app's identity. Install only inside the disposable VM, never alongside or over your normal Mac app.</p>
        <a className="ua-f1-install" href={download.url} download={download.filename} rel="noreferrer" aria-describedby={downloadId}><Download /> Download test candidate {download.version}</a>
        <ol id={downloadId}>
          <li>Inside the disposable VM, double-click <strong>{download.filename}</strong> in Finder to extract it.</li>
          <li>Using Finder, drag <strong>{download.app}</strong> into <strong>~/Applications</strong> (the Applications folder in your home folder). Do not open it from Downloads or the extracted folder.</li>
          <li>Open <strong>{download.app}</strong> from <strong>~/Applications</strong>. If macOS asks, choose <strong>Open</strong>.</li>
          <li>Return here and choose <strong>Try opening again</strong>, then <strong>Open in {appName}</strong>.</li>
        </ol>
      </> : <>
        <button type="button" className="ua-f1-install" disabled aria-describedby={downloadId}><Download /> Download for Mac</button>
        <p id={downloadId}>{store.client === "candidate"
        ? "A signed candidate download is not available yet. Test only in a disposable Mac VM; do not replace your normal app."
        : "A compatible test download is not available. Use the prepared OMGSkills F1 Test build."}</p>
        {store.client === "candidate" && <p>Once the candidate is available, open it in the test VM, return to this page, choose <strong>Try opening again</strong>, then <strong>Open in {appName}</strong>. The app asks for approval.</p>}
      </>}
    </div>}
    {!store.persistent && <p role="note">This browser cannot save setup. Keep this page open.</p>}
    {state.phase !== "idle" && <button type="button" className="ua-f1-install" onClick={() => session.reset()}><X /> Cancel setup</button>}
  </div>;
}
