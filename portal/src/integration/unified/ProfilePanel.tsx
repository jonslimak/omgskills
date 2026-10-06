import { useState } from "react";
import { Copy, Pencil, Settings } from "lucide-react";
import type { PortalData } from "../../app/model";
import { Modal } from "../../app/unified/UnifiedApp";

export function ProfilePanel({ profile, busy, error, save, settings, theme }: {
  profile: PortalData["profile"]; busy: boolean; error: string; theme: string;
  save: (changes: { handle?: string; published?: boolean }) => Promise<void>;
  settings: () => void;
}) {
  const [dialog, setDialog] = useState<"handle" | "publish" | null>(null);
  const [handle, setHandle] = useState(profile.handle);
  const [notice, setNotice] = useState("");
  async function submit() {
    if (busy) return;
    setNotice("");
    try { await save(dialog === "handle" ? { handle: handle.trim() } : { published: !profile.published }); setDialog(null); setNotice("Profile saved."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save profile."); }
  }
  return <div className="ua-account-page">
    <h2>{profile.name}</h2><p>{profile.email}</p>
    <div className="ua-toolbar"><strong>{profile.handle ? `@${profile.handle}` : "No handle set"}</strong>
      <button className="ua-pill" disabled={busy} onClick={() => { setHandle(profile.handle); setDialog("handle"); }}><Pencil />Edit profile</button>
    </div>
    <div className="ua-account-row"><div><strong>Public profile</strong><p className="ua-muted">{profile.published ? "Your profile lists your public sets." : "Your profile is not published. Public sets remain accessible."}</p></div>
      <button className="ua-pill" disabled={busy || !profile.handle} onClick={() => setDialog("publish")}>{profile.published ? "Unpublish" : "Publish"}</button>
    </div>
    {profile.published && profile.publicUrl && <button className="ua-pill" onClick={() => {
      void navigator.clipboard.writeText(profile.publicUrl!).then(() => setNotice("Profile link copied."), () => setNotice("Could not copy the link."));
    }}><Copy />Copy profile link</button>}
    <button className="ua-pill" disabled={busy} onClick={settings}><Settings />Account settings</button>
    {(error || notice) && <p role={error ? "alert" : "status"}>{error || notice}</p>}
    {dialog && <Modal theme={theme} title={dialog === "handle" ? "Edit profile" : profile.published ? "Unpublish profile?" : "Publish profile?"} close={() => { if (!busy) setDialog(null); }}>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        {dialog === "handle" ? <label>Handle<input required autoFocus maxLength={80} value={handle} disabled={busy} onChange={event => setHandle(event.target.value)} /></label>
          : <p>{profile.published ? "Your profile will no longer be listed. Public sets remain accessible." : "Your handle and public sets will be visible to anyone."}</p>}
        {(error || notice) && <p role="alert">{error || notice}</p>}
        <div className="ua-toolbar"><button className="ua-pill" type="button" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
          <button className="ua-pill ua-primary" disabled={busy || (dialog === "handle" && !handle.trim())}>{busy ? "Saving..." : "Confirm"}</button>
        </div>
      </form>
    </Modal>}
  </div>;
}
