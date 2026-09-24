import { useState } from "react";
import { Action, Modal, TextInput } from "../app/ui";

export function ProfileDialog({ handle, saving, blocked, error, close, save }: {
  handle: string;
  saving: boolean;
  blocked: boolean;
  error: string;
  close: () => void;
  save: (handle: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(handle);
  return <Modal title={handle ? "Edit profile" : "Set your handle"} close={() => { if (!saving) close(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!saving && !blocked && draft.trim()) void save(draft.trim()).catch(() => {});
    }}>
      <label>Handle
        <TextInput required maxLength={80} value={draft} disabled={saving}
          onChange={(event) => setDraft(event.target.value)} autoFocus />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="rd-dialog-footer">
        <Action onClick={close} disabled={saving}>Cancel</Action>
        <Action variant="default" type="submit" disabled={saving || blocked || !draft.trim()}>
          {saving ? "Saving..." : "Save changes"}
        </Action>
      </div>
    </form>
  </Modal>;
}
