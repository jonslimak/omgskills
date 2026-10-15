import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, Download, RefreshCw, Settings2, X } from "lucide-react";
import type { SkillDisplay } from "./model";
import { catalogInstallAction, catalogInstallClients, type CatalogInstallAgent } from "./public-install";
import { CatalogInstallIntentStore, CatalogInstallSetupSession } from "./catalog-install-intent";
import { refreshInstallSkill } from "./PublicInstallSetup";
import "./install-setup.css";

export function CatalogInstallSetup({ skill, detailReady, returnRoute, store }: {
  skill: SkillDisplay; detailReady: boolean; returnRoute: string; store: CatalogInstallIntentStore;
}) {
  const saved = store.read().intent;
  const [agent, setAgent] = useState<CatalogInstallAgent>(() => saved && saved.catalogId === skill.catalogId ? saved.agent : "codex");
  const selectId = useId();
  return <section className="ua-install-setup" aria-label="Install skill">
    <div className="ua-install-target"><label htmlFor={selectId}>Install in</label>
      <select id={selectId} value={agent} onChange={event => { store.clear(); setAgent(event.target.value as CatalogInstallAgent); }}>
        <option value="codex">Codex</option><option value="claude">Claude</option>
      </select>
    </div>
    <CatalogInstallControls key={agent} skill={skill} detailReady={detailReady} returnRoute={returnRoute} store={store} agent={agent} />
  </section>;
}

function CatalogInstallControls({ skill, detailReady, returnRoute, store, agent }: {
  skill: SkillDisplay; detailReady: boolean; returnRoute: string; store: CatalogInstallIntentStore; agent: CatalogInstallAgent;
}) {
  const downloadId = useId();
  const appName = catalogInstallClients[store.client].name;
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
      {ready ? <button type="button" className="ua-f1-install ua-primary" disabled={!action.href}
        onClick={() => session.open(skill)}><ArrowUpRight /> Open in {appName}</button>
        : <button type="button" className="ua-f1-install ua-primary" disabled={!action.href || busy || state.restartRequired}
          onClick={() => void session.retry()}><RefreshCw /> {busy ? "Checking details..." : "Try opening again"}</button>}
      {state.phase !== "setup" && <button type="button" className="ua-f1-install" disabled={!action.href || busy || state.restartRequired}
        onClick={() => session.showSetup(skill)}><Settings2 /> Set up {appName}</button>}
    </div>
    <p role="status">{!action.href ? action.reason : state.message || "Approval is required in the app. Skill updates are unavailable in this test."}</p>
    {state.phase === "setup" && <div className="ua-install-help">
      <h4>Mac setup</h4>
      <button type="button" className="ua-f1-install" disabled aria-describedby={downloadId}><Download /> Download for Mac</button>
      <p id={downloadId}>{store.client === "candidate"
        ? "A signed candidate download is not available yet. Test only in a disposable Mac VM; do not replace your normal app."
        : "A compatible test download is not available. Use the prepared OMGSkills F1 Test build."}</p>
      {store.client === "candidate" && <p>Once the candidate is available, open it in the test VM, return to this page, choose <strong>Try opening again</strong>, then <strong>Open in {appName}</strong>. The app asks for approval.</p>}
    </div>}
    {!store.persistent && <p role="note">This browser cannot save setup. Keep this page open.</p>}
    {state.phase !== "idle" && <button type="button" className="ua-f1-install" onClick={() => session.reset()}><X /> Cancel setup</button>}
  </div>;
}
