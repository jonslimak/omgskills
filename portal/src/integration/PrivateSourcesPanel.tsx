import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { PortalApi } from "../portal-api";
import { Action, EmptyState, IconAction, TextInput } from "../app/ui";
import { createPrivateSourceSession, emptyPrivateSourceSnapshot, validSkillRoot } from "./private-source-session";

export function PrivateSourcesPanel({ api, denied }: { api: PortalApi; denied: () => void }) {
  const callbacks = useRef({ api, denied });
  callbacks.current = { api, denied };
  const session = useRef<ReturnType<typeof createPrivateSourceSession> | null>(null);
  const [state, setState] = useState(emptyPrivateSourceSnapshot);
  const [installationId, setInstallationId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [root, setRoot] = useState(".");
  useEffect(() => {
    const current = createPrivateSourceSession((path, init) => callbacks.current.api(path, init), setState, () => callbacks.current.denied());
    session.current = current;
    void current.refresh();
    return () => { current.dispose(); session.current = null; };
  }, []);
  useEffect(() => {
    if (!state.view) return;
    if (!state.view.installations.some((item) => item.installationId === installationId)) {
      setInstallationId(state.view.installations[0]?.installationId ?? "");
      setRepositoryId("");
    } else if (!state.view.installations.find((item) => item.installationId === installationId)?.repositories.some((repo) => repo.id === repositoryId)) {
      setRepositoryId("");
    }
  }, [state.view, installationId, repositoryId]);
  const installation = state.view?.installations.find((item) => item.installationId === installationId);
  const busy = state.loading || Boolean(state.saving);
  const blocked = busy || Boolean(state.error);
  return <section className="rd-private-source rd-private-source-live" aria-label="Private sources">
    <div className="rd-section-heading"><h2>Private sources</h2>
      <IconAction label="Refresh private sources" disabled={busy} onClick={() => void session.current?.refresh()}><RefreshCw /></IconAction>
    </div>
    <p className="rd-muted">Local GitHub simulation. No real repository is connected.</p>
    {state.error && <p role="alert">{state.error}</p>}
    {state.notice && <p role="status">{state.notice}</p>}
    {state.loading && !state.view && <p role="status">Loading private sources...</p>}
    {state.view && !state.error && state.view.installations.length === 0 && <EmptyState title="No installation connected" description="Self-service GitHub setup is not available yet." />}
    {Boolean(state.view?.installations.length) && <form className="rd-connected-source" onSubmit={(event) => {
      event.preventDefault();
      void session.current?.register({ installationId, repositoryId, root }).catch(() => {});
    }}>
      <label>GitHub account<select aria-label="GitHub account" value={installationId} disabled={blocked} onChange={(event) => {
        setInstallationId(event.target.value); setRepositoryId("");
      }}>{state.view!.installations.map((item) => <option key={item.installationId} value={item.installationId}>{item.accountLogin}</option>)}</select></label>
      <label>Repository<select aria-label="Private repository" value={repositoryId} disabled={blocked || !installation?.repositories.length} onChange={(event) => setRepositoryId(event.target.value)}>
        <option value="">Select repository</option>
        {installation?.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.fullName}</option>)}
      </select></label>
      {installation?.repositories.length === 0 && <p>No permitted private repositories.</p>}
      <label>Skill root<TextInput aria-label="Skill root" value={root} maxLength={1000} disabled={busy} onChange={(event) => setRoot(event.target.value)} /></label>
      <Action type="submit" disabled={blocked || !repositoryId || !validSkillRoot(root)}>{state.saving === "register" ? "Registering..." : "Register source"}</Action>
    </form>}
    {state.view?.sources.length === 0 && !state.loading && !state.error && <p className="rd-muted">No registered sources.</p>}
    {state.view?.sources.map((source) => <div className="rd-source-release" key={source.id}>
      <div className="rd-grow"><strong>{source.repositorySlug}</strong><p className="rd-muted">{source.normalizedRoot}</p>
        {state.releases[source.id] && <p role="status">Snapshot {state.releases[source.id].commitSha.slice(0, 7)}</p>}
      </div>
      <Action disabled={blocked} aria-label={`Create release for ${source.repositorySlug} ${source.normalizedRoot}`} onClick={() => void session.current?.release(source.id).catch(() => {})}>
        {state.saving === source.id ? "Creating..." : "Create release"}
      </Action>
    </div>)}
  </section>;
}
