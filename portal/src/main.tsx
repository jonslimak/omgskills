import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
  useUser
} from "@clerk/clerk-react";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function publicSiteOrigin() {
  if (window.location.hostname === "app.omgskills.com") {
    return "https://omgskills.com";
  }

  return window.location.origin;
}

function publicGroupUrl(handle: string, slug: string) {
  return `${publicSiteOrigin()}/u/${handle}/${slug}`;
}

function normalizedSkillText(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedDescriptionWords(value: string | null | undefined) {
  return normalizedSkillText(value)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((word) => word.length > 2);
}

function descriptionsMatch(first: string | null | undefined, second: string | null | undefined) {
  const normalizedFirst = normalizedSkillText(first);
  const normalizedSecond = normalizedSkillText(second);

  if (normalizedFirst === normalizedSecond) {
    return true;
  }
  if (!normalizedFirst || !normalizedSecond) {
    return false;
  }
  if (
    Math.min(normalizedFirst.length, normalizedSecond.length) >= 35 &&
    (normalizedFirst.includes(normalizedSecond) || normalizedSecond.includes(normalizedFirst))
  ) {
    return true;
  }

  const firstWords = new Set(normalizedDescriptionWords(normalizedFirst));
  const secondWords = new Set(normalizedDescriptionWords(normalizedSecond));
  const smallerSize = Math.min(firstWords.size, secondWords.size);

  let shared = 0;
  for (const word of firstWords) {
    if (secondWords.has(word)) {
      shared += 1;
    }
  }

  if (smallerSize >= 3 && smallerSize < 5) {
    return shared / smallerSize >= 0.8;
  }

  if (smallerSize < 5) {
    return false;
  }

  return shared / smallerSize >= 0.72;
}

function normalizedSource(value: string) {
  return value.toLowerCase();
}

function hasSource(skill: GroupedSyncedSkill, source: string) {
  const target = source.toLowerCase();
  return skill.sources.some((item) => normalizedSource(item).includes(target));
}

function chooseRepresentativeSkill(skills: SyncedSkill[]) {
  const representative =
    skills.find((skill) => normalizedSource(skill.source).includes("codex")) ??
    skills.find((skill) => Boolean(skill.githubUrl)) ??
    [...skills].sort((first, second) => first.source.localeCompare(second.source))[0];

  if (!representative) {
    throw new Error("Cannot group empty synced skill set");
  }

  return representative;
}

function groupSyncedSkills(skills: SyncedSkill[]): GroupedSyncedSkill[] {
  const groups: SyncedSkill[][] = [];
  for (const skill of skills) {
    const skillName = normalizedSkillText(skill.name);
    const matchingGroup = groups.find((group) => {
      const firstSkill = group[0];
      if (normalizedSkillText(firstSkill.name) !== skillName) {
        return false;
      }
      if (skill.githubUrl && firstSkill.githubUrl && skill.githubUrl === firstSkill.githubUrl) {
        return true;
      }
      return group.some((groupSkill) => descriptionsMatch(groupSkill.description, skill.description));
    });

    if (matchingGroup) {
      matchingGroup.push(skill);
    } else {
      groups.push([skill]);
    }
  }

  return groups
    .map((group) => {
      const representative = chooseRepresentativeSkill(group);
      const bestDescription =
        [...group]
          .map((skill) => skill.description)
          .filter((description): description is string => Boolean(description))
          .sort((first, second) => second.length - first.length)[0] ?? null;
      const sources = [...new Set(group.map((skill) => skill.source))].sort((first, second) =>
        first.localeCompare(second)
      );
      return {
        ...representative,
        description: bestDescription,
        githubUrl: representative.githubUrl ?? group.find((skill) => skill.githubUrl)?.githubUrl ?? null,
        allSkillIds: group.map((skill) => skill.id),
        sourceSkills: group,
        sources
      };
    })
    .sort((first, second) => first.name.localeCompare(second.name));
}

type SyncedSkill = {
  id: string;
  name: string;
  description: string | null;
  githubUrl: string | null;
  isLocalOnly: boolean;
  source: string;
  lastSeenAt: string;
};

type GroupedSyncedSkill = SyncedSkill & {
  allSkillIds: string[];
  sourceSkills: SyncedSkill[];
  sources: string[];
};

type SkillGroup = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  visibility?: string;
  isFavorites?: boolean;
  disabledAt?: string | null;
  itemCount: number;
  allowedEmailCount?: number;
  allowedEmails?: { id: string; email: string }[];
  ownerDisplayName?: string;
  syncedSkillIds?: string[];
};

