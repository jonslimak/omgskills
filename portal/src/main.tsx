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

type ApiState = {
  syncedSkills: SyncedSkill[];
  groups: SkillGroup[];
  sharedGroups: SkillGroup[];
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

function GroupsPanel({ title, groups }: { title: string; groups: SkillGroup[] }) {
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
            {group.allowedEmailCount !== undefined ? <span>{group.allowedEmailCount} emails</span> : null}
          </div>
        ))}
        {groups.length === 0 ? <p className="muted">No groups yet.</p> : null}
      </div>
    </section>
  );
}

function Dashboard() {
  const api = usePortalApi();
  const { user } = useUser();
  const [state, setState] = useState<ApiState>({ syncedSkills: [], groups: [], sharedGroups: [] });
  const [status, setStatus] = useState("Loading...");

  async function refresh() {
    try {
      const [synced, groups, shared] = await Promise.all([
        api<{ skills: SyncedSkill[] }>("/api/portal/synced-skills"),
        api<{ groups: SkillGroup[] }>("/api/portal/groups"),
        api<{ groups: SkillGroup[] }>("/api/portal/shared")
      ]);
      setState({
        syncedSkills: synced.skills,
        groups: groups.groups,
        sharedGroups: shared.groups
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
      <SyncedSkillsPanel skills={state.syncedSkills} onRefresh={refresh} />
      <CreateGroupPanel skills={state.syncedSkills} onCreated={refresh} />
      <GroupsPanel title="My Skill Groups" groups={state.groups} />
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
