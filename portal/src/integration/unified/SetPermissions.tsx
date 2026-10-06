import { useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import { Modal } from "../../app/unified/UnifiedApp";
import type { UnifiedManagement } from "../../app/unified/management";
import type { SetCommand } from "../set-data";

export function SetPermissions({ detail, busy, blocked, theme, close, save, copyLink, copyNotice }: {
  detail: UnifiedManagement["detail"]; busy: boolean; blocked: boolean; theme: string;
  close: () => void;
  save: (command: SetCommand) => Promise<{ groupId: string; refreshed: boolean }>;
  copyLink: () => void; copyNotice: string;
}) {
  const set = detail.set;
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<{ id: string; email: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const editable = set?.role === "owner" && !set.hidden && !set.isFavorites;
  const disabled = busy || blocked || !editable || detail.state !== "ready";
  async function perform(command: SetCommand) {
    if (disabled || pending.current) return;
    pending.current = true; setError(""); setNotice("");
    try {
      const result = await save(command);
      if (active.current) {
        setEmail(""); setRemoving(null);
        setNotice(result.refreshed ? "Saved." : "Saved. Refresh your account to confirm the latest access.");
      }
    } catch (error) {
      if (active.current) setError(error instanceof Error ? error.message : "Could not update access.");
    } finally { pending.current = false; }
  }
  return <Modal theme={theme} title="Invite to set" close={() => { if (!busy && !pending.current) close(); }}>
    {detail.state === "loading" ? <p role="status">Loading access...</p>
      : detail.state === "error" ? <><p role="alert">{detail.error}</p><button type="button" className="ua-pill" onClick={detail.retry}>Retry</button></>
      : !editable || !set ? <p>Only the owner can change access. Favorites stays public.</p>
      : <>
        <p>{set.name}</p>
        {set.visibility !== "restricted" && <>
          <p className="ua-muted">{set.visibility === "public"
            ? "This set is public. Switching to Invite only limits access to you and saved email addresses."
            : "This set is Only me. Switch to Invite only to grant access by email."}</p>
          <button type="button" className="ua-pill ua-primary" disabled={disabled}
            onClick={() => void perform({ kind: "update", id: set.id, changes: { visibility: "restricted" } })}>
            {busy ? "Saving..." : "Switch to Invite only"}
          </button>
        </>}
        {set.allowedEmails === undefined ? <p role="alert">Access records are unavailable. Refresh this set.</p> : <>
          {!!set.allowedEmails.length && <ul className="ua-access-members" aria-label={set.visibility === "restricted" ? "Email access" : "Saved emails"}>
            {set.allowedEmails.map(entry => <li key={entry.id}>
              <span className="ua-member-initial" aria-hidden="true">{entry.email.slice(0, 2).toUpperCase()}</span>
              <span className="ua-access-email">{entry.email}</span>
              <button type="button" className="ua-icon" aria-label={`Remove access for ${entry.email}`} title={`Remove access for ${entry.email}`}
                disabled={disabled} onClick={() => { setRemoving(entry); setError(""); }}><X /></button>
            </li>)}
          </ul>}
          {!!set.allowedEmails.length && set.visibility !== "restricted" && <p className="ua-muted">
            {set.visibility === "public" ? "Saved emails do not restrict public access." : "Saved emails do not grant access while this set is Only me."}
          </p>}
          {removing && <div className="ua-access-confirm">
            <p>Remove {removing.email}{set.visibility === "restricted" ? " from this set's access list?" : " from saved emails?"}</p>
            <div className="ua-toolbar">
              <button type="button" className="ua-pill" disabled={disabled} onClick={() => setRemoving(null)}>Cancel</button>
              <button type="button" className="ua-pill" disabled={disabled} onClick={() => void perform({ kind: "remove-email", id: set.id, emailId: removing.id })}>Remove email</button>
            </div>
          </div>}
          {set.visibility === "restricted" && <form className="ua-invite-form" onSubmit={event => { event.preventDefault(); void perform({ kind: "add-email", id: set.id, email }); }}>
            <label>Email address<input type="email" required maxLength={320} value={email} disabled={disabled}
              placeholder="name@example.com" onChange={event => setEmail(event.target.value)} /></label>
            <button type="submit" className="ua-pill ua-invite" disabled={disabled || !email.trim()}>{busy ? "Saving..." : "Add access"}</button>
            <p className="ua-muted">Read-only access. No invitation email is sent. Copy the link and send it after granting access.</p>
          </form>}
        </>}
        <button type="button" className="ua-pill" onClick={copyLink}><Copy />Copy set link</button>
        {copyNotice && <p role="status">{copyNotice}</p>}
      </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </Modal>;
}
