import React, { useEffect, useMemo, useState } from "react";
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
  itemCount: number;
  allowedEmailCount?: number;
  ownerDisplayName?: string;
};

type CatalogSkill = {
  id: string;
  name: string;
  description: string | null;
  githubUrl: string | null;
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

function SyncedSkillsPanel({ skills, onRefresh }: { skills: SyncedSkill[]; onRefresh: () => void }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Synced Skills</h2>
          <p>{skills.length} current skills from your local app inventory.</p>
        </div>
        <button className="secondary" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <div className="list">
        {skills.map((skill) => (
          <div className="row" key={skill.id}>
            <div>
              <h3>{skill.name}</h3>
              <p>{skill.description || "No description"}</p>
              <span>
                {skill.source}
                {skill.isLocalOnly ? " · local-only" : ""}
              </span>
            </div>
            {skill.githubUrl ? <a href={skill.githubUrl}>GitHub</a> : <span className="muted">Metadata only</span>}
          </div>
        ))}
        {skills.length === 0 ? <p className="muted">No synced skills yet.</p> : null}
      </div>
    </section>
  );
}

function CreateGroupPanel({
  skills,
  onCreated
}: {
  skills: SyncedSkill[];
  onCreated: () => void;
}) {
  const api = usePortalApi();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [name, setName] = useState("Team Skills");
  const [email, setEmail] = useState("");
  const [isFavorites, setIsFavorites] = useState(false);
  const [status, setStatus] = useState("");

  const selectedSkillIds = useMemo(() => [...selectedIds], [selectedIds]);

  function toggleSkill(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function createGroup() {
    setStatus("Creating group...");
    try {
      const created = await api<{ groupId: string }>("/api/portal/groups", {
        method: "POST",
        body: JSON.stringify({
          name,
          visibility: "restricted",
          isFavorites,
          syncedSkillIds: selectedSkillIds
        })
      });

      if (email.trim()) {
        await api(`/api/portal/groups/${created.groupId}/allowed-emails`, {
          method: "POST",
          body: JSON.stringify({ email })
        });
      }

      setStatus("Restricted group created.");
      setSelectedIds(new Set());
      setIsFavorites(false);
      onCreated();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create group");
    }
  }

  return (
    <section className="panel">
      <h2>Create restricted Skill Group</h2>
      <div className="form-grid">
        <label>
          Group name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Allowed email
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" />
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={isFavorites} onChange={(event) => setIsFavorites(event.target.checked)} />
          Favorites
        </label>
      </div>
      <div className="check-list">
        {skills.map((skill) => (
          <label key={skill.id}>
            <input
              type="checkbox"
              checked={selectedIds.has(skill.id)}
              onChange={() => toggleSkill(skill.id)}
            />
            <span>{skill.name}</span>
          </label>
        ))}
      </div>
      <button disabled={selectedSkillIds.length === 0} onClick={createGroup}>
        Create group
      </button>
      {status ? <p className="status">{status}</p> : null}
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
  const [catalogQuery, setCatalogQuery] = useState<Record<string, string>>({});
  const [catalogResults, setCatalogResults] = useState<Record<string, CatalogSkill[]>>({});
  const [githubUrls, setGithubUrls] = useState<Record<string, string>>({});

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

  async function searchCatalog(group: SkillGroup) {
    setStatus("Searching catalog...");
    try {
      const query = catalogQuery[group.id] ?? "";
      const result = await api<{ skills: CatalogSkill[] }>(`/api/portal/catalog-search?q=${encodeURIComponent(query)}`);
      setCatalogResults((current) => ({ ...current, [group.id]: result.skills }));
      setStatus(result.skills.length ? "Catalog results ready." : "No catalog results.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Catalog search failed");
    }
  }

  async function addCatalogSkill(group: SkillGroup, skill: CatalogSkill) {
    setStatus("Adding catalog skill...");
    try {
      await api(`/api/portal/groups/${group.id}/items`, {
        method: "POST",
        body: JSON.stringify({ kind: "catalog", catalogSkillId: skill.id, note: skill.description })
      });
      setStatus("Catalog skill added.");
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add catalog skill");
    }
  }

  async function addGithubSkill(group: SkillGroup) {
    setStatus("Validating GitHub skill...");
    try {
      await api(`/api/portal/groups/${group.id}/items`, {
        method: "POST",
        body: JSON.stringify({ kind: "github", githubUrl: githubUrls[group.id] ?? "" })
      });
      setStatus("GitHub skill added.");
      setGithubUrls((current) => ({ ...current, [group.id]: "" }));
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add GitHub skill");
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

  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="list">
        {groups.map((group) => (
          <div className="row" key={group.id}>
            <div>
              <h3>{group.name}</h3>
              <p>{group.description || `${group.itemCount} skills`}</p>
              <span>
                {group.visibility || "restricted"}
                {group.ownerDisplayName ? ` · ${group.ownerDisplayName}` : ""}
              </span>
            </div>
            <div className="row-actions">
              {group.allowedEmailCount !== undefined ? <span>{group.allowedEmailCount} emails</span> : null}
              {canManage ? (
                <>
                  <button className="secondary" onClick={() => setVisibility(group, group.visibility === "public" ? "restricted" : "public")}>
                    {group.visibility === "public" ? "Unpublish" : "Publish"}
                  </button>
                  {group.visibility === "public" && profile?.handle ? (
                    <a href={`https://omgskills.com/u/${profile.handle}/${group.slug}`}>Public URL</a>
                  ) : null}
                  <a href={`/api/portal/groups/${group.id}/export`}>Export</a>
                  <button className="secondary" onClick={() => setDisabled(group, true)}>Disable</button>
                </>
              ) : null}
            </div>
            {canManage ? (
              <div className="group-tools">
                <div className="inline-form">
                  <input
                    value={catalogQuery[group.id] ?? ""}
                    onChange={(event) => setCatalogQuery((current) => ({ ...current, [group.id]: event.target.value }))}
                    placeholder="Search catalog"
                  />
                  <button className="secondary" onClick={() => searchCatalog(group)}>Search</button>
                </div>
                {(catalogResults[group.id] ?? []).slice(0, 3).map((skill) => (
                  <button className="secondary" key={skill.id} onClick={() => addCatalogSkill(group, skill)}>
                    Add {skill.name || skill.id}
                  </button>
                ))}
                <div className="inline-form">
                  <input
                    value={githubUrls[group.id] ?? ""}
                    onChange={(event) => setGithubUrls((current) => ({ ...current, [group.id]: event.target.value }))}
                    placeholder="GitHub skill URL"
                  />
                  <button className="secondary" onClick={() => addGithubSkill(group)}>Add GitHub</button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {groups.length === 0 ? <p className="muted">No groups yet.</p> : null}
      </div>
      {status ? <p className="status">{status}</p> : null}
    </section>
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
      <SyncedSkillsPanel skills={state.syncedSkills} onRefresh={refresh} />
      <CreateGroupPanel skills={state.syncedSkills} onCreated={refresh} />
      <GroupsPanel title="My Skill Groups" groups={state.groups} onRefresh={refresh} canManage profile={state.profile} />
      <GroupsPanel title="Shared With Me" groups={state.sharedGroups} />
    </main>
  );
}

function App() {
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
        <Dashboard />
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
