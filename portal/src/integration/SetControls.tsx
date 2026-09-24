import { useEffect, useRef, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { Copy, EyeOff, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { copySetLink, type SetLink } from "../app/set-link";
import { Action, IconAction, Modal, TextInput } from "../app/ui";
import { visibilityLabels, type PortalSet, type Visibility } from "../app/model";
import type { SetCommand } from "./set-data";

type Dialog = "create" | "edit" | "delete";
export function SetControls({ page, set, blocked, saving, save, navigate, notify, link }: {
  page: string;
  set: PortalSet | null;
  blocked: boolean;
  saving: boolean;
  save: (command: SetCommand) => Promise<{ groupId: string; refreshed: boolean }>;
  navigate: (path: string) => void;
  notify: (message: string) => void;
  link?: SetLink;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [copying, setCopying] = useState(false);
  const active = useRef(false);
  const pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const open = (kind: Dialog) => {
    setError(""); setName(kind === "create" ? "" : set?.name ?? "");
    setDescription(set?.description ?? ""); setDialog(kind);
  };
  const close = () => {
    if (saving || pending.current) return;
    setDialog(null); setError("");
  };
  async function perform(command: SetCommand) {
    if (pending.current || saving || blocked) return;
    pending.current = true;
    const origin = location.pathname;
    setError("");
    try {
      const result = await save(command);
      if (!active.current || location.pathname !== origin) return;
      setDialog(null);
      notify(result.refreshed ? "Set saved locally." : "Saved. Refresh your account to see the latest data.");
      if (command.kind === "create") navigate(`groups/${result.groupId}`);
      if (command.kind === "delete") navigate("sets");
    } catch (error) {
      if (active.current && location.pathname === origin) setError(error instanceof Error ? error.message : "Could not save the set.");
    } finally { pending.current = false; }
  }
  const owner = page === "detail" && set?.role === "owner";
  const disabled = blocked || saving || (page === "detail" && !owner);
  return <>
    {page === "detail" && set && link && <Action aria-label="Copy set link" title={link.description} disabled={blocked || saving || copying}
      onClick={() => {
        const origin = location.pathname;
        setCopying(true); setError("");
        void copySetLink(link, (text) => navigator.clipboard.writeText(text))
          .then((message) => { if (active.current && location.pathname === origin) notify(message); })
          .catch((error) => { if (active.current && location.pathname === origin) setError(error.message); })
          .finally(() => { if (active.current) setCopying(false); });
      }}><Copy data-icon="inline-start" /><span className="rd-desktop">Copy link</span></Action>}
    {page === "sets" && <Action variant="default" disabled={disabled} onClick={() => open("create")}>
      <Plus data-icon="inline-start" />New set
    </Action>}
    {owner && <>
      {!set.isFavorites && <select aria-label="Set visibility" value={set.visibility} disabled={disabled}
        onChange={(event) => void perform({ kind: "update", id: set.id, changes: { visibility: event.target.value as Visibility } })}>
        {Object.entries(visibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><IconAction label="Set options" disabled={disabled}><MoreHorizontal /></IconAction></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="portal-design rd-menu" align="end" sideOffset={5}>
          <DropdownMenu.Item onSelect={() => open("edit")}><Pencil />Edit details</DropdownMenu.Item>
          {!set.isFavorites && <>
            <DropdownMenu.Item onSelect={() => void perform({ kind: "moderate", id: set.id, hidden: !set.hidden })}>
              <EyeOff />{set.hidden ? "Restore" : "Hide"} set
            </DropdownMenu.Item>
            <DropdownMenu.Item className="rd-danger" onSelect={() => open("delete")}><Trash2 />Delete set</DropdownMenu.Item>
          </>}
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>}
    {!dialog && error && <span role="alert">{error}</span>}
    {dialog && <Modal title={dialog === "create" ? "New set" : dialog === "delete" ? `Delete ${set?.name}?` : "Edit set"}
      close={close}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (dialog === "create" && name.trim()) void perform({ kind: "create", name: name.trim() });
        else if (set && dialog === "delete") void perform({ kind: "delete", id: set.id });
        else if (set && (name.trim() || set.isFavorites)) void perform({ kind: "update", id: set.id,
          changes: { ...(!set.isFavorites ? { name: name.trim() } : {}), description: description.trim() } });
      }}>
        {dialog === "delete" ? <p>This removes the set, not any installed skills. This cannot be undone.</p> : <>
          <label>Name<TextInput required maxLength={120} value={name} disabled={saving || Boolean(set?.isFavorites && dialog === "edit")}
            onChange={(event) => setName(event.target.value)} autoFocus /></label>
          {dialog === "edit" && <label>Description<textarea maxLength={1000} value={description} disabled={saving}
            onChange={(event) => setDescription(event.target.value)} /></label>}
        </>}
        {error && <p role="alert">{error}</p>}
        <div className="rd-dialog-footer">
          <Action disabled={saving} onClick={close}>Cancel</Action>
          <Action variant={dialog === "delete" ? "destructive" : "default"} type="submit"
            disabled={disabled || (dialog !== "delete" && !name.trim())}>
            {saving ? "Saving..." : dialog === "create" ? "Create set" : dialog === "delete" ? "Delete set" : "Save changes"}
          </Action>
        </div>
      </form>
    </Modal>}
  </>;
}
