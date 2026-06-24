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

type SyncedSkill = {
  id: string;
  name: string;
  description: string | null;
  githubUrl: string | null;
  isLocalOnly: boolean;
  source: string;
  lastSeenAt: string;
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

function SyncTokenPanel() {
  const api = usePortalApi();
  const [token, setToken] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  async function createToken() {
    setStatus("Creating sync token...");
    try {
      const result = await api<{ token: string; expiresAt: string }>("/api/portal/sync-token", {
        method: "POST",
        body: JSON.stringify({})
      });
      setToken(result.token);
      setExpiresAt(result.expiresAt);
      setStatus("Token ready. Use it in the macOS app Sync step.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create token");
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Sync omgskills app</h2>
          <p>Generate a short-lived one-use token for your local app.</p>
        </div>
        <button onClick={createToken}>Create token</button>
      </div>
      {token ? (
        <div className="token-box">
          <code>{token}</code>
          <span>Expires {new Date(expiresAt).toLocaleTimeString()}</span>
        </div>
      ) : null}
      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}

function SkillActions({
  skill,
  groups,
  onRefresh
}: {
  skill: SyncedSkill;
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  const api = usePortalApi();
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState("");
  const favoritesGroup = groups.find((group) => group.isFavorites);
  const isFavorite = Boolean(favoritesGroup?.syncedSkillIds?.includes(skill.id));
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
    if (group.syncedSkillIds?.includes(skill.id)) {
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
                const alreadyAdded = group.syncedSkillIds?.includes(skill.id) ?? false;
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
  skill: SyncedSkill;
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
        <span>{skill.source}</span>
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
  skills: SyncedSkill[];
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  return (
    <div className="skill-table-wrap">
      <table className="skill-table">
        <thead>
          <tr>
            <th>Skill</th>
            <th>Source</th>
            <th>GitHub</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => (
            <tr key={skill.id}>
              <td className="skill-table-name">{skill.name}</td>
              <td>{skill.source}</td>
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

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Synced Skills</h2>
          <p>{skills.length} current skills from your local app inventory.</p>
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
      {viewMode === "table" && skills.length > 0 ? (
        <SyncedSkillsTable groups={groups} onRefresh={onRefresh} skills={skills} />
      ) : (
        <div className="list">
          {skills.map((skill) => (
            <SyncedSkillRow groups={groups} key={skill.id} onRefresh={onRefresh} skill={skill} />
          ))}
          {skills.length === 0 ? <p className="muted">No synced skills yet.</p> : null}
        </div>
      )}
    </section>
  );
}

function ProfilePanel({ profile, onRefresh }: { profile: Profile | null; onRefresh: () => void }) {
  const api = usePortalApi();
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [published, setPublished] = useState(profile?.profilePublished ?? false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setHandle(profile?.handle ?? "");
    setPublished(profile?.profilePublished ?? false);
  }, [profile]);

  async function saveProfile() {
    setStatus("Saving profile...");
    try {
      await api("/api/portal/profile", {
        method: "PATCH",
        body: JSON.stringify({ handle, profilePublished: published })
      });
      setStatus("Profile saved.");
      onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save profile");
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Public Profile</h2>
          <p>{profile?.publicUrl ? <a href={profile.publicUrl}>{profile.publicUrl}</a> : "Publish to create a public URL."}</p>
        </div>
        <button onClick={saveProfile}>Save</button>
      </div>
      <div className="form-grid">
        <label>
          Handle
          <input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="your-handle" />
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} />
          Published
        </label>
      </div>
      {status ? <p className="status">{status}</p> : null}
    </section>
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
  const [newGroupEmail, setNewGroupEmail] = useState("");

  async function createGroup() {
    setStatus("Creating group...");
    try {
      const created = await api<{ groupId: string }>("/api/portal/groups", {
        method: "POST",
        body: JSON.stringify({
          name: newGroupName,
          visibility: "restricted",
          syncedSkillIds: []
        })
      });

      if (newGroupEmail.trim()) {
        await api(`/api/portal/groups/${created.groupId}/allowed-emails`, {
          method: "POST",
          body: JSON.stringify({ email: newGroupEmail })
        });
      }

      setStatus("Group created.");
      setNewGroupName("Team Skills");
      setNewGroupEmail("");
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
          {canManage ? <p>Create a group, then add skills from the synced feed above.</p> : null}
        </div>
      </div>
      {canManage ? (
        <div className="compact-create">
          <label>
            Group name
            <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} />
          </label>
          <label>
            Allowed email
            <input
              value={newGroupEmail}
              onChange={(event) => setNewGroupEmail(event.target.value)}
              placeholder="teammate@example.com"
            />
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
  const { user } = useUser();
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
      <header className="topbar">
        <div>
          <p className="eyebrow">Skill Groups</p>
          <h1>omgskills portal</h1>
          <p>{user?.primaryEmailAddress?.emailAddress}</p>
        </div>
        <UserButton />
      </header>

      {status ? <p className="status">{status}</p> : null}
      <SyncTokenPanel />
      <ProfilePanel profile={state.profile} onRefresh={refresh} />
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
