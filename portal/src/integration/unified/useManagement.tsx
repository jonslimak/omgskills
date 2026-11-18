import { useEffect, useRef, useState } from "react";
import { Check, Folder, Plus } from "lucide-react";
import { visibilityLabels, type PortalData, type PortalSet, type MembershipResult, type Visibility } from "../../app/model";
import { addable, setStatus } from "./set-adds";
import { isFavorite, type SkillDisplay } from "../../app/unified/model";
import { Modal } from "../../app/unified/UnifiedApp";
import type { UnifiedManagement } from "../../app/unified/management";
import type { SetCommand } from "../set-data";
import type { MembershipCommand } from "../membership-data";
import { SetPermissions } from "./SetPermissions";
import { SetAddSheet } from "./SetAddSheet";
import { copySetLink, setLink } from "../../app/set-link";
import { setInstallLink } from "../../app/set-install";
import { navigationSearch, initialNavigation } from "../../app/unified/model";

type Request =
  | { kind: "publish"; set: PortalSet }
  | { kind: "access"; set: PortalSet }
  | { kind: "create"; skills: SkillDisplay[] }
  | { kind: "moderate"; set: PortalSet }
  | { kind: "rename"; set: PortalSet }
  | { kind: "add"; skills: SkillDisplay[]; set?: PortalSet; choices?: SkillDisplay[] }
  | { kind: "favorite"; skill: SkillDisplay; add: boolean }
  | { kind: "remove"; set: PortalSet; skills: SkillDisplay[] };

