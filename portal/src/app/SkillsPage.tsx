import { useEffect, useState } from "react";
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
}: {
  skill: GroupedSyncedSkill;
  sets: PortalSet[];
  actions: PortalActions;
  newSet: (skills: GroupedSyncedSkill[]) => void;
}) {
  return (
    <PanelPopover
      label={`Sets for ${skill.name}`}
      trigger={
        <IconAction label={`Add ${skill.name} to set`}>
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
              onChange={(event) =>
                actions.membership(set.id, [skill], event.target.checked)
              }
            />
            <span>{set.name}</span>
          </label>
        ))}
      <div className="rd-menu-divider" />
      <Action variant="ghost" onClick={() => newSet([skill])}>
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
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (!edit) setSelected([]);
  }, [edit]);
  const sources = [...new Set(skills.flatMap((skill) => skill.sources))].sort();
  const rows = filterSkills(skills, query, source);
  const selectedSkills = skills.filter((skill) => selected.includes(skill.id));
  const favorites = sets.find((set) => set.isFavorites);
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
            <Action variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Action>
            <PanelPopover
              label="Choose target set"
              trigger={
                <Action>
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
                    onClick={() => {
                      actions.membership(set.id, selectedSkills, true);
                      setSelected([]);
                    }}
                  >
                    {set.name}
                  </Action>
                ))}
              <Action variant="ghost" onClick={() => newSet(selectedSkills)}>
                <Plus data-icon="inline-start" />
                New set...
              </Action>
            </PanelPopover>
            <Action
              variant="default"
              onClick={() => {
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
      <div className="rd-table-wrap">
        <table className="rd-table">
          <thead>
            <tr>
              {edit && (
                <th className="rd-selection">
                  <input
                    type="checkbox"
                    aria-label="Select all visible skills"
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
                      disabled={readOnly}
                      {...(readOnly ? { title: "Favorites changes are not connected yet" } : {})}
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
                        star(
                          [skill],
                          !(favorites && isMember(favorites, skill)),
                        )
                      }
                    >
                      <Star />
                    </IconAction>
                    {readOnly ? (
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
                        newSet={newSet}
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
