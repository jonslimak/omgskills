import { useEffect, useRef, useState } from "react";
import { Action, Modal, TextInput } from "../app/ui";
import { membershipStatus, type MembershipControls, type MembershipResult, type PortalData } from "../app/model";
import { groupSyncedSkills, type GroupedSyncedSkill } from "../synced-skill-grouping";
import { emptyMembershipResult, type MembershipCommand } from "./membership-data";

type Request = { kind: "create" | "add" | "confirm"; skills: GroupedSyncedSkill[]; setId?: string;
  resolve?: (result: MembershipResult) => void; approve?: (value: boolean) => void };

export function useMembershipControls({ data, busy, blocked, save, refresh, notify }: {
  data: PortalData; busy: boolean; blocked: boolean;
  save: (command: MembershipCommand) => Promise<MembershipResult>;
  refresh: () => void; notify: (message: string) => void;
}) {
  const [request, setRequest] = useState<Request | null>(null);
  const [error, setError] = useState("");
  const current = useRef<Request | null>(null);
  const acknowledged = useRef(false);
  const active = useRef(true);
  const dismiss = () => {
    current.current?.resolve?.(emptyMembershipResult()); current.current?.approve?.(false);
    current.current = null; setRequest(null);
  };
  const show = (value: Request) => { dismiss(); current.current = value; setRequest(value); };
  useEffect(() => {
    active.current = true;
    const changed = () => dismiss();
    window.addEventListener("popstate", changed);
    return () => {
      active.current = false;
      current.current?.resolve?.(emptyMembershipResult()); current.current?.approve?.(false);
      current.current = null;
      window.removeEventListener("popstate", changed);
    };
  }, []);
  async function write(command: MembershipCommand) {
    const path = window.location.pathname;
    setError("");
    try {
      const result = await save(command);
      if (active.current && window.location.pathname === path) setError(result.failed.map((item) => `${item.name}: ${item.message}`).join(" "));
      return result;
    } catch (error) {
      if (active.current && window.location.pathname === path) setError(error instanceof Error ? error.message : "Could not update the set.");
      throw error;
    }
  }
  async function perform(command: MembershipCommand) {
    const path = window.location.pathname;
    const result = await write(command);
    if (active.current && window.location.pathname === path) notify(command.kind === "remove-item" ? "Item removed from the set."
      : command.kind === "reorder" ? "Set order saved."
      : `${result.added} added, ${result.removed} removed, ${result.unchanged} already up to date${result.failed.length ? `, ${result.failed.length} failed` : ""}.`);
    return result;
  }
  const controls: MembershipControls = {
    busy, blocked, refresh: () => { setError(""); refresh(); },
    change: (id, skills, add) => perform({ kind: "change", id, skills, add }),
    star: async (skills, add) => {
      if (busy || blocked) throw new Error("Wait for the current save or refresh your account.");
      if (add && !acknowledged.current) {
        const yes = await new Promise<boolean>((approve) => show({ kind: "confirm", skills, approve }));
        if (!yes || !active.current) return emptyMembershipResult();
        acknowledged.current = true;
      }
      return perform({ kind: "favorites", skills, add });
    },
    create: (skills) => new Promise((resolve) => show({ kind: "create", skills, resolve })),
    addSkills: (setId) => show({ kind: "add", setId, skills: groupSyncedSkills(data.skills) }),
    removeItem: async (id, itemId) => { await perform({ kind: "remove-item", id, itemId }); },
    reorder: async (id, itemIds) => { await perform({ kind: "reorder", id, itemIds }); },
  };
  return { controls, dismiss, error, dialog: request && <MembershipDialog key={`${request.kind}:${request.setId ?? ""}`} request={request}
    data={data} busy={busy} blocked={blocked} close={dismiss} save={perform}
    complete={(result) => { if (current.current !== request) return; request.resolve?.(result); dismiss(); }}
    approve={() => { request.approve?.(true); dismiss(); }} /> };
}

function MembershipDialog({ request, data, busy, blocked, close, save, complete, approve }: {
  request: Request; data: PortalData; busy: boolean; blocked: boolean; close: () => void;
  save: (command: MembershipCommand) => Promise<MembershipResult>;
  complete: (result: MembershipResult) => void; approve: () => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<MembershipResult["failed"]>([]);
  const pending = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const set = data.sets.find((value) => value.id === request.setId);
  const disabled = busy || blocked;
  async function submit() {
    if (pending.current || disabled) return;
    pending.current = true; setError(""); setFailures([]);
    try {
      const result = await save(request.kind === "create"
        ? { kind: "create-selected", name: name.trim(), skills: request.skills }
        : { kind: "change", id: request.setId!, skills: request.skills.filter((skill) => selected.includes(skill.id)), add: true });
      if (!live.current) return;
      setSelected((ids) => ids.filter((id) => !result.completedIds.includes(id)));
      setFailures(result.failed);
      if (!result.failed.length) complete(result);
    } catch (error) { if (live.current) setError(error instanceof Error ? error.message : "Could not save."); }
    finally { pending.current = false; }
  }
  return <Modal title={request.kind === "confirm" ? "Add to public Favorites?" : request.kind === "create" ? "New set" : "Add skills"}
    description={request.kind === "confirm" ? "Favorites is public. Anyone with its link can view the skills you add." : undefined}
    close={() => { if (!busy && !pending.current) close(); }}>
    {request.kind === "create" && <label>Name<TextInput autoFocus maxLength={120} value={name} disabled={busy}
      onChange={(event) => setName(event.target.value)} /></label>}
    {request.kind === "create" && <p>{request.skills.length} selected skills. This set starts as Only me.</p>}
    {request.kind === "add" && <>
      <TextInput aria-label="Find skills to add" placeholder="Search skills..." value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="rd-skill-picker">{request.skills.filter((skill) => skill.name.toLowerCase().includes(query.toLowerCase())).map((skill) => {
        const included = set ? membershipStatus(set, skill) : null;
        return <label className="rd-check-row" key={skill.id}><input type="checkbox" checked={included === true || selected.includes(skill.id)}
          disabled={disabled || included === true || included === null} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, skill.id] : ids.filter((id) => id !== skill.id))} />
          <span>{skill.name}{included === true ? " (included)" : included === null ? " (membership unavailable)" : ""}</span></label>;
      })}</div>
    </>}
    {error && <p role="alert">{error}</p>}
    {failures.length > 0 && <ul role="alert">{failures.map((failure) => <li key={failure.id}>{failure.name}: {failure.message}</li>)}</ul>}
    <div className="rd-dialog-footer">
      <Action disabled={busy} onClick={close}>Cancel</Action>
      <Action variant="default" disabled={disabled || (request.kind === "create" && !name.trim()) || (request.kind === "add" && !selected.length)}
        onClick={() => request.kind === "confirm" ? approve() : void submit()}>
        {busy ? "Saving..." : request.kind === "confirm" ? "Add to Favorites" : request.kind === "create" ? "Create set" : "Add skills"}
      </Action>
    </div>
  </Modal>;
}