export function useManagement({ data, mine, busy, blocked, scope, saveSet, saveMembership, detail, base, local, installEnabled = false }: {
  data: PortalData; mine: SkillDisplay[]; busy: boolean; blocked: boolean; scope: string;
  saveSet: (command: SetCommand) => Promise<{ groupId: string; refreshed: boolean }>;
  saveMembership: (command: MembershipCommand) => Promise<MembershipResult>;
  detail: UnifiedManagement["detail"];
  base: string; local: boolean; installEnabled?: boolean;
}): UnifiedManagement {
  const [request, setRequest] = useState<Request | null>(null);
  const [name, setName] = useState("");
  const [setIds, setSetIds] = useState<string[]>([]);
  const [skillKeys, setSkillKeys] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
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
    setSetIds(next.kind === "add" && next.set ? [next.set.id] : []);
    setSkillKeys([]);
  }
  const owned = data.sets.filter(set => set.role === "owner" && !set.isFavorites && !set.hidden);
  // A set that already has every picked skill.
  const hasAll = (set: PortalSet) => request?.kind === "add" && request.skills.length > 0 && request.skills.every(skill => setStatus(set, skill) === true);
  // Add to set can go to several sets at once; one that turns out to have the skills already is left out.
  const targetSets = request?.kind === "add" ? request.set ? [request.set]
    : data.sets.filter(set => setIds.includes(set.id) && !hasAll(set)) : [];
  const choices = request?.kind === "add" ? request.choices ?? mine : mine;
  const targetSkills = request?.kind === "add" ? request.skills.length ? request.skills : choices.filter(skill => skillKeys.includes(skill.key)) : [];
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
  async function submit(request: Request | null, immediate = false) {
    if (!request || disabled || pending.current) return;
    pending.current = true;
    const version = generation.current;
    setError("");
    if (immediate) setNotice("");
    try {
      let result: MembershipResult | undefined;
      let message = "Saved.";
      // Adds and removes confirm with a toast instead of the inline note.
      let toastText = "";
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
          result = request.skills.every(skill => skill.installed)
            ? await saveMembership({ kind: "create-selected", name: name.trim(), skills: request.skills.map(skill => skill.installed!) })
            : await saveMembership({ kind: "add-many", name: name.trim(), ...addable(request.skills) });
        } else {
          const saved = await saveSet({ kind: "create", name: name.trim() });
          if (!saved.refreshed) message = "Set created. Refresh to see the latest data.";
        }
        if (message === "Saved.") message = "Set created.";
      } else if (request.kind === "favorite") {
        result = !request.add
          ? await saveMembership({ kind: "remove-favorite", catalogId: request.skill.catalogId, skillId: request.skill.installed?.id })
          : request.skill.installed
          ? await saveMembership({ kind: "favorites", skills: [request.skill.installed], add: request.add })
          : await saveMembership({ kind: "catalog", catalogId: request.skill.catalogId!, favorite: true });
        toastText = request.add ? `Added ${request.skill.name} to Favorites` : `Removed ${request.skill.name} from Favorites`;
      } else if (request.kind === "remove") {
        const itemIds = request.skills.flatMap(skill => skill.setItemId ? [skill.setItemId] : []);
        if (!itemIds.length || itemIds.length < request.skills.length) throw new Error("Refresh this set before removing skills.");
        result = await saveMembership({ kind: "remove-items", id: request.set.id, itemIds });
        toastText = request.skills.length === 1 ? `Removed ${request.skills[0].name} from ${request.set.name}`
          : `Removed ${request.skills.length} skills from ${request.set.name}`;
      } else {
        if (!targetSets.length || targetSets.some(set => set.role !== "owner" || set.hidden || set.isFavorites) || !targetSkills.length) {
          throw new Error("Choose a set you own and a skill.");
        }
        // One set at a time. A set that fails stays picked to try again; skills already in a set count as unchanged.
        const failed: string[] = [];
        const messages: string[] = [];
        // Each set that took something, and how many of the skills went in.
        const added: { name: string; count: number }[] = [];
        for (const [index, set] of targetSets.entries()) {
          let why = "";
          let stop = false;
          try {
            const next = targetSkills.every(skill => skill.installed)
              ? await saveMembership({ kind: "change", id: set.id, skills: targetSkills.map(skill => skill.installed!), add: true })
              : await saveMembership({ kind: "add-many", id: set.id, ...addable(targetSkills) });
            if (next.failed.length || next.uncertain) {
              why = next.failed.map(item => item.message).join(" ") || "Could not confirm the save. Refresh before continuing.";
              stop = next.uncertain;
            } else if (next.added) added.push({ name: set.name, count: next.added });
          } catch (error) {
            why = error instanceof Error ? error.message : "Could not save. Try again.";
            stop = true;
          }
          if (why) {
            failed.push(set.id);
            messages.push(targetSets.length === 1 ? why : `${set.name}: ${why}`);
          }
          // After an unsure save, the rest aren't tried: they stay picked.
          if (stop) { failed.push(...targetSets.slice(index + 1).map(rest => rest.id)); break; }
        }
        if (failed.length) {
          if (generation.current === version) setSetIds(failed);
          throw new Error(messages.join(" "));
        }
        const where = added.length === 1 ? added[0].name
          : added.length < targetSets.length ? `${added.length} of ${targetSets.length} sets` : `${added.length} sets`;
        const count = added[0]?.count ?? 0;
        if (!added.length) message = targetSets.length > 1 ? "Already in those sets." : targetSkills.length === 1 ? "This skill is already in the set." : "Already in the set.";
        else toastText = targetSkills.length === 1 ? `Added ${targetSkills[0].name} to ${where}`
          : added.length === 1 ? `Added ${count} ${count === 1 ? "skill" : "skills"} to ${where}` : `Added skills to ${where}`;
      }
      if (result?.failed.length || result?.uncertain) {
        // The Set was made; trying again adds what didn't go in, instead of making a second Set.
        if (request.kind === "create" && result.groupId && result.failed.length && !result.uncertain && generation.current === version) {
          const failed = new Set(result.failed.map(item => item.id));
          setSetIds([result.groupId]);
          setRequest({ kind: "add", skills: request.skills.filter(skill => skill.installed ? failed.has(skill.installed.id)
            : failed.has(skill.catalogId ?? skill.cloudKey ?? "")) });
        }
        throw new Error(result.failed.map(item => item.message).join(" ") || "Could not confirm the save. Refresh before continuing.");
      }
      if (generation.current === version) {
        setRequest(null);
        if (toastText) { setNotice(""); setToast({ text: toastText, id: Date.now() }); } else setNotice(message);
      }
    } catch (error) {
      if (generation.current === version) {
        const message = error instanceof Error ? error.message : "Could not save. Try again.";
        if (immediate) setNotice(message);
        else setError(message);
      }
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
    busy, blocked, notice, toast, detail,
    create: (skills = []) => show({ kind: "create", skills }),
    add: (skills, set, choices) => show({ kind: "add", skills, set, choices }),
    favorite: skill => {
      const next: Request = { kind: "favorite", skill, add: !isFavorite(data, skill) };
      void submit(next, true);
    },
    rename: set => show({ kind: "rename", set }),
    access: set => { if (set.role === "owner" && !set.hidden && !set.isFavorites) show({ kind: "access", set }); },
    visibility: (set, visibility) => {
      if (set.role !== "owner" || set.hidden || set.isFavorites || set.visibility === visibility) return;
      if (visibility === "public") show({ kind: "publish", set });
      else void changeVisibility(set, visibility);
    },
    remove: (set, skills) => { if (skills.length) show({ kind: "remove", set, skills }); },
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
    updateItem: (set, itemId) => {
      if (disabled || pending.current || set.role !== "owner" || !set.items.some(item => item.id === itemId && item.updateAvailable)) return;
      pending.current = true;
      const version = generation.current;
      void saveMembership({ kind: "update-item", id: set.id, itemId }).then(result => {
        if (generation.current === version) setNotice(result.uncertain ? "Refresh to confirm the update." : "The Set now has your newest saved version.");
      }, error => { if (generation.current === version) setNotice(error instanceof Error ? error.message : "Could not update."); })
        .finally(() => { pending.current = false; });
    },
    copyLink,
    installLink: set => setInstallLink(set.appDeepLink, installEnabled, local),
    dialog: theme => request?.kind === "add" && request.set && !request.skills.length ? <SetAddSheet key={request.set.id} set={detail.set?.id === request.set.id ? detail.set : request.set}
      choices={choices} picked={skillKeys} busy={busy} disabled={disabled} error={error} theme={theme} close={close}
      toggle={(key, on) => setSkillKeys(keys => on ? [...keys, key] : keys.filter(other => other !== key))}
      submit={() => void submit(request)} />
      : request?.kind === "access" ? <SetPermissions key={request.set.id} theme={theme} close={close}
      detail={detail} busy={busy} blocked={blocked} save={saveSet} copyLink={() => copyLink(detail.set ?? request.set)} copyNotice={notice} /> : request && <Modal theme={theme} close={close} title={
      request.kind === "moderate" ? request.set.hidden ? "Restore set?" : "Hide set?"
        : request.kind === "publish" ? "Make this set public?"
        : request.kind === "favorite" ? request.add ? "Add to public Favorites?" : "Remove from Favorites?"
        : request.kind === "remove" ? "Remove from set?" : request.kind === "rename" ? "Rename set"
        : request.kind === "create" ? "New set" : "Add to set"}>
      <form onSubmit={event => { event.preventDefault(); void submit(request); }}>
        {request.kind === "publish" && <p>Anyone with the link can view {request.set.name}. Saved emails will no longer restrict access.</p>}
        {request.kind === "moderate" && <p>{request.set.hidden ? "Restore this set with its previous visibility and email access." : "Hide this set from other people. Installed skills will not be removed."}</p>}
        {request.kind === "favorite" && <p>{request.add
          ? "Favorites is public. Anyone with its link can view the skills you add."
          : "This removes the favorite, not the installed skill."}</p>}
        {request.kind === "remove" && <p>Remove {request.skills.length === 1 ? request.skills[0].name : `${request.skills.length} skills`} from {request.set.name}? {request.skills.length === 1 ? "This does not uninstall the skill." : "This does not uninstall them."}</p>}
        {(request.kind === "create" || request.kind === "rename") && <label>Set name
          <input autoFocus required maxLength={120} value={name} disabled={disabled} onChange={event => setName(event.target.value)} />
        </label>}
        {request.kind === "create" && <p className="ua-muted">Only me{request.skills.length ? ` · ${request.skills.length} skills` : ""}</p>}
        {request.kind === "add" && <>
          {!request.set && request.skills.length > 0 && <p className="ua-muted">Add {request.skills.length === 1 ? request.skills[0].name : `${request.skills.length} skills`} to:</p>}
          {request.set ? <p>{request.set.name}</p> : <div className="ua-set-picker" role="group" aria-label="Choose sets">
            {owned.map(set => {
              const count = set.itemCount ?? set.items.length;
              const has = hasAll(set);
              return <label key={set.id} className="ua-set-pick">
                <input type="checkbox" value={set.id} checked={!has && setIds.includes(set.id)} disabled={disabled || has}
                  onChange={event => setSetIds(ids => event.target.checked ? [...ids, set.id] : ids.filter(id => id !== set.id))} />
                <Folder aria-hidden="true" />
                <span>{set.name}<small>{has ? "Already added" : `${visibilityLabels[set.visibility]} · ${count} ${count === 1 ? "skill" : "skills"}`}</small></span>
                <Check className="ua-set-pick-check" aria-hidden="true" />
              </label>;
            })}
            {!owned.length && <p className="ua-muted">No sets yet.</p>}
            {request.skills.length > 0 && <button type="button" className="ua-link ua-set-pick-new" disabled={disabled}
              onClick={() => show({ kind: "create", skills: request.skills })}><Plus aria-hidden="true" />New set</button>}
          </div>}
          {request.set && request.skills.length > 0 && <p>{request.skills.length === 1 ? request.skills[0].name : `${request.skills.length} skills`}</p>}
        </>}
        {error && <p role="alert">{error}</p>}
        <div className="ua-toolbar">
          <button type="button" className="ua-pill" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className="ua-pill ua-primary" disabled={disabled ||
            ((request.kind === "create" || request.kind === "rename") && !name.trim()) ||
            (request.kind === "add" && (!targetSets.length || !targetSkills.length))}>
            {busy ? "Saving..." : request.kind === "moderate" ? request.set.hidden ? "Restore" : "Hide" : request.kind === "publish" ? "Make public" : request.kind === "create" ? "Create set" : request.kind === "rename" ? "Save name"
              : request.kind === "remove" || (request.kind === "favorite" && !request.add) ? "Remove"
              : targetSets.length > 1 ? `Add to ${targetSets.length} sets` : "Add"}
          </button>
        </div>
      </form>
    </Modal>,
  };
}
