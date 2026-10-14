import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, Download, RefreshCw, Settings2, X } from "lucide-react";
import type { SkillDisplay } from "./model";
import { InstallIntentStore, InstallSetupSession } from "./install-intent";
import { PublicCatalogClient } from "./public-catalog";
import { installClients, type InstallClient, type InstallAction } from "./public-install";
import type { setupTestDistribution } from "./setup-test-distribution";
import "./install-setup.css";

export async function refreshInstallSkill(id: string, signal: AbortSignal): Promise<SkillDisplay | null> {
  // Retry must bypass the browse client's in-memory cache.
  const skill = await new PublicCatalogClient().skill(id, signal);
  return skill ? { ...skill, key: `catalog:${skill.id}`, catalogId: skill.id } : null;
}

export function PublicInstallSetup({ skill, detailReady, commit, returnRoute, store, client, action: buildAction, distribution }: {
  skill: SkillDisplay; detailReady: boolean; commit?: string; returnRoute: string; store: InstallIntentStore;
  client: InstallClient; action: (skill: SkillDisplay) => InstallAction; distribution?: typeof setupTestDistribution;
}) {
  const appName = installClients[client].name;
  const downloadStatus = useId();
  const [session] = useState(() => new InstallSetupSession({
    client, catalogId: skill.catalogId ?? "", commit, returnRoute, store, action: buildAction,
    refresh: refreshInstallSkill, open: href => window.location.assign(href),
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    const abort = () => session.abort();
    window.addEventListener("pagehide", abort);
    return () => { window.removeEventListener("pagehide", abort); abort(); };
  }, [session]);
  const action = detailReady ? buildAction(skill) : { href: null, reason: "Waiting for current catalog details." };
  const busy = state.phase === "checking";
  const ready = state.phase === "idle" || state.phase === "ready";
  const normal = store.context === "normal";
  const download = distribution?.client === client ? distribution : undefined;
  return <section className="ua-install-setup" aria-label="Install in Codex" aria-busy={busy}>
    <h3>Install in Codex</h3>
    <div className="ua-install-buttons">
      {ready ? <button type="button" className="ua-f1-install ua-primary" disabled={!action.href}
        onClick={() => session.open(skill)}><ArrowUpRight /> {normal ? "Review in" : "Open in"} {appName}</button>
        : <button type="button" className="ua-f1-install ua-primary" disabled={!action.href || busy || state.restartRequired}
          onClick={() => void session.retry()}><RefreshCw /> {busy ? "Checking details..." : "Try opening again"}</button>}
      {state.phase !== "setup" && <button type="button" className="ua-f1-install" disabled={!action.href || busy || state.restartRequired}
        onClick={() => session.showSetup(skill)}><Settings2 /> Set up {appName}</button>}
    </div>
    <p role="status">{!action.href ? action.reason : state.message || "The app will ask for approval before installing."}</p>
    {state.phase === "setup" && <div className="ua-install-help">
      <h4>Mac setup</h4>
      {download ? <>
        <p>Apple silicon Mac, macOS 14 or later. Test version {download.version} (build {download.build}).</p>
        <a className="ua-f1-install" href={download.url} rel="noreferrer" aria-describedby={downloadStatus}><Download /> Download {appName}</a>
        <ol id={downloadStatus}>
          <li>Extract <strong>{download.filename}</strong>.</li>
          <li>Copy <strong>{download.app}</strong> to Applications, then open it. Keep any existing OMGSkills app.</li>
          <li>Return to this page and choose <strong>Try opening again</strong>, then <strong>Review in {appName}</strong>.</li>
        </ol>
      </> : <>
        <button type="button" className="ua-f1-install" disabled aria-describedby="ua-download-status"><Download /> Download for Mac</button>
        <p id="ua-download-status">The signed test download is not available yet.</p>
      </>}
      <p>Already have {appName}? Open it, return to this page, then try opening again.</p>
    </div>}
    {state.intent && <p className="ua-install-version">Codex · {state.intent.commit ? `Exact version ${state.intent.commit.slice(0, 8)}` : "Latest version, reviewed in the app"}</p>}
    {normal && <p>After installing, restart Codex if the skill does not appear.</p>}
    {!store.persistent && <p role="note">This browser cannot save setup. Keep this page open, or return using this skill's link.</p>}
    {state.phase !== "idle" && <button type="button" className="ua-f1-install" onClick={() => session.reset()}><X /> Cancel setup</button>}
  </section>;
}
