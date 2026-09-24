import { useEffect, useRef, useState } from "react";
import { DropdownMenu } from "radix-ui";
import {
  Check,
  ChevronDown,
  ListPlus,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import type { GroupedSyncedSkill } from "../synced-skill-grouping";
import {
  isMember,
  filterSkills,
  type PortalSet,
  type PortalActions,
  type MembershipControls,
  type MembershipResult,
  membershipStatus,
} from "./model";
import {
  Action,
  IconAction,
  TextInput,
  PanelPopover,
  EmptyState,
  AgentTiles,
  SourceLink,
} from "./ui";

export function MembershipPicker({
  skill,
  sets,
  actions,
  newSet,
  membership,
}: {
  skill: GroupedSyncedSkill;
  sets: PortalSet[];
  actions: PortalActions;
  newSet: (skills: GroupedSyncedSkill[]) => void;
  membership?: MembershipControls;
}) {
  const [error, setError] = useState("");
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return (
    <PanelPopover
      label={`Sets for ${skill.name}`}
      trigger={
        <IconAction label={`Add ${skill.name} to set`} disabled={membership && (membership.busy || membership.blocked)}>
          <ListPlus />
        </IconAction>
      }
    >
      <h3>Add to set</h3>
      {sets
        .filter((set) => set.role === "owner" && !set.isFavorites)
        .map((set) => (
          <label className="rd-check-row" key={set.id}>
            <input
              type="checkbox"
              checked={isMember(set, skill)}
              disabled={membership && (membership.busy || membership.blocked || membershipStatus(set, skill) === null)}
              onChange={(event) => {
                if (!membership) { actions.membership(set.id, [skill], event.target.checked); return; }
                setError("");
                void membership.change(set.id, [skill], event.target.checked)
                  .then((result) => { if (live.current) setError(result.failed.map((item) => item.message).join(" ")); })
                  .catch((error) => { if (live.current) setError(error instanceof Error ? error.message : "Could not update membership."); });
              }}
            />
            <span>{set.name}{membership && membershipStatus(set, skill) === null ? " (membership unavailable)" : ""}</span>
          </label>
        ))}
      <div className="rd-menu-divider" />
      {error && <p role="alert">{error}</p>}
      {membership && sets.some((set) => set.role === "owner" && membershipStatus(set, skill) === null) &&
        <Action disabled={membership.busy} onClick={membership.refresh}>Refresh membership</Action>}
      <Action variant="ghost" disabled={membership && (membership.busy || membership.blocked)} onClick={() => newSet([skill])}>
        <Plus data-icon="inline-start" />
        New set...
      </Action>
    </PanelPopover>
  );
}

export function SkillsPage({
  skills,
  sets,
  actions,
  source,
  setSource,
  edit,
  newSet,
  star,
  inspect,
  readOnly = false,
  membership,
}: {
  skills: GroupedSyncedSkill[];
  sets: PortalSet[];
  actions: PortalActions;
  source: string;
  setSource: (source: string) => void;
  edit: boolean;
  newSet: (skills: GroupedSyncedSkill[]) => void;
  star: (skills: GroupedSyncedSkill[], add: boolean) => void;
  inspect: (skill: GroupedSyncedSkill) => void;
  readOnly?: boolean;
  membership?: MembershipControls;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const unavailable = membership ? membership.busy || membership.blocked : readOnly;
  async function run(work: () => Promise<MembershipResult>) {
    setError("");
    try {
      const result = await work();
      if (!live.current) return;
      setSelected((ids) => ids.filter((id) => !result.completedIds.includes(id)));
      setError(result.failed.map((item) => `${item.name}: ${item.message}`).join(" "));
    } catch (error) { if (live.current) setError(error instanceof Error ? error.message : "Could not update membership."); }
  }
  const create = (chosen: GroupedSyncedSkill[]) => membership ? void run(() => membership.create(chosen)) : newSet(chosen);
  const favorite = (chosen: GroupedSyncedSkill[], add: boolean) => membership ? void run(() => membership.star(chosen, add)) : star(chosen, add);
  useEffect(() => {
    const liveIds = new Set(skills.map((skill) => skill.id));
    setSelected((current) => current.filter((id) => liveIds.has(id)));
  }, [skills]);
  useEffect(() => {
    if (!edit) setSelected([]);
  }, [edit]);
  const sources = [...new Set(skills.flatMap((skill) => skill.sources))].sort();
  const rows = filterSkills(skills, query, source);
  const selectedSkills = skills.filter((skill) => selected.includes(skill.id));
  const favorites = sets.find((set) => set.role === "owner" && set.isFavorites);
  const choose = (id: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((value) => value !== id),
    );
  return (
    <>
      <div className="rd-toolbar">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Action>
              <span className="rd-muted">Showing</span>
              {source === "all" ? "All skills" : source}
              <ChevronDown data-icon="inline-end" />
            </Action>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="portal-design rd-menu"
              align="start"
              sideOffset={5}
              collisionPadding={12}
            >
              <DropdownMenu.Label>View</DropdownMenu.Label>
              <DropdownMenu.Group>
                <DropdownMenu.Item onSelect={() => setSource("all")}>
                  <span className="rd-menu-check">
                    {source === "all" && <Check />}
                  </span>
                  All skills
                </DropdownMenu.Item>
                <DropdownMenu.Item disabled>
                  Recent activity <span className="rd-muted">Unavailable</span>
                </DropdownMenu.Item>
              </DropdownMenu.Group>
              <DropdownMenu.Separator className="rd-menu-divider" />
              <DropdownMenu.Label>By agent</DropdownMenu.Label>
              <DropdownMenu.Group>
                {sources.map((name) => (
                  <DropdownMenu.Item
                    key={name}
                    onSelect={() => setSource(name)}
                  >
                    <span className="rd-menu-check">
                      {source === name && <Check />}
                    </span>
                    {name}
                    <span className="rd-push rd-muted">
                      {
                        skills.filter((skill) => skill.sources.includes(name))
                          .length
                      }
                    </span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Group>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <div className="rd-search">
          <Search aria-hidden="true" />
          <TextInput
            aria-label="Search skills"
            placeholder="Search skills..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <IconAction label="Clear search" onClick={() => setQuery("")}>
              <X />
            </IconAction>
          )}
        </div>
        <span className="rd-result-count">{rows.length} skills</span>
      </div>
      {edit && selectedSkills.length > 0 && (
        <div className="rd-bulk">
          <span>{selectedSkills.length} selected</span>
          <div className="rd-actions">
            <Action variant="ghost" disabled={unavailable} onClick={() => setSelected([])}>
              Clear
            </Action>
            <PanelPopover
              label="Choose target set"
              trigger={
                <Action disabled={unavailable}>
                  <ListPlus data-icon="inline-start" />
                  Add to set
                </Action>
              }
            >
              <h3>Add selected skills</h3>
              {sets
                .filter((set) => set.role === "owner" && !set.isFavorites)
                .map((set) => (
                  <Action
                    className="rd-menu-action"
                    variant="ghost"
                    key={set.id}
                    disabled={unavailable}
                    onClick={() => {
                      if (membership) { void run(() => membership.change(set.id, selectedSkills, true)); return; }
                      actions.membership(set.id, selectedSkills, true);
                      setSelected([]);
                    }}
                  >
                    {set.name}
                  </Action>
                ))}
              <Action variant="ghost" disabled={unavailable} onClick={() => create(selectedSkills)}>
                <Plus data-icon="inline-start" />
                New set...
              </Action>
            </PanelPopover>
            <Action
              variant="default"
              disabled={unavailable}
              onClick={() => {
                if (membership) { favorite(selectedSkills, true); return; }
                star(selectedSkills, true);
                setSelected([]);
              }}
            >
              <Star data-icon="inline-start" />
              Star
            </Action>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="rd-table-wrap">
        <table className="rd-table">
          <thead>
            <tr>
              {edit && (
                <th className="rd-selection">
                  <input
                    type="checkbox"
                    aria-label="Select all visible skills"
                    disabled={unavailable}
                    checked={
                      rows.length > 0 &&
                      rows.every((skill) => selected.includes(skill.id))
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [
                              ...new Set([
                                ...selected,
                                ...rows.map((skill) => skill.id),
                              ]),
                            ]
                          : selected.filter(
                              (id) => !rows.some((skill) => skill.id === id),
                            ),
                      )
                    }
                  />
                </th>
              )}
              <th>Skill</th>
              <th className="rd-desktop rd-source-column">Source</th>
              <th className="rd-desktop rd-agents-column">Agents</th>
              <th
                className="rd-desktop rd-used-column"
                title="Per-skill usage is not available"
              >
                Last used
              </th>
              <th className="rd-action-column">
                <span className="rd-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((skill) => (
              <tr key={skill.id} data-selected={selected.includes(skill.id)}>
                {edit && (
                  <td className="rd-selection">
                    <input
                      type="checkbox"
                      aria-label={`Select ${skill.name}`}
                      disabled={unavailable}
                      checked={selected.includes(skill.id)}
                      onChange={(event) =>
                        choose(skill.id, event.target.checked)
                      }
                    />
                  </td>
                )}
                <td>
                  <button
                    className="rd-skill-title"
                    onClick={() => inspect(skill)}
                  >
                    {skill.name}
                  </button>
                  <div
                    className="rd-description"
                    title={skill.description || undefined}
                  >
                    {skill.description}
                  </div>
                  <div className="rd-mobile rd-mobile-meta">
                    {skill.sources.join(" / ")}{" "}
                    <span aria-hidden="true">·</span>{" "}
                    {skill.githubUrl ? "GitHub" : "Local"}
                  </div>
                </td>
                <td className="rd-desktop">
                  <SourceLink url={skill.githubUrl} />
                </td>
                <td className="rd-desktop">
                  <AgentTiles sources={skill.sources} />
                </td>
                <td className="rd-desktop rd-muted">&mdash;</td>
                <td>
                  <div className="rd-actions">
                    <IconAction
                      disabled={unavailable || Boolean(membership && favorites && membershipStatus(favorites, skill) === null)}
                      {...(readOnly && !membership ? { title: "Favorites changes are not connected yet" } : {})}
                      className={
                        favorites && isMember(favorites, skill)
                          ? "rd-starred"
                          : undefined
                      }
                      label={`${favorites && isMember(favorites, skill) ? "Unstar" : "Star"} ${skill.name}`}
                      aria-pressed={Boolean(
                        favorites && isMember(favorites, skill),
                      )}
                      onClick={() =>
                        favorite(
                          [skill],
                          !(favorites && isMember(favorites, skill)),
                        )
                      }
                    >
                      <Star />
                    </IconAction>
                    {readOnly && !membership ? (
                      <IconAction
                        label={`Add ${skill.name} to set`}
                        disabled
                        title="Set changes are not connected yet"
                      >
                        <ListPlus />
                      </IconAction>
                    ) : (
                      <MembershipPicker
                        skill={skill}
                        sets={sets}
                        actions={actions}
                        newSet={create}
                        membership={membership}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <EmptyState
            title="No skills found"
            description={
              skills.length
                ? "Try a different filter or search term."
                : "Your synced skills will appear here."
            }
          />
        )}
      </div>
      <p className="rd-footnote">
        {skills.length} skills from{" "}
        {skills.reduce((count, skill) => count + skill.allSkillIds.length, 0)}{" "}
        installs
      </p>
    </>
  );
}
