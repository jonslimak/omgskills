import { useEffect, useRef, useState } from "react";
import type { PortalData, PortalSet, MembershipResult, Visibility } from "../../app/model";
import { membershipStatus } from "../../app/model";
import { isFavorite, type SkillDisplay } from "../../app/unified/model";
import { Modal } from "../../app/unified/UnifiedApp";
import type { UnifiedManagement } from "../../app/unified/management";
import type { SetCommand } from "../set-data";
import type { MembershipCommand } from "../membership-data";
import { SetPermissions } from "./SetPermissions";
import { copySetLink, setLink } from "../../app/set-link";
import { navigationSearch, initialNavigation } from "../../app/unified/model";

type Request =
  | { kind: "publish"; set: PortalSet }
  | { kind: "access"; set: PortalSet }
  | { kind: "create"; skills: SkillDisplay[] }
  | { kind: "moderate"; set: PortalSet }
  | { kind: "rename"; set: PortalSet }
  | { kind: "add"; skills: SkillDisplay[]; set?: PortalSet }
  | { kind: "favorite"; skill: SkillDisplay; add: boolean }
  | { kind: "remove"; set: PortalSet; skill: SkillDisplay };

export function useManagement({ data, mine, busy, blocked, scope, saveSet, saveMembership, detail, base, local }: {
  data: PortalData; mine: SkillDisplay[]; busy: boolean; blocked: boolean; scope: string;
  saveSet: (command: SetCommand) => Promise<{ groupId: string; refreshed: boolean }>;
  saveMembership: (command: MembershipCommand) => Promise<MembershipResult>;
  detail: UnifiedManagement["detail"];
  base: string; local: boolean;
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
  const targetSkills = request?.kind === "add" ? request.skills.length ? request.skills : mine.filter(skill => skill.key === skillKey) : [];
  const disabled = busy || blocked;
  const close = () => { if (!busy && !pending.current) setRequest(null); };
  async function changeVisibility(set: PortalSet, visibility: Visibility) {
    if (disabled || pending.current || set.role !== "owner" || set.hidden || set.isFavorites || set.visibility === visibility) return;
    pending.current = true;
    const version = generation.current;
    setNotice("");
    try {
      const saved = await saveSet({ kind: "update", id: set.id, changes: { visibility } });
      if (generation.current === version) setNotice(saved.refreshed ? "Visibility updated." : "Saved. Refresh to confirm the latest access.");
    } catch (error) {
      if (generation.current === version) setNotice(error instanceof Error ? error.message : "Could not update visibility.");
    } finally { pending.current = false; }
  }
  async function submit() {
    if (!request || disabled || pending.current) return;
    pending.current = true;
    const version = generation.current;
    setError("");
    try {
      let result: MembershipResult | undefined;
      let message = "Saved.";
      if (request.kind === "publish") {
        const saved = await saveSet({ kind: "update", id: request.set.id, changes: { visibility: "public" } });
        message = saved.refreshed ? "Set is now public." : "Saved. Refresh to confirm public access.";
      } else if (request.kind === "moderate") {
        const saved = await saveSet({ kind: "moderate", id: request.set.id, hidden: !request.set.hidden });
        message = saved.refreshed ? request.set.hidden ? "Set restored." : "Set hidden from other people." : "Saved. Refresh to confirm visibility.";
      } else if (request.kind === "rename") {
        const saved = await saveSet({ kind: "update", id: request.set.id, changes: { name: name.trim() } });
        message = saved.refreshed ? "Set renamed." : "Set renamed. Refresh to see the latest data.";
      } else if (request.kind === "create") {
        if (request.skills.length) {
          if (request.skills.some(skill => !skill.installed)) throw new Error("Create an empty set first, then add the catalog skill.");
          result = await saveMembership({ kind: "create-selected", name: name.trim(), skills: request.skills.map(skill => skill.installed!) });
        } else {
          const saved = await saveSet({ kind: "create", name: name.trim() });
          if (!saved.refreshed) message = "Set created. Refresh to see the latest data.";
        }
        if (message === "Saved.") message = "Set created.";
      } else if (request.kind === "favorite") {
        result = request.skill.installed
          ? await saveMembership({ kind: "favorites", skills: [request.skill.installed], add: request.add })
          : await saveMembership({ kind: "catalog", catalogId: request.skill.catalogId!, favorite: true });
        message = request.add ? "Added to Favorites." : "Removed from Favorites.";
      } else if (request.kind === "remove") {
        if (!request.skill.setItemId) throw new Error("Refresh this set before removing an item.");
        result = await saveMembership({ kind: "remove-item", id: request.set.id, itemId: request.skill.setItemId });
        message = "Removed from set. Installed skills are unchanged.";
      } else {
        if (!targetSet || targetSet.role !== "owner" || targetSet.hidden || targetSet.isFavorites || !targetSkills.length) {
          throw new Error("Choose a set you own and a skill.");
        }
        if (targetSkills.every(skill => skill.installed)) {
          result = await saveMembership({ kind: "change", id: targetSet.id, skills: targetSkills.map(skill => skill.installed!), add: true });
        } else if (targetSkills.length === 1 && targetSkills[0].catalogId) {
          result = await saveMembership({ kind: "catalog", id: targetSet.id, catalogId: targetSkills[0].catalogId, favorite: false });
        } else throw new Error("Select installed skills together, or add one catalog skill at a time.");
        message = result.unchanged ? "This skill is already in the set." : "Added to set.";
      }
      if (result?.failed.length || result?.uncertain) {
        if (request.kind === "add" && result.failed.length && !result.uncertain && generation.current === version) {
          const failed = new Set(result.failed.map(item => item.id));
          setRequest({ ...request, skills: targetSkills.filter(skill => skill.installed && failed.has(skill.installed.id)) });
        }
        throw new Error(result.failed.map(item => item.message).join(" ") || "Could not confirm the save. Refresh before continuing.");
      }
      if (generation.current === version) { setRequest(null); setNotice(message); }
    } catch (error) {
      if (generation.current === version) setError(error instanceof Error ? error.message : "Could not save. Try again.");
    } finally { pending.current = false; }
  }
  function copyLink(set: PortalSet) {
    const version = generation.current;
    const link = setLink(set, data.profile, location.origin, base, local);
    if (local) link.url = new URL(`${base}${navigationSearch({ ...initialNavigation, view: "set", id: set.id })}`, location.origin).href;
    void copySetLink(link, text => navigator.clipboard.writeText(text)).then(message => {
      if (generation.current === version) setNotice(`${message} ${link.description}`);
    }, error => { if (generation.current === version) setNotice(error.message); });
  }
  return {
    busy, blocked, notice, detail,
    create: (skills = []) => show({ kind: "create", skills }),
    add: (skills, set) => show({ kind: "add", skills, set }),
    favorite: skill => show({ kind: "favorite", skill, add: !isFavorite(data, skill) }),
    rename: set => show({ kind: "rename", set }),
    access: set => { if (set.role === "owner" && !set.hidden && !set.isFavorites) show({ kind: "access", set }); },
    visibility: (set, visibility) => {
      if (set.role !== "owner" || set.hidden || set.isFavorites || set.visibility === visibility) return;
      if (visibility === "public") show({ kind: "publish", set });
      else void changeVisibility(set, visibility);
    },
    remove: (set, skill) => show({ kind: "remove", set, skill }),
    moderate: set => { if (set.role === "owner" && !set.isFavorites) show({ kind: "moderate", set }); },
    reorder: (set, itemId, offset) => {
      if (disabled || pending.current || set.role !== "owner" || set.hidden) return;
      const ids = set.items.map(item => item.id);
      const index = ids.indexOf(itemId);
      if (index < 0 || index + offset < 0 || index + offset >= ids.length) return;
      [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
      pending.current = true;
      const version = generation.current;
      void saveMembership({ kind: "reorder", id: set.id, itemIds: ids }).then(result => {
        if (generation.current === version) setNotice(result.uncertain ? "Refresh to confirm the order." : "Order updated.");
      }, error => { if (generation.current === version) setNotice(error instanceof Error ? error.message : "Could not reorder."); })
        .finally(() => { pending.current = false; });
    },
    copyLink,
    dialog: theme => request?.kind === "access" ? <SetPermissions key={request.set.id} theme={theme} close={close}
      detail={detail} busy={busy} blocked={blocked} save={saveSet} copyLink={() => copyLink(detail.set ?? request.set)} copyNotice={notice} /> : request && <Modal theme={theme} close={close} title={
      request.kind === "moderate" ? request.set.hidden ? "Restore set?" : "Hide set?"
        : request.kind === "publish" ? "Make this set public?"
        : request.kind === "favorite" ? request.add ? "Add to public Favorites?" : "Remove from Favorites?"
        : request.kind === "remove" ? "Remove from set?" : request.kind === "rename" ? "Rename set"
        : request.kind === "create" ? "New set" : "Add to set"}>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        {request.kind === "publish" && <p>Anyone with the link can view {request.set.name}. Saved emails will no longer restrict access.</p>}
        {request.kind === "moderate" && <p>{request.set.hidden ? "Restore this set with its previous visibility and email access." : "Hide this set from other people. Installed skills will not be removed."}</p>}
        {request.kind === "favorite" && <p>{request.add
          ? "Favorites is public. Anyone with its link can view the skills you add."
          : "This removes the favorite, not the installed skill."}</p>}
        {request.kind === "remove" && <p>Remove {request.skill.name} from {request.set.name}? This does not uninstall the skill.</p>}
        {(request.kind === "create" || request.kind === "rename") && <label>Set name
          <input autoFocus required maxLength={120} value={name} disabled={disabled} onChange={event => setName(event.target.value)} />
        </label>}
        {request.kind === "create" && <p className="ua-muted">Only me{request.skills.length ? ` · ${request.skills.length} skills` : ""}</p>}
        {request.kind === "add" && <>
          {request.set ? <p>{request.set.name}</p> : <label>Set
            <select required value={setId} disabled={disabled} onChange={event => setSetId(event.target.value)}>
              <option value="">Choose a set</option>
              {data.sets.filter(set => set.role === "owner" && !set.isFavorites && !set.hidden)
                .map(set => <option value={set.id} key={set.id}>{set.name}</option>)}
            </select>
          </label>}
          {request.skills.length ? <p>{request.skills.length === 1 ? request.skills[0].name : `${request.skills.length} skills`}</p> : <label>Skill
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
            (request.kind === "add" && (!targetSet || !targetSkills.length))}>
            {busy ? "Saving..." : request.kind === "moderate" ? request.set.hidden ? "Restore" : "Hide" : request.kind === "publish" ? "Make public" : request.kind === "create" ? "Create set" : request.kind === "rename" ? "Save name"
              : request.kind === "remove" || (request.kind === "favorite" && !request.add) ? "Remove" : "Add"}
          </button>
        </div>
      </form>
    </Modal>,
  };
}
