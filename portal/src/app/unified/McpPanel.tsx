import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { PortalApiError } from "../../api-error";
import type { PortalApi } from "../../portal-api";
import { Action, IconAction } from "../ui";

export const PUBLIC_MCP_URL = "https://omgskills.com/mcp";
export const MY_SKILLS_MCP_URL = "https://omgskills.com/api/library/mcp";

export type LibraryAgent = { clientId: string; name: string; firstUsedAt: string; lastUsedAt: string; blocked: boolean };

const base = "/api/portal/library-agents";

export async function loadLibraryAgents(api: PortalApi): Promise<LibraryAgent[]> {
  const value = await api<{ agents?: unknown }>(base, { cache: "no-store" });
  if (!Array.isArray(value?.agents)) throw new Error("Unexpected connected agents response.");
  return value.agents.flatMap(item => {
    const agent = item as Partial<LibraryAgent>;
    return typeof agent?.clientId === "string" && typeof agent.name === "string" ? [{
      clientId: agent.clientId, name: agent.name, firstUsedAt: String(agent.firstUsedAt ?? ""),
      lastUsedAt: String(agent.lastUsedAt ?? ""), blocked: agent.blocked === true }] : [];
  });
}

export function setLibraryAgentBlocked(api: PortalApi, clientId: string, blocked: boolean) {
  return api(base, { method: "PUT", body: JSON.stringify({ clientId, blocked }) });
}

const date = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString();
};

/** The MCP page: the public library address, and My skills for your own agents with the agents you connected. */
export function McpPanel({ api, denied }: { api: PortalApi; denied: () => void }) {
  const callbacks = useRef({ api, denied });
  callbacks.current = { api, denied };
  const [agents, setAgents] = useState<LibraryAgent[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const generation = useRef(0);

  function failed(cause: unknown, fallback: string) {
    if (cause instanceof PortalApiError && cause.status === 401) callbacks.current.denied();
    return cause instanceof Error && cause.message ? cause.message : fallback;
  }

  async function refresh() {
    const current = ++generation.current;
    setLoadError("");
    try {
      const next = await loadLibraryAgents(callbacks.current.api);
      if (current === generation.current) setAgents(next);
    } catch (cause) {
      if (current === generation.current) setLoadError(failed(cause, "Connected agents could not be loaded."));
    }
  }

  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, []);

  async function change(agent: LibraryAgent, blocked: boolean) {
    setBusy(agent.clientId);
    setError("");
    try {
      await setLibraryAgentBlocked(callbacks.current.api, agent.clientId, blocked);
      await refresh();
    } catch (cause) {
      setError(failed(cause, blocked ? "The agent could not be disconnected." : "The agent could not be allowed again."));
    } finally {
      setBusy(null);
    }
  }

  return <section className="rd-private-source rd-private-source-live mcp-panel" aria-label="MCP">
    <div className="rd-section-heading"><h2>MCP</h2>
      <IconAction label="Refresh connected agents" disabled={busy !== null} onClick={() => void refresh()}><RefreshCw /></IconAction>
    </div>

    <div className="mcp-panel-server">
      <h3>My skills</h3>
      <code>{MY_SKILLS_MCP_URL}</code>
      <p className="rd-muted">Your own library for your agents, read only. Add this address as a custom connector or
        MCP server (Grok, Claude, ChatGPT, Cursor, Codex), then sign in to omgskills. Skills that can't sync, or that
        contain a key or password, are never shared.</p>
    </div>

    <div className="mcp-panel-agents">
      <h3>Connected agents</h3>
      {error && <p role="alert">{error}</p>}
      {loadError && <><p role="alert">{loadError}</p><Action onClick={() => void refresh()}>Try again</Action></>}
      {!loadError && agents === null && <p role="status">Loading connected agents...</p>}
      {agents?.length === 0 && <p className="rd-muted">No agents yet. They show up here after they sign in.</p>}
      {agents?.map(agent => <div className="rd-source-release" key={agent.clientId} data-blocked={agent.blocked || undefined}>
        <div className="rd-grow"><strong>{agent.name}</strong>
          <p className="rd-muted">{agent.blocked ? "Disconnected" : `Last used ${date(agent.lastUsedAt)}`}
            {` · connected ${date(agent.firstUsedAt)}`}</p>
        </div>
        {agent.blocked
          ? <Action variant="outline" disabled={busy !== null} onClick={() => void change(agent, false)}>Allow again</Action>
          : <Action variant="outline" disabled={busy !== null} onClick={() => void change(agent, true)}>Disconnect</Action>}
      </div>)}
      {agents && agents.length > 0 && <p className="rd-muted">Disconnecting cuts the agent off right away. To use it
        again, choose Allow again.</p>}
    </div>

    <div className="mcp-panel-server">
      <h3>Public library</h3>
      <code>{PUBLIC_MCP_URL}</code>
      <p className="rd-muted">Search and read the public skills library from any agent. No sign-in.</p>
      <a className="ua-link" href="https://omgskills.com/developers/" target="_blank" rel="noreferrer">
        Connection instructions <ArrowUpRight />
      </a>
    </div>
  </section>;
}
