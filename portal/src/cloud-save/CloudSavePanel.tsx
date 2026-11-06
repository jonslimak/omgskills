import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PortalApiError } from "../api-error";
import type { PortalApi } from "../portal-api";
import type { SyncedSkill } from "../synced-skill-grouping";
import { Action, EmptyState, IconAction, Toggle } from "../app/ui";
import {
  cloudSkillRows, cloudSummaryText, confirmCloudReview, deleteCloudSaved, formatBytes, setsNote, isDeletingAllCloudSkills, isDeletingCloudSkill, labelText, loadCloudSave, saveCloudSettings, statusText,
  type CloudDeleteSelection, type CloudSaveView,
} from "./cloud-save";

export function CloudSavePanel({ api, skills, denied }: { api: PortalApi; skills: SyncedSkill[]; denied: () => void }) {
  const callbacks = useRef({ api, denied });
  callbacks.current = { api, denied };
  const [view, setView] = useState<CloudSaveView>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<CloudDeleteSelection>(null);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);

  function failed(cause: unknown, fallback: string) {
    if (cause instanceof PortalApiError && cause.status === 401) callbacks.current.denied();
    return cause instanceof Error && cause.message ? cause.message : fallback;
  }

  async function refresh() {
    const current = ++generation.current;
    try {
      const next = await loadCloudSave(callbacks.current.api);
      if (current === generation.current) setView(next);
    } catch (cause) {
      if (current === generation.current) setView({ status: "error", message: failed(cause, "Sync could not be loaded.") });
    }
  }

  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, []);

  async function change(run: () => Promise<unknown>, fallback: string) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await run();
      await refresh();
      return true;
    } catch (cause) {
      setError(failed(cause, fallback));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (view.status === "loading") return <section className="rd-private-source rd-private-source-live" aria-label="Sync"><p role="status">Loading sync...</p></section>;
  if (view.status === "unavailable") return <section className="rd-private-source rd-private-source-live" aria-label="Sync">
    <EmptyState title="Sync isn't available yet" description="It's coming soon: a private, versioned copy of the skills you write or change." />
  </section>;
  if (view.status === "error") return <section className="rd-private-source rd-private-source-live" aria-label="Sync">
    <p role="alert">{view.message}</p>
    <Action onClick={() => void refresh()}>Try again</Action>
  </section>;

  const { state } = view;
  const rows = cloudSkillRows(state, skills);
  const reviews = rows.filter(row => row.status === "review" || row.status === "confirmed");

  return <section className="rd-private-source rd-private-source-live cloud-save" aria-label="Sync">
    <div className="rd-section-heading"><h2>Sync</h2>
      <IconAction label="Refresh sync" disabled={saving} onClick={() => void refresh()}><RefreshCw /></IconAction>
    </div>
    <div className="cloud-save-switch">
      <div className="rd-grow">
        <strong>Sync My skills</strong>
        <p className="rd-muted">omgskills keeps a private, versioned copy of every skill in My skills, so you
          can get it back or install it on another Mac. Only you can see it. Skills from the library and Sets sync too.</p>
      </div>
      <Toggle label="Sync My skills" checked={state.settings.enabled} disabled={saving}
        onChange={enabled => void change(() => saveCloudSettings(callbacks.current.api, { enabled }), "Sync could not be changed.")} />
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {state.settings.enabled && <p className="rd-muted" role="status">
      {cloudSummaryText(rows)} · {formatBytes(state.usage.bytes)} of {formatBytes(state.usage.limitBytes)} used.
      Your Mac syncs changes in the background; if it asks, reconnect it to allow syncing.
    </p>}

    {reviews.length > 0 && <div className="cloud-save-reviews">
      <h3>Needs review</h3>
      <p className="rd-muted">These files look like they contain a key or password, so they weren't saved. Remove the
        key on your Mac and the skill saves by itself, or confirm it's safe to save as it is.</p>
      {reviews.map(row => <div className="rd-source-release" key={row.key}>
        <div className="rd-grow"><strong>{row.name}</strong>
          {row.findings.map(file => <p className="rd-muted" key={file.path}>
            {file.path}: {file.findings.map(finding => `${finding.kind} on line ${finding.line}`).join(", ")}
          </p>)}
        </div>
        {row.status === "confirmed"
          ? <span className="rd-muted">Saving on your Mac's next sync</span>
          : <Action disabled={saving} onClick={() => void change(() => confirmCloudReview(callbacks.current.api, row.key),
              "The skill could not be confirmed.")}>It's safe, save it</Action>}
      </div>)}
    </div>}

    {choosing && <div className="cloud-save-choose">
      <form onSubmit={event => {
        event.preventDefault();
        void change(() => saveCloudSettings(callbacks.current.api, { excludedSkillKeys: [...excluded] }),
          "Your choices could not be saved.").then(done => { if (done) setChoosing(false); });
      }}>
        <h3>Choose skills</h3>
        <p className="rd-muted">Every skill is saved unless you untick it. New skills are saved automatically.</p>
        <div className="cloud-save-choices">
          {rows.map(row => <label key={row.key}>
            <input type="checkbox" aria-label={`Save ${row.name}`} checked={!excluded.has(row.key)} disabled={saving} onChange={event => {
              const next = new Set(excluded);
              if (event.target.checked) next.delete(row.key); else next.add(row.key);
              setExcluded(next);
            }} />
            {row.name}
          </label>)}
        </div>
        <div className="rd-account-actions">
          <Action type="submit" disabled={saving}>{saving ? "Saving..." : "Save choices"}</Action>
          <Action type="button" variant="outline" disabled={saving} onClick={() => setChoosing(false)}>Cancel</Action>
        </div>
      </form>
    </div>}

    <div className="cloud-save-list-heading">
      <h3>Your skills</h3>
      {state.settings.enabled && !choosing && <Action disabled={saving} variant="outline"
        onClick={() => { setExcluded(new Set(state.settings.excludedSkillKeys)); setChoosing(true); }}>Choose skills</Action>}
    </div>
    {rows.length === 0 && <p className="rd-muted">No skills seen on your Macs yet.</p>}
    {rows.length > 0 && <div className="cloud-save-list">
      {rows.map(row => <div className="rd-source-release" key={row.key} data-status={row.status}>
        <div className="rd-grow"><strong>{row.name}</strong>
          <p className="rd-muted">{statusText[row.status]}
            {row.versionCount > 0 && ` · ${row.versionCount} ${row.versionCount === 1 ? "version" : "versions"}`}
            {row.savedAt && ` · last saved ${new Date(row.savedAt).toLocaleDateString()}`}</p>
          {row.labels.length > 0 && <p className="cloud-save-labels">{row.labels.map(label =>
            <span key={label}>{labelText[label]}</span>)}</p>}
        </div>
        {row.versionCount > 0 && (isDeletingCloudSkill(deleting, row.key)
          ? <div className="cloud-save-confirm">
            <span>Delete all {row.versionCount} {row.versionCount === 1 ? "version" : "versions"} and stop saving it?{setsNote(row.setCount)}</span>
            <Action disabled={saving} onClick={() => void change(() => deleteCloudSaved(callbacks.current.api, row.key),
              "The skill could not be deleted.").then(done => { setDeleting(null); if (done) setNotice(`${row.name}'s synced copy was deleted. It stays on your Mac.`); })}>Delete</Action>
            <Action variant="outline" disabled={saving} onClick={() => setDeleting(null)}>Cancel</Action>
          </div>
          : <Action variant="outline" disabled={saving || deleting !== null} onClick={() => setDeleting({ kind: "skill", key: row.key })}>Delete synced copy</Action>)}
      </div>)}
    </div>}

    {(state.skills.length > 0 || state.usage.bytes > 0) && <div className="cloud-save-delete-all">
      {isDeletingAllCloudSkills(deleting)
        ? <>
          <p><strong>Delete everything you synced?</strong> Every synced version of every skill is removed and
            sync is turned off. Skills on your Macs aren't touched.
            {state.skills.some(skill => (skill.setCount ?? 0) > 0) && " Skills you share in Sets are taken out of them; people keep what they installed."}
            {" "}This can't be undone.</p>
          <div className="rd-account-actions">
            <Action disabled={saving} onClick={() => void change(() => deleteCloudSaved(callbacks.current.api),
              "Your synced skills could not be deleted.").then(done => { setDeleting(null); if (done) setNotice("Everything you synced was deleted, and sync is off."); })}>Delete everything</Action>
            <Action variant="outline" disabled={saving} onClick={() => setDeleting(null)}>Cancel</Action>
          </div>
        </>
        : <Action variant="outline" disabled={saving || deleting !== null} onClick={() => setDeleting({ kind: "all" })}>Delete all my synced skills</Action>}
    </div>}
  </section>;
}
