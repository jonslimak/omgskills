import { useEffect, useRef, useState } from "react";
import type { PortalData, PortalSet, MembershipResult } from "../../app/model";
import { membershipStatus } from "../../app/model";
import { isFavorite, type SkillDisplay } from "../../app/unified/model";
import { Modal } from "../../app/unified/UnifiedApp";
import type { UnifiedManagement } from "../../app/unified/management";
import type { SetCommand } from "../set-data";
import type { MembershipCommand } from "../membership-data";

type Request =
  | { kind: "create"; skill?: SkillDisplay }
  | { kind: "rename"; set: PortalSet }
  | { kind: "add"; skill?: SkillDisplay; set?: PortalSet }
  | { kind: "favorite"; skill: SkillDisplay; add: boolean }
  | { kind: "remove"; set: PortalSet; skill: SkillDisplay };

export function useManagement({ data, mine, busy, blocked, scope, saveSet, saveMembership, detail }: {
  data: PortalData; mine: SkillDisplay[]; busy: boolean; blocked: boolean; scope: string;
  saveSet: (command: SetCommand) => Promise<{ groupId: string; refreshed: boolean }>;
  saveMembership: (command: MembershipCommand) => Promise<MembershipResult>;
  detail: UnifiedManagement["detail"];
}): UnifiedManagement {
  const [request, setRequest] = useState<Request | null>(null);
  const [name, setName] = useState("");
  const [setId, setSetId] = useState("");
  const [skillKey, setSkillKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setRequest(null); setError(""); setNotice("");
    return () => { generation.current++; };
  }, [scope]);
  function show(next: Request) {
    if (busy || blocked || pending.current) return;
    setError(""); setNotice(""); setRequest(next);
    setName(next.kind === "rename" ? next.set.name : "");
    setSetId(next.kind === "add" ? next.set?.id ?? "" : "");
    setSkillKey("");
  }
  const targetSet = request?.kind === "add" ? request.set ?? data.sets.find(set => set.id === setId) : undefined;
  const targetSkill = request?.kind === "add" ? request.skill ?? mine.find(skill => skill.key === skillKey) : undefined;
  const disabled = busy || blocked;
  const close = () => { if (!busy && !pending.current) setRequest(null); };
  async function submit() {
    if (!request || disabled || pending.current) return;
    pending.current = true;
    const version = generation.current;
    setError("");
    try {
      let result: MembershipResult | undefined;
      let message = "Saved.";
      if (request.kind === "rename") {
        const saved = await saveSet({ kind: "update", id: request.set.id, changes: { name: name.trim() } });
        message = saved.refreshed ? "Set renamed." : "Set renamed. Refresh to see the latest data.";
      } else if (request.kind === "create") {
        if (request.skill?.installed) {
          result = await saveMembership({ kind: "create-selected", name: name.trim(), skills: [request.skill.installed] });
        } else {
          const saved = await saveSet({ kind: "create", name: name.trim() });
          if (!saved.refreshed) message = "Set created. Refresh to see the latest data.";
        }
        if (message === "Saved.") message = "Set created.";
      } else if (request.kind === "favorite") {
        if (!request.skill.installed) throw new Error("Only installed skills can be added in this test.");
        result = await saveMembership({ kind: "favorites", skills: [request.skill.installed], add: request.add });
        message = request.add ? "Added to Favorites." : "Removed from Favorites.";
      } else if (request.kind === "remove") {
        if (!request.skill.setItemId) throw new Error("Refresh this set before removing an item.");
        result = await saveMembership({ kind: "remove-item", id: request.set.id, itemId: request.skill.setItemId });
        message = "Removed from set. Installed skills are unchanged.";
      } else {
        if (!targetSet || targetSet.role !== "owner" || targetSet.hidden || targetSet.isFavorites || targetSet.visibility !== "private" || !targetSkill?.installed) {
          throw new Error("Choose a private set and an installed skill.");
        }
        result = await saveMembership({ kind: "change", id: targetSet.id, skills: [targetSkill.installed], add: true });
        message = result.unchanged ? "This skill is already in the set." : "Added to set.";
      }
      if (result?.failed.length || result?.uncertain) {
        throw new Error(result.failed.map(item => item.message).join(" ") || "Could not confirm the save. Refresh before continuing.");
      }
      if (generation.current === version) { setRequest(null); setNotice(message); }
    } catch (error) {
      if (generation.current === version) setError(error instanceof Error ? error.message : "Could not save. Try again.");
    } finally { pending.current = false; }
  }
  return {
    busy, blocked, notice, detail,
    create: (skills = []) => { if (skills.length <= 1) show({ kind: "create", skill: skills[0] }); },
    add: (skills, set) => { if (skills.length <= 1) show({ kind: "add", skill: skills[0], set }); },
    favorite: skill => show({ kind: "favorite", skill, add: !isFavorite(data, skill) }),
    rename: set => show({ kind: "rename", set }),
    remove: (set, skill) => show({ kind: "remove", set, skill }),
    dialog: theme => request && <Modal theme={theme} close={close} title={
      request.kind === "favorite" ? request.add ? "Add to public Favorites?" : "Remove from Favorites?"
        : request.kind === "remove" ? "Remove from set?" : request.kind === "rename" ? "Rename set"
        : request.kind === "create" ? "New set" : "Add to set"}>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        {request.kind === "favorite" && <p>{request.add
          ? "Favorites is public. Anyone with its link can view the skills you add."
          : "This removes the favorite, not the installed skill."}</p>}
        {request.kind === "remove" && <p>Remove {request.skill.name} from {request.set.name}? This does not uninstall the skill.</p>}
        {(request.kind === "create" || request.kind === "rename") && <label>Set name
          <input autoFocus required maxLength={120} value={name} disabled={disabled} onChange={event => setName(event.target.value)} />
        </label>}
        {request.kind === "create" && <p className="ua-muted">Only me{request.skill ? ` · ${request.skill.name}` : ""}</p>}
        {request.kind === "add" && <>
          {request.set ? <p>{request.set.name}</p> : <label>Set
            <select required value={setId} disabled={disabled} onChange={event => setSetId(event.target.value)}>
              <option value="">Choose a private set</option>
              {data.sets.filter(set => set.role === "owner" && !set.isFavorites && !set.hidden && set.visibility === "private")
                .map(set => <option value={set.id} key={set.id}>{set.name}</option>)}
            </select>
          </label>}
          {request.skill ? <p>{request.skill.name}</p> : <label>Skill
            <select required value={skillKey} disabled={disabled} onChange={event => setSkillKey(event.target.value)}>
              <option value="">Choose an installed skill</option>
              {mine.map(skill => <option key={skill.key} value={skill.key} disabled={!targetSet || !skill.installed || membershipStatus(targetSet, skill.installed) !== false}>
                {skill.name}{targetSet && skill.installed && membershipStatus(targetSet, skill.installed) === true ? " (included)" : ""}
              </option>)}
            </select>
          </label>}
        </>}
        {error && <p role="alert">{error}</p>}
        <div className="ua-toolbar">
          <button type="button" className="ua-pill" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className="ua-pill ua-primary" disabled={disabled ||
            ((request.kind === "create" || request.kind === "rename") && !name.trim()) ||
            (request.kind === "add" && (!targetSet || !targetSkill?.installed))}>
            {busy ? "Saving..." : request.kind === "create" ? "Create set" : request.kind === "rename" ? "Save name"
              : request.kind === "remove" || (request.kind === "favorite" && !request.add) ? "Remove" : "Add"}
          </button>
        </div>
      </form>
    </Modal>,
  };
}
