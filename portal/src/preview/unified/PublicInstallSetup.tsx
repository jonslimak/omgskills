import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, Download, RefreshCw, Settings2, X } from "lucide-react";
import type { SkillDisplay } from "../../app/unified/model";
import { InstallIntentStore, InstallSetupSession } from "../../app/unified/install-intent";
import { PublicCatalogClient } from "../../app/unified/public-catalog";
import { f2Cases, f2InstallAction } from "./f2-install";
import "./install-setup.css";

export function createPreviewInstallStore() {
  return new InstallIntentStore(() => window.sessionStorage);
}

export async function refreshInstallSkill(id: string, signal: AbortSignal): Promise<SkillDisplay | null> {
  // A separate client deliberately bypasses the browse client's in-memory cache.
  const skill = await new PublicCatalogClient().skill(id, signal);
  return skill ? { ...skill, key: `catalog:${skill.id}`, catalogId: skill.id } : null;
}

export function PublicInstallSetup({ skill, detailReady, caseKey, returnRoute, store }: {
  skill: SkillDisplay; detailReady: boolean; caseKey: string; returnRoute: string; store: InstallIntentStore;
}) {
  const [session] = useState(() => new InstallSetupSession({
    catalogId: skill.catalogId ?? "", commit: f2Cases.find(item => item.key === caseKey)?.commit,
    returnRoute, store, action: candidate => f2InstallAction(candidate, caseKey), refresh: refreshInstallSkill,
    open: href => window.location.assign(href),
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => () => session.abort(), [session]);
  const action = detailReady ? f2InstallAction(skill, caseKey) : { href: null, reason: "Waiting for current catalog details." };
  const initialDisabled = state.phase === "idle" && !action.href;
  const busy = state.phase === "checking";
  const ready = state.phase === "idle" || state.phase === "ready";
  return <section className="ua-install-setup" aria-label="Install in Codex" aria-busy={busy}>
    <h3>Install in Codex</h3>
    <div className="ua-install-buttons">
      {ready ? <button type="button" className="ua-f1-install ua-primary" disabled={initialDisabled}
        onClick={() => session.open(skill)}><ArrowUpRight /> Open in OMGSkills F1 Test</button>
        : <button type="button" className="ua-f1-install ua-primary" disabled={busy || state.restartRequired}
          onClick={() => void session.retry()}><RefreshCw /> {busy ? "Checking details..." : "Try opening again"}</button>}
      {state.phase !== "setup" && <button type="button" className="ua-f1-install" disabled={initialDisabled || busy || state.restartRequired}
        onClick={() => session.showSetup(skill)}><Settings2 /> Set up OMGSkills F1 Test</button>}
    </div>
    <p role="status">{state.message || (initialDisabled ? action.reason : "The app will ask for approval before installing.")}</p>
    {state.phase === "setup" && <div className="ua-install-help">
      <h4>Mac setup</h4>
      <button type="button" className="ua-f1-install" disabled aria-describedby="ua-download-status"><Download /> Download for Mac</button>
      <p id="ua-download-status">The signed test download is not available yet.</p>
      <p>Already have OMGSkills F1 Test? Open it, return to this page, then try opening again.</p>
    </div>}
    {state.intent && <p className="ua-install-version">Codex · {state.intent.commit ? `Exact version ${state.intent.commit.slice(0, 8)}` : "Latest version, reviewed in the app"}</p>}
    {!store.persistent && <p role="note">This browser cannot save setup. Keep this page open, or return using this skill's link.</p>}
    {state.phase !== "idle" && <button type="button" className="ua-f1-install" onClick={() => session.reset()}><X /> Cancel setup</button>}
  </section>;
}
