import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PortalApiError } from "../api-error";
import type { PortalApi } from "../portal-api";
import type { SyncedSkill } from "../synced-skill-grouping";
import { Action, EmptyState, IconAction, Toggle } from "../app/ui";
import {
  cloudSkillRows, confirmCloudReview, deleteCloudSaved, formatBytes, labelText, loadCloudSave, saveCloudSettings, statusText,
  type CloudSaveView,
} from "./cloud-save";

export function CloudSavePanel({ api, skills, denied }: { api: PortalApi; skills: SyncedSkill[]; denied: () => void }) {
  const callbacks = useRef({ api, denied });
  callbacks.current = { api, denied };
  const [view, setView] = useState<CloudSaveView>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // The skill key whose delete is being confirmed, or "*" for everything.
  const [deleting, setDeleting] = useState<string | null>(null);
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
      if (current === generation.current) setView({ status: "error", message: failed(cause, "Cloud save could not be loaded.") });
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

  if (view.status === "loading") return <section className="rd-private-source rd-private-source-live" aria-label="Cloud save"><p role="status">Loading cloud save...</p></section>;
  if (view.status === "unavailable") return <section className="rd-private-source rd-private-source-live" aria-label="Cloud save">
    <EmptyState title="Cloud save isn't available yet" description="It's coming soon: a private, versioned copy of the skills you write or change." />
  </section>;
  if (view.status === "error") return <section className="rd-private-source rd-private-source-live" aria-label="Cloud save">
    <p role="alert">{view.message}</p>
    <Action onClick={() => void refresh()}>Try again</Action>
  </section>;

  const { state } = view;
  const rows = cloudSkillRows(state, skills);
  const reviews = rows.filter(row => row.status === "review" || row.status === "confirmed");
  const choosable = rows.filter(row => row.status !== "library" || state.settings.excludedSkillKeys.includes(row.key));
  const savedCount = rows.filter(row => row.status === "saved" || row.status === "deleted").length;

  return <section className="rd-private-source rd-private-source-live cloud-save" aria-label="Cloud save">
    <div className="rd-section-heading"><h2>Cloud save</h2>
      <IconAction label="Refresh cloud save" disabled={saving} onClick={() => void refresh()}><RefreshCw /></IconAction>
    </div>
    <div className="cloud-save-switch">
      <div className="rd-grow">
        <strong>Save my skills to the cloud</strong>
        <p className="rd-muted">omgskills keeps a private, versioned copy of every skill you wrote or changed, so you
          can get it back or use it on another Mac. Only you can see it. Unchanged skills from the library aren't uploaded.</p>
      </div>
      <Toggle label="Save my skills to the cloud" checked={state.settings.enabled} disabled={saving}
        onChange={enabled => void change(() => saveCloudSettings(callbacks.current.api, { enabled }), "Cloud save could not be changed.")} />
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {state.settings.enabled && <p className="rd-muted" role="status">
      {savedCount} {savedCount === 1 ? "skill" : "skills"} saved · {formatBytes(state.usage.bytes)} of {formatBytes(state.usage.limitBytes)} used.
      Your Mac saves changes in the background; if it asks, reconnect it to allow saving.
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
          {choosable.map(row => <label key={row.key}>
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
        {row.versionCount > 0 && (deleting === row.key
          ? <div className="cloud-save-confirm">
            <span>Delete all {row.versionCount} {row.versionCount === 1 ? "version" : "versions"} and stop saving it?</span>
            <Action disabled={saving} onClick={() => void change(() => deleteCloudSaved(callbacks.current.api, row.key),
              "The skill could not be deleted.").then(done => { setDeleting(null); if (done) setNotice(`${row.name} was deleted from the cloud. It stays on your Mac.`); })}>Delete</Action>
            <Action variant="outline" disabled={saving} onClick={() => setDeleting(null)}>Cancel</Action>
          </div>
          : <Action variant="outline" disabled={saving || deleting !== null} onClick={() => setDeleting(row.key)}>Delete from cloud</Action>)}
      </div>)}
    </div>}

    {(state.skills.length > 0 || state.usage.bytes > 0) && <div className="cloud-save-delete-all">
      {deleting === "*"
        ? <>
          <p><strong>Delete everything you saved?</strong> Every version of every skill is removed from the cloud and
            cloud save is turned off. Skills on your Macs aren't touched. This can't be undone.</p>
          <div className="rd-account-actions">
            <Action disabled={saving} onClick={() => void change(() => deleteCloudSaved(callbacks.current.api),
              "Your saved skills could not be deleted.").then(done => { setDeleting(null); if (done) setNotice("Everything you saved was deleted, and cloud save is off."); })}>Delete everything</Action>
            <Action variant="outline" disabled={saving} onClick={() => setDeleting(null)}>Cancel</Action>
          </div>
        </>
        : <Action variant="outline" disabled={saving || deleting !== null} onClick={() => setDeleting("*")}>Delete all my saved skills</Action>}
    </div>}
  </section>;
}
