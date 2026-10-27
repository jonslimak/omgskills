import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import type { SkillDisplay } from "./model";
import { catalogInstallAction, catalogInstallClients, type CatalogInstallAgent } from "./public-install";
import { CatalogInstallIntentStore, CatalogInstallSetupSession } from "./catalog-install-intent";
import { refreshInstallSkill } from "./PublicInstallSetup";
import { productionDistribution } from "./production-distribution";
import type { CandidateDistribution } from "../../candidate/distribution";
import "./install-setup.css";

export function CatalogInstallSetup({ skill, detailReady, returnRoute, store, distribution }: {
  skill: SkillDisplay; detailReady: boolean; returnRoute: string; store: CatalogInstallIntentStore;
  distribution?: CandidateDistribution;
}) {
  const saved = store.read().intent;
  const [agent, setAgent] = useState<CatalogInstallAgent>(() => saved && saved.catalogId === skill.catalogId ? saved.agent : "claude");
  const selectId = useId();
  const picker = <>
    <label className="ua-sr" htmlFor={selectId}>Agent</label>
    <select id={selectId} value={agent} onChange={event => { store.clear(); setAgent(event.target.value as CatalogInstallAgent); }}>
      <option value="claude">Claude</option><option value="codex">Codex</option>
    </select>
  </>;
  return <section className="ua-install-setup" aria-label="Install skill">
    <CatalogInstallControls key={agent} skill={skill} detailReady={detailReady} returnRoute={returnRoute} store={store} agent={agent}
      distribution={distribution} picker={picker} />
  </section>;
}

function CatalogInstallControls({ skill, detailReady, returnRoute, store, agent, distribution, picker }: {
  skill: SkillDisplay; detailReady: boolean; returnRoute: string; store: CatalogInstallIntentStore; agent: CatalogInstallAgent;
  distribution?: CandidateDistribution; picker: ReactNode;
}) {
  const downloadId = useId();
  const appName = catalogInstallClients[store.client].name;
  const download = store.client === "candidate" && distribution?.client === "candidate" ? distribution : undefined;
  const productionDownload = store.client === "production" ? productionDistribution : undefined;
  const [session] = useState(() => new CatalogInstallSetupSession({ catalogId: skill.catalogId ?? "", agent,
    returnRoute, store, refresh: refreshInstallSkill, open: href => window.location.assign(href) }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    const abort = () => session.abort();
    window.addEventListener("pagehide", abort);
    return () => { window.removeEventListener("pagehide", abort); abort(); };
  }, [session]);
  const action = detailReady ? catalogInstallAction(skill, agent, store.client) : { href: null, reason: "Waiting for current catalog details." };
  const busy = state.phase === "checking";
  const ready = state.phase === "idle" || state.phase === "ready";
  return <div aria-busy={busy}>
    <div className="ua-install-buttons">
      {picker}
      <div className="ua-install-confirm">
        {ready ? <button type="button" className="ua-f1-install ua-primary" disabled={!action.href}
          onClick={() => session.open(skill)} data-humblytics="App Install Start">Confirm installation <Download /></button>
          : <button type="button" className="ua-f1-install ua-primary" disabled={!action.href || busy || state.restartRequired}
            onClick={() => void session.retry()}><RefreshCw /> {busy ? "Checking details..." : "Try opening again"}</button>}
        {state.phase !== "setup" && <button type="button" className="ua-link ua-install-setup-link" disabled={!action.href || busy || state.restartRequired}
          onClick={() => session.showSetup(skill)}>Set up skill management</button>}
      </div>
    </div>
    <p role="status">{!action.href ? action.reason : state.message}</p>
    {state.phase === "setup" && <div className="ua-install-help">
      <h4>Mac setup</h4>
      {productionDownload ? <>
        <p>OMGSkills {productionDownload.version}. Apple silicon Mac, macOS {productionDownload.minimumOS} or later.</p>
        <a className="ua-f1-install" href={productionDownload.url} rel="noreferrer" aria-describedby={downloadId} data-humblytics="App Setup Download"><Download /> Download OMGSkills {productionDownload.version}</a>
        <p>This opt-in version replaces your existing OMGSkills app. Your installed skills stay in their current folders.</p>
        <ol id={downloadId}>
          <li>Double-click <strong>{productionDownload.filename}</strong> in Finder to unzip it.</li>
          <li>Quit OMGSkills if it is running. Move <strong>{productionDownload.app}</strong> into <strong>Applications</strong>.</li>
          <li>Open <strong>{productionDownload.app}</strong> from <strong>Applications</strong>. If macOS asks, choose <strong>Open</strong>.</li>
          <li>Return here and choose <strong>Try opening again</strong>, then <strong>Confirm installation</strong>. Confirm installation in the app.</li>
        </ol>
        <a href={productionDownload.checksumURL} rel="noreferrer">SHA-256 checksum</a>
      </> : download ? <>
        <p>Apple silicon Mac, macOS {download.minimumOS} or later. Candidate {download.version} (build {download.build}). Disposable VM only.</p>
        <p>This test candidate uses the public app's identity. Install only inside the disposable VM, never alongside or over your normal Mac app.</p>
        <a className="ua-f1-install" href={download.url} download={download.filename} rel="noreferrer" aria-describedby={downloadId}><Download /> Download test candidate {download.version}</a>
        <ol id={downloadId}>
          <li>Inside the disposable VM, double-click <strong>{download.filename}</strong> in Finder to extract it.</li>
          <li>Using Finder, drag <strong>{download.app}</strong> into <strong>~/Applications</strong> (the Applications folder in your home folder). Do not open it from Downloads or the extracted folder.</li>
          <li>Open <strong>{download.app}</strong> from <strong>~/Applications</strong>. If macOS asks, choose <strong>Open</strong>.</li>
          <li>Return here and choose <strong>Try opening again</strong>, then <strong>Confirm installation</strong>.</li>
        </ol>
      </> : <>
        <button type="button" className="ua-f1-install" disabled aria-describedby={downloadId}><Download /> Download for Mac</button>
        <p id={downloadId}>{store.client === "candidate"
        ? "A signed candidate download is not available yet. Test only in a disposable Mac VM; do not replace your normal app."
        : "A compatible test download is not available. Use the prepared OMGSkills F1 Test build."}</p>
        {store.client === "candidate" && <p>Once the candidate is available, open it in the test VM, return to this page, choose <strong>Try opening again</strong>, then <strong>Confirm installation</strong>. The app asks for approval.</p>}
      </>}
    </div>}
    {!store.persistent && <p role="note">This browser cannot save setup. Keep this page open.</p>}
    {state.phase !== "idle" && <button type="button" className="ua-f1-install" onClick={() => session.reset()}><X /> Cancel setup</button>}
  </div>;
}
