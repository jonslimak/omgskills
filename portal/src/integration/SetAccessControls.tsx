import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Action, Avatar, IconAction, Modal, StatusBadge, TextInput } from "../app/ui";
import { visibilityLabels, type PortalSet } from "../app/model";
import type { EmailCommand } from "./set-data";

export function SetAccessControls({ set, busy, blocked, save }: {
  set: PortalSet; busy: boolean; blocked: boolean;
  save: (command: EmailCommand) => Promise<{ refreshed: boolean }>;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<{ id: string; email: string } | null>(null);
  const pending = useRef(false);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const owner = set.role === "owner";
  const grantsAccess = !set.hidden && set.visibility === "restricted";
  const editable = owner && !set.isFavorites && set.allowedEmails !== undefined;
  const disabled = busy || blocked;
  async function perform(command: EmailCommand) {
    if (pending.current || disabled) return;
    pending.current = true; setError("");
    try {
      await save(command);
      if (active.current) { setEmail(""); setRemoving(null); }
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : "Could not update access."); }
    finally { pending.current = false; }
  }
  return <>
    <div className="rd-access-strip">
      <strong>Access</strong><StatusBadge>{visibilityLabels[set.visibility]}</StatusBadge>
      <span className="rd-member"><Avatar name={set.ownerName} /><span>{set.ownerName}</span><small>Owner</small></span>
      {!owner && <span className="rd-muted">{set.role === "invited" ? "You have read-only access" : "Public read-only access"}</span>}
      {owner && set.allowedEmails?.map((entry) => <span className="rd-member" key={entry.id}>
        <Avatar name={entry.email} /><span title={entry.email}>{entry.email}</span>
        {editable && <IconAction label={`${grantsAccess ? "Remove access for" : "Remove saved email"} ${entry.email}`}
          disabled={disabled} onClick={() => { setError(""); setRemoving(entry); }}><X /></IconAction>}
      </span>)}
      {owner && !set.isFavorites && !set.allowedEmails && <p className="rd-muted">Access records are unavailable. Refresh this set.</p>}
      {owner && Boolean(set.allowedEmails?.length) && !grantsAccess && <p className="rd-muted">
        {set.visibility === "public" && !set.hidden ? "This set is public. Saved emails do not limit who can view it." : "Saved emails do not grant access while this set is hidden or Only me."}
      </p>}
      {editable && grantsAccess && <form className="rd-email-form" onSubmit={(event) => {
        event.preventDefault(); void perform({ kind: "add-email", id: set.id, email });
      }}>
        <TextInput aria-label="Email address for access" type="email" required maxLength={320}
          placeholder="Add email for access" value={email} disabled={disabled} onChange={(event) => setEmail(event.target.value)} />
        <Action type="submit" variant="default" disabled={disabled || !email.trim()}>Add email</Action>
        <p className="rd-muted">Read-only access. No invitation email is sent.</p>
      </form>}
    </div>
    {!removing && error && <p role="alert">{error}</p>}
    {removing && <Modal title={grantsAccess ? "Remove email access?" : "Remove saved email?"} close={() => { if (!busy && !pending.current) setRemoving(null); }}>
      <p>{removing.email}</p>
      <p>{grantsAccess ? "This email will no longer grant access to this Invite-only set."
        : "This removes the saved email only. It does not change the set's visibility or restrict public access."}</p>
      {error && <p role="alert">{error}</p>}
      <div className="rd-dialog-footer"><Action disabled={busy} onClick={() => setRemoving(null)}>Cancel</Action>
        <Action variant="destructive" disabled={disabled} onClick={() => void perform({ kind: "remove-email", id: set.id, emailId: removing.id })}>
          {busy ? "Saving..." : "Remove"}</Action></div>
    </Modal>}
  </>;
}