type SkillGroupItem = {
  id: string;
  kind: string;
  name: string;
  description: string;
  githubUrl: string | null;
  source: string;
  position: number;
};

type SkillGroupDetail = SkillGroup & {
  accessRole: "owner" | "invited";
  allowedEmails?: { id: string; email: string }[];
};

type Profile = {
  handle: string | null;
  profilePublished: boolean;
  publicUrl: string | null;
};

type ApiState = {
  syncedSkills: SyncedSkill[];
  groups: SkillGroup[];
  sharedGroups: SkillGroup[];
  profile: Profile | null;
};

function usePortalApi() {
  const { getToken } = useAuth();

  return async function portalApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error ?? `Request failed with ${response.status}`);
    }
    return body as T;
  };
}

function SyncAppButton() {
  const api = usePortalApi();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [token, setToken] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [copyStatus, setCopyStatus] = useState<string>("");

  useEffect(() => {
    if (!isPopoverOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPopoverOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isPopoverOpen]);

  function openPopover() {
    setIsPopoverOpen(true);
    setStatus("");
    setCopyStatus("");
  }

  async function createToken() {
    setStatus("Generating new token...");
    setCopyStatus("");
    try {
      const result = await api<{ token: string; expiresAt: string }>("/api/portal/sync-token", {
        method: "POST",
        body: JSON.stringify({})
      });
      setToken(result.token);
      setStatus("Token is ready.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create token");
    }
  }

  async function copyToken() {
    if (!token) {
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      setCopyStatus("Copied.");
    } catch {
      setCopyStatus("Select and copy the token.");
    }
  }

  return (
    <>
      <button onClick={openPopover}>Sync app</button>
      {isPopoverOpen ? (
        <div className="sync-modal-overlay" onClick={() => setIsPopoverOpen(false)} role="presentation">
          <div
            aria-modal="true"
            className="sync-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2>Sync your app</h2>
            <div className="sync-step">
              <h3>Step 1</h3>
              <p>Generate a one time token for your local app</p>
              <button onClick={createToken}>Generate new token</button>
              <div className="sync-token-area">
                {token ? (
                  <button className="sync-token-button" onClick={copyToken} title="Copy token" type="button">
                    {token}
                  </button>
                ) : null}
                {status ? <p className="sync-status">{status}</p> : null}
                {copyStatus ? <p className="sync-status">{copyStatus}</p> : null}
              </div>
            </div>
            <div className="sync-step">
              <h3>Step 2</h3>
              <p>Open the app and tap on the user icon.</p>
              <p>Paste the token in the token input box.</p>
              <p>That's it!</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SkillActions({
  skill,
  groups,
  onRefresh
}: {
  skill: GroupedSyncedSkill;
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  const api = usePortalApi();
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState("");
  const favoritesGroup = groups.find((group) => group.isFavorites);
  const isFavorite = Boolean(favoritesGroup?.syncedSkillIds?.some((id) => skill.allSkillIds.includes(id)));
  const selectableGroups = groups.filter((group) => !group.isFavorites);

  async function addToFavorites() {
    if (isFavorite) {
      return;
    }
    setStatus("Adding to Favorites...");
    try {
      if (favoritesGroup) {
        await api(`/api/portal/groups/${favoritesGroup.id}/items`, {
          method: "POST",
          body: JSON.stringify({ kind: "synced", syncedSkillId: skill.id })
        });
      } else {
        await api("/api/portal/groups", {
          method: "POST",
          body: JSON.stringify({
            name: "Favorite Skills",
            visibility: "public",
            isFavorites: true,
            syncedSkillIds: [skill.id]
          })
        });
      }
      setStatus("");
      onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add to Favorites");
    }
  }

  async function addToGroup(group: SkillGroup) {
    if (group.syncedSkillIds?.some((id) => skill.allSkillIds.includes(id))) {
      return;
    }
    setStatus(`Adding to ${group.name}...`);
    try {
      await api(`/api/portal/groups/${group.id}/items`, {
        method: "POST",
        body: JSON.stringify({ kind: "synced", syncedSkillId: skill.id })
      });
      setStatus("");
      setMenuOpen(false);
      onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add to group");
    }
  }

  return (
    <div className="skill-action-stack">
      <div className="skill-actions">
        <button
          aria-label={isFavorite ? "Already in Favorites" : "Add to Favorites"}
          className={isFavorite ? "icon-button active" : "icon-button"}
          disabled={isFavorite}
          onClick={addToFavorites}
          title={isFavorite ? "Already in Favorites" : "Add to Favorites"}
        >
          {isFavorite ? "★" : "☆"}
        </button>
        <div className="menu-wrap">
          <button
            aria-expanded={menuOpen}
            aria-label="Add to group"
            className="icon-button"
            onClick={() => setMenuOpen((current) => !current)}
            title="Add to group"
          >
            ⊞
          </button>
          {menuOpen ? (
            <div className="group-menu">
              {selectableGroups.length === 0 ? <span>No groups yet</span> : null}
              {selectableGroups.map((group) => {
                const alreadyAdded = group.syncedSkillIds?.some((id) => skill.allSkillIds.includes(id)) ?? false;
                return (
                  <button
                    disabled={alreadyAdded}
                    key={group.id}
                    onClick={() => addToGroup(group)}
                    type="button"
                  >
                    {group.name}
                    {alreadyAdded ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      {status ? <p className="inline-status">{status}</p> : null}
    </div>
  );
}

function SyncedSkillRow({
  skill,
  groups,
  onRefresh
}: {
  skill: GroupedSyncedSkill;
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const description = skill.description || "No description";
  const canExpand = description.length > 90;

  function isInteractiveTarget(target: EventTarget | null) {
    return target instanceof HTMLElement
      ? Boolean(target.closest("a, button, input, select, textarea"))
      : false;
  }

  function expandFromRow(event: React.MouseEvent<HTMLDivElement>) {
    if (!canExpand || expanded || isInteractiveTarget(event.target)) {
      return;
    }

    setExpanded(true);
  }

  function expandFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!canExpand || expanded || event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setExpanded(true);
    }
  }

  return (
    <div
      aria-expanded={canExpand ? expanded : undefined}
      className={canExpand && !expanded ? "row expandable-row" : "row"}
      onClick={expandFromRow}
      onKeyDown={expandFromKeyboard}
      role={canExpand ? "button" : undefined}
      tabIndex={canExpand && !expanded ? 0 : undefined}
    >
      <div className="row-main">
        <h3 className="skill-title">
          <span>{skill.name}</span>
          {skill.githubUrl ? (
            <a href={skill.githubUrl} title="Open GitHub source">
              GitHub →
            </a>
          ) : null}
        </h3>
        <p className={expanded ? "skill-description expanded" : "skill-description"}>{description}</p>
        {canExpand && expanded ? (
          <button className="text-button" onClick={() => setExpanded(false)}>
            Show less
          </button>
        ) : null}
        <div className="source-badges">
          {skill.sources.map((source) => (
            <span key={source}>{source}</span>
          ))}
        </div>
      </div>
      <SkillActions groups={groups} onRefresh={onRefresh} skill={skill} />
    </div>
  );
}

function SyncedSkillsTable({
  skills,
  groups,
  onRefresh
}: {
  skills: GroupedSyncedSkill[];
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  return (
    <div className="skill-table-wrap">
      <table className="skill-table">
        <thead>
          <tr>
            <th>Skill</th>
            <th>Claude</th>
            <th>Codex</th>
            <th>GitHub</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => (
            <tr key={skill.id}>
              <td className="skill-table-name">{skill.name}</td>
              <td>{hasSource(skill, "claude") ? "✓" : ""}</td>
              <td>{hasSource(skill, "codex") ? "✓" : ""}</td>
              <td>
                {skill.githubUrl ? (
                  <a href={skill.githubUrl} title="Open GitHub source">
                    GitHub →
                  </a>
                ) : null}
              </td>
              <td>
                <SkillActions groups={groups} onRefresh={onRefresh} skill={skill} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SyncedSkillsPanel({
  skills,
  groups,
  onRefresh
}: {
  skills: SyncedSkill[];
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  const [viewMode, setViewMode] = useState<"list" | "table">(() =>
    window.localStorage.getItem("syncedSkillsViewMode") === "table" ? "table" : "list"
  );

  function updateViewMode(nextViewMode: "list" | "table") {
    setViewMode(nextViewMode);
    window.localStorage.setItem("syncedSkillsViewMode", nextViewMode);
  }

  const groupedSkills = groupSyncedSkills(skills);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Synced Skills</h2>
          <p>
            {groupedSkills.length} skills from {skills.length} installs.
          </p>
        </div>
        <div className="panel-controls">
          <div aria-label="Synced skills view" className="segmented-control">
            <button
              aria-pressed={viewMode === "list"}
              className={viewMode === "list" ? "active" : ""}
              onClick={() => updateViewMode("list")}
              type="button"
            >
              List
            </button>
            <button
              aria-pressed={viewMode === "table"}
              className={viewMode === "table" ? "active" : ""}
              onClick={() => updateViewMode("table")}
              type="button"
            >
              Table
            </button>
          </div>
          <button className="secondary" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>
      {viewMode === "table" && groupedSkills.length > 0 ? (
        <SyncedSkillsTable groups={groups} onRefresh={onRefresh} skills={groupedSkills} />
      ) : (
        <div className="list">
          {groupedSkills.map((skill) => (
            <SyncedSkillRow groups={groups} key={skill.id} onRefresh={onRefresh} skill={skill} />
          ))}
          {groupedSkills.length === 0 ? <p className="muted">No synced skills yet.</p> : null}
        </div>
      )}
    </section>
  );
}

function ProfileHeaderControls({
  profile,
  onRefresh,
  syncAction
}: {
  profile: Profile | null;
  onRefresh: () => void;
  syncAction?: React.ReactNode;
}) {
  const api = usePortalApi();
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [published, setPublished] = useState(profile?.profilePublished ?? false);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  const savedHandle = profile?.handle ?? "";
  const hasSavedHandle = Boolean(savedHandle);
  const mode = !hasSavedHandle ? "setup" : editing ? "edit" : "view";

  useEffect(() => {
    setHandle(profile?.handle ?? "");
    setPublished(profile?.profilePublished ?? false);
    setEditing(false);
  }, [profile]);

  async function saveProfile(nextPublished = published) {
    setStatus("Saving profile...");
    try {
      await api("/api/portal/profile", {
        method: "PATCH",
        body: JSON.stringify({ handle, profilePublished: nextPublished })
      });
      setStatus("Profile saved.");
      onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save profile");
    }
  }

  async function updatePublished(nextPublished: boolean) {
    setPublished(nextPublished);
    await saveProfile(nextPublished);
  }

  return (
    <div className="dashboard-profile">
      {mode === "view" && profile?.publicUrl ? (
        <div className="username-row">
          <a className="username-link" href={profile.publicUrl}>/{savedHandle}</a>
          <button className="compact" onClick={() => setEditing(true)}>Edit</button>
          {syncAction}
        </div>
      ) : (
        <div className="username-row">
          <input
            className="username-input"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="Set your username"
          />
          <button className="compact" disabled={!handle.trim()} onClick={() => saveProfile()}>
            save
          </button>
          {syncAction}
        </div>
      )}
      <div className="username-meta">
        <span>Username</span>
        <label className={published ? "publish-toggle public" : "publish-toggle private"}>
          {published ? "Public" : "Private"}
          <input
            type="checkbox"
            checked={published}
            onChange={(event) => updatePublished(event.target.checked)}
          />
        </label>
      </div>
      {status ? <p className="inline-status">{status}</p> : null}
    </div>
  );
}

function GroupsPanel({
  title,
  groups,
  onRefresh,
  canManage = false,
  profile
}: {
  title: string;
  groups: SkillGroup[];
  onRefresh?: () => void;
  canManage?: boolean;
  profile?: Profile | null;
}) {
  const api = usePortalApi();
  const [status, setStatus] = useState("");
  const [newGroupName, setNewGroupName] = useState("Team Skills");

  async function createGroup() {
    setStatus("Creating group...");
    try {
      await api<{ groupId: string }>("/api/portal/groups", {
        method: "POST",
        body: JSON.stringify({
          name: newGroupName,
          visibility: "restricted",
          syncedSkillIds: []
        })
      });

      setStatus("Group created.");
      setNewGroupName("Team Skills");
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create group");
    }
  }

  async function setVisibility(group: SkillGroup, visibility: string) {
    setStatus("Updating group...");
    try {
      await api(`/api/portal/groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility })
      });
      setStatus("Group updated.");
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update group");
    }
  }

  async function setDisabled(group: SkillGroup, disabled: boolean) {
    setStatus("Updating moderation state...");
    try {
      await api(`/api/portal/groups/${group.id}/moderation`, {
        method: "PATCH",
        body: JSON.stringify({ disabled })
      });
      setStatus(disabled ? "Group hidden." : "Group restored.");
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update moderation state");
    }
  }

  function isInteractiveTarget(target: EventTarget | null) {
    return target instanceof HTMLElement
      ? Boolean(target.closest("a, button, input, select, textarea"))
      : false;
  }

  function openGroup(groupId: string, event: React.MouseEvent<HTMLDivElement>) {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    window.location.href = `/app/groups/${groupId}`;
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      {canManage ? (
        <div className="compact-create">
          <label>
            Group name
            <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} />
          </label>
          <button disabled={!newGroupName.trim()} onClick={createGroup}>Create group</button>
        </div>
      ) : null}
      <div className="list">
        {groups.map((group) => (
            <div
              className={
                group.disabledAt
                  ? "row group-row disabled-row"
                  : "row group-row expandable-row"
              }
              key={group.id}
              onClick={(event) => openGroup(group.id, event)}
            >
              <div className="group-row-summary">
                <div>
                  <h3>{group.name}</h3>
                  <p className="group-meta">
                    <span>{group.description || `${group.itemCount} skills`}</span>
                    <span>{group.visibility || "restricted"}</span>
                  </p>
                  {group.disabledAt || group.ownerDisplayName ? (
                    <span>
                      {group.disabledAt ? "hidden" : ""}
                      {group.ownerDisplayName ? ` · ${group.ownerDisplayName}` : ""}
                    </span>
                  ) : null}
                </div>
                <div className="row-actions">
                  {group.allowedEmailCount !== undefined ? <span>{group.allowedEmailCount} emails</span> : null}
                  {canManage ? (
                    <>
                      <button
                        aria-label={group.visibility === "public" ? "Unpublish group" : "Publish group"}
                        className={group.visibility === "public" ? "icon-button active" : "icon-button"}
                        onClick={() => setVisibility(group, group.visibility === "public" ? "restricted" : "public")}
                        title={group.visibility === "public" ? "Public. Click to unpublish." : "Private/restricted. Click to publish."}
                      >
                        {group.visibility === "public" ? "●" : "○"}
                      </button>
                      {group.visibility === "public" && !group.disabledAt && profile?.handle ? (
                        <a
                          aria-label="Open public group URL"
                          className="icon-link"
                          href={publicGroupUrl(profile.handle, group.slug)}
                          title="Open public URL"
                        >
                          ↗
                        </a>
                      ) : null}
                      <a
                        aria-label="Export group"
                        className="icon-link"
                        href={`/api/portal/groups/${group.id}/export`}
                        title="Export group"
                      >
                        ↓
                      </a>
                      <button
                        aria-label={group.disabledAt ? "Restore group" : "Hide group"}
                        className={group.disabledAt ? "icon-button warning active" : "icon-button warning"}
                        onClick={() => setDisabled(group, !group.disabledAt)}
                        title={group.disabledAt ? "Hidden. Click to restore." : "Hide group from public pages."}
                      >
                        {group.disabledAt ? "↺" : "⊘"}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
        ))}
        {groups.length === 0 ? <p className="muted">No groups yet.</p> : null}
      </div>
      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}

function GroupDetailPage({ groupId }: { groupId: string }) {
  const api = usePortalApi();
  const { user } = useUser();
  const [group, setGroup] = useState<SkillGroupDetail | null>(null);
  const [items, setItems] = useState<SkillGroupItem[]>([]);
  const [status, setStatus] = useState("Loading group...");
  const [emailToAdd, setEmailToAdd] = useState("");
  const [showEmailInput, setShowEmailInput] = useState(false);

  async function loadGroup() {
    setStatus("Loading group...");
    try {
      const result = await api<{
        group: SkillGroupDetail;
        items: SkillGroupItem[];
        accessRole: "owner" | "invited";
      }>(`/api/portal/groups/${groupId}`);
      setGroup({ ...result.group, accessRole: result.accessRole });
      setItems(result.items);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load group");
    }
  }

  async function addAllowedEmail() {
    const email = emailToAdd.trim();
    if (!email || !group) {
      return;
    }

    setStatus("Adding email...");
    try {
      await api(`/api/portal/groups/${group.id}/allowed-emails`, {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setEmailToAdd("");
      setShowEmailInput(false);
      await loadGroup();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add email");
    }
  }

  async function removeAllowedEmail(emailId: string) {
    if (!group) {
      return;
    }

    setStatus("Removing email...");
    try {
      await api(`/api/portal/groups/${group.id}/allowed-emails`, {
        method: "DELETE",
        body: JSON.stringify({ emailId })
      });
      await loadGroup();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to remove email");
    }
  }

  useEffect(() => {
    void loadGroup();
  }, [groupId]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Skill Group</p>
          <h1>{group?.name ?? "Skill Group"}</h1>
          <p>{user?.primaryEmailAddress?.emailAddress}</p>
        </div>
        <UserButton />
      </header>

      <a href="/app/" className="back-link">← Back to portal</a>
      {status ? <p className="status">{status}</p> : null}

      {group ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>{group.name}</h2>
                <p className="group-meta">
                  <span>{group.itemCount} skills</span>
                  <span>{group.visibility || "restricted"}</span>
                  <span>{group.accessRole}</span>
                  {group.ownerDisplayName ? <span>{group.ownerDisplayName}</span> : null}
                </p>
              </div>
            </div>
            {group.description ? <p>{group.description}</p> : null}
          </section>

          <section className="panel">
            <h2>Skills</h2>
            <div className="group-skills-panel">
              {items.map((item) => (
                <div className="group-skill-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    {item.description ? <p>{item.description}</p> : null}
                  </div>
                  {item.githubUrl ? (
                    <a href={item.githubUrl} title="Open GitHub source">
                      GitHub →
                    </a>
                  ) : null}
                </div>
              ))}
              {items.length === 0 ? <p className="muted">No skills in this group yet.</p> : null}
            </div>
          </section>

          {group.accessRole === "owner" ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Allowed Emails</h2>
                  <p>People signed in with these emails can view this restricted group.</p>
                </div>
              </div>
              <div className="email-list">
                {(group.allowedEmails ?? []).map((allowedEmail) => (
                  <div className="email-row" key={allowedEmail.id}>
                    <span>{allowedEmail.email}</span>
                    <button
                      aria-label={`Remove ${allowedEmail.email}`}
                      className="icon-button warning"
                      onClick={() => removeAllowedEmail(allowedEmail.id)}
                      title="Remove email"
                      type="button"
                    >
                      ⌫
                    </button>
                  </div>
                ))}
                {(group.allowedEmails ?? []).length === 0 ? <p className="muted">No emails added.</p> : null}
              </div>
              {showEmailInput ? (
                <div className="inline-email-form">
                  <input
                    autoFocus
                    onChange={(event) => setEmailToAdd(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        addAllowedEmail();
                      }
                    }}
                    placeholder="teammate@example.com"
                    value={emailToAdd}
                  />
                  <button disabled={!emailToAdd.trim()} onClick={addAllowedEmail} type="button">
                    Add
                  </button>
                </div>
              ) : (
                <button className="text-button" onClick={() => setShowEmailInput(true)} type="button">
                  Add new email +
                </button>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function Dashboard() {
  const api = usePortalApi();
  const [state, setState] = useState<ApiState>({ syncedSkills: [], groups: [], sharedGroups: [], profile: null });
  const [status, setStatus] = useState("Loading...");

  async function refresh() {
    try {
      const [synced, groups, shared, profile] = await Promise.all([
        api<{ skills: SyncedSkill[] }>("/api/portal/synced-skills"),
        api<{ groups: SkillGroup[] }>("/api/portal/groups"),
        api<{ groups: SkillGroup[] }>("/api/portal/shared"),
        api<{ profile: Profile }>("/api/portal/profile")
      ]);
      setState({
        syncedSkills: synced.skills,
        groups: groups.groups,
        sharedGroups: shared.groups,
        profile: profile.profile
      });
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load portal data");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <main className="shell">
      <header className="dashboard-header">
        <div className="dashboard-identity">
          <a aria-label="Home" className="eyes-logo" href="/app/">👀</a>
          <ProfileHeaderControls profile={state.profile} onRefresh={refresh} syncAction={<SyncAppButton />} />
        </div>
        <div className="dashboard-actions">
          <UserButton />
        </div>
      </header>

      {status ? <p className="status">{status}</p> : null}
      <GroupsPanel title="My Skill Groups" groups={state.groups} onRefresh={refresh} canManage profile={state.profile} />
      <SyncedSkillsPanel groups={state.groups} skills={state.syncedSkills} onRefresh={refresh} />
      <GroupsPanel title="Shared With Me" groups={state.sharedGroups} />
    </main>
  );
}

function App() {
  const groupDetailMatch = window.location.pathname.match(/^\/app\/groups\/([^/]+)\/?$/);

  return (
    <>
      <SignedOut>
        <main className="shell auth-shell">
          <section className="hero">
            <p className="eyebrow">omgskills</p>
            <h1>Sign in to manage Skill Groups</h1>
            <p>Sync local skills, build a restricted group, and share it with a teammate by email.</p>
            <div className="actions">
              <SignInButton mode="modal">
                <button>Sign in</button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="secondary">Create account</button>
              </SignUpButton>
            </div>
          </section>
        </main>
      </SignedOut>
      <SignedIn>
        {groupDetailMatch ? <GroupDetailPage groupId={decodeURIComponent(groupDetailMatch[1])} /> : <Dashboard />}
      </SignedIn>
    </>
  );
}

if (!publishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
);
