import { useState } from "react";
import { Copy, Pencil, Settings, Trash2 } from "lucide-react";
import type { PortalData } from "../../app/model";
import { Modal } from "../../app/unified/UnifiedApp";

export function ProfilePanel({ profile, busy, blocked, error, save, settings, deleteAccount, theme }: {
  profile: PortalData["profile"]; busy: boolean; blocked: boolean; error: string; theme: string;
  save: (changes: { handle?: string; published?: boolean }) => Promise<void>;
  settings: () => void;
  /** Deletes the account and signs out; rejects with a message to show. */
  deleteAccount?: () => Promise<void>;
}) {
  const [dialog, setDialog] = useState<"handle" | "publish" | "delete" | null>(null);
  const [handle, setHandle] = useState(profile.handle);
  const [notice, setNotice] = useState("");
  async function submit() {
    if (busy || blocked) return;
    setNotice("");
    try { await save(dialog === "handle" ? { handle: handle.trim() } : { published: !profile.published }); setDialog(null); setNotice("Profile saved."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save profile."); }
  }
  return <div className="ua-account-page">
    <h2>{profile.name}</h2><p>{profile.email}</p>
    <div className="ua-toolbar"><strong>{profile.handle ? `@${profile.handle}` : "No handle set"}</strong>
      <button className="ua-pill" disabled={busy || blocked} onClick={() => { setNotice(""); setHandle(profile.handle); setDialog("handle"); }}><Pencil />Edit profile</button>
    </div>
    <div className="ua-account-row"><div><strong>Public profile</strong><p className="ua-muted">{profile.published ? "Your profile lists your public sets." : "Your profile is not published. Public sets remain accessible."}</p></div>
      <button className="ua-pill" disabled={busy || blocked || !profile.handle} onClick={() => { setNotice(""); setDialog("publish"); }}>{profile.published ? "Unpublish" : "Publish"}</button>
    </div>
    {profile.published && profile.publicUrl && <button className="ua-pill" onClick={() => {
      void navigator.clipboard.writeText(profile.publicUrl!).then(() => setNotice("Profile link copied."), () => setNotice("Could not copy the link."));
    }}><Copy />Copy profile link</button>}
    <button className="ua-pill" disabled={busy} onClick={settings}><Settings />Account settings</button>
    {deleteAccount && <div className="ua-account-row"><div><strong>Delete account</strong><p className="ua-muted">Removes your account and everything in it.</p></div>
      <button className="ua-pill ua-pill-danger" disabled={busy} onClick={() => { setNotice(""); setDialog("delete"); }}><Trash2 />Delete account</button>
    </div>}
    {(error || notice) && <p role={error ? "alert" : "status"}>{error || notice}</p>}
    {dialog === "delete" && deleteAccount && <DeleteAccountDialog theme={theme} remove={deleteAccount} close={() => setDialog(null)} />}
    {dialog && dialog !== "delete" && <Modal theme={theme} title={dialog === "handle" ? "Edit profile" : profile.published ? "Unpublish profile?" : "Publish profile?"} close={() => { if (!busy) setDialog(null); }}>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        {dialog === "handle" ? <label>Handle<input required autoFocus maxLength={80} value={handle} disabled={busy} onChange={event => setHandle(event.target.value)} /></label>
          : <p>{profile.published ? "Your profile will no longer be listed. Public sets remain accessible." : "Your handle and public sets will be visible to anyone."}</p>}
        {(error || notice) && <p role="alert">{error || notice}</p>}
        <div className="ua-toolbar"><button className="ua-pill" type="button" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
          <button className="ua-pill ua-primary" disabled={busy || blocked || (dialog === "handle" && !handle.trim())}>{busy ? "Saving..." : "Confirm"}</button>
        </div>
      </form>
    </Modal>}
  </div>;
}

function DeleteAccountDialog({ theme, remove, close }: { theme: string; remove: () => Promise<void>; close: () => void }) {
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState("");
  async function submit() {
    if (deleting || typed.trim().toLowerCase() !== "delete") return;
    setDeleting(true);
    setFailure("");
    try { await remove(); }
    // Some data may already be gone (saved skills go first), so the fallback says to finish it.
    catch (error) { setFailure(error instanceof Error && error.message ? error.message : "Could not finish deleting your account. Some of your data may already be deleted; try again to finish."); setDeleting(false); }
  }
  return <Modal theme={theme} title="Delete your account?" close={() => { if (!deleting) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p>This can&rsquo;t be undone. It deletes:</p>
      <ul>
        <li>Your Sets and Favorites, including public Sets and Sets other people use. They stop working for everyone.</li>
        <li>Your saved skills and their files.</li>
        <li>Your connected Macs and agents, and the skills you added to My skills.</li>
        <li>Your profile, then your sign-in.</li>
      </ul>
      <p>Skills from your private GitHub repos stop working in Sets other people copied. To remove the omgskills GitHub app, uninstall it on GitHub.</p>
      <label>Type <strong>delete</strong> to confirm<input autoFocus autoComplete="off" value={typed} disabled={deleting} onChange={event => setTyped(event.target.value)} /></label>
      {failure && <p role="alert">{failure}</p>}
      <div className="ua-toolbar"><button className="ua-pill" type="button" disabled={deleting} onClick={close}>Cancel</button>
        <button className="ua-pill ua-pill-danger" disabled={deleting || typed.trim().toLowerCase() !== "delete"}>{deleting ? "Deleting..." : "Delete account"}</button>
      </div>
    </form>
  </Modal>;
}
