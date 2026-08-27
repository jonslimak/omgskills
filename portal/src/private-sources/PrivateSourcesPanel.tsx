import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { loadPrivateSources, registerPrivateSource } from "@/private-sources/api";
import type { PrivateSourceView } from "@/private-sources/types";
import { usePortalApi } from "@/portal-api";

const emptyView: PrivateSourceView = { installations: [], sources: [] };

export function PrivateSourcesPanel() {
  const api = usePortalApi();
  const [view, setView] = useState<PrivateSourceView>(emptyView);
  const [installationId, setInstallationId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [root, setRoot] = useState(".");
  const [status, setStatus] = useState("Loading...");
  const [saving, setSaving] = useState(false);

  const installation = useMemo(
    () => view.installations.find((candidate) => candidate.installationId === installationId)
      ?? view.installations[0],
    [installationId, view.installations]
  );
  const repositories = installation?.repositories ?? [];
  const selectedRepositoryId = repositories.some((repository) => repository.id === repositoryId)
    ? repositoryId
    : repositories[0]?.id ?? "";

  async function refresh() {
    setStatus("Loading...");
    try {
      const nextView = await loadPrivateSources(api);
      setView(nextView);
      setInstallationId((current) => (
        nextView.installations.some((candidate) => candidate.installationId === current)
          ? current
          : nextView.installations[0]?.installationId ?? ""
      ));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load private sources");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function register() {
    if (!installation?.installationId || !selectedRepositoryId || !root.trim()) return;
    setSaving(true);
    setStatus("Registering source...");
    try {
      await registerPrivateSource(api, {
        installationId: installation.installationId,
        repositoryId: selectedRepositoryId,
        root
      });
      await refresh();
      setStatus("Source registered.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to register private source");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="panel private-sources-panel">
      <div className="panel-header">
        <div>
          <h2>PRIVATE SOURCES</h2>
          {installation ? <p>{installation.accountLogin}</p> : null}
        </div>
        {status ? <p className="inline-status">{status}</p> : null}
      </div>

      {view.installations.length === 0 ? (
        <p className="muted">No Broker installation is connected.</p>
      ) : (
        <div className="private-source-form">
          {view.installations.length > 1 ? (
            <select
              aria-label="GitHub account"
              onChange={(event) => {
                setInstallationId(event.target.value);
                setRepositoryId("");
              }}
              value={installation?.installationId ?? ""}
            >
              {view.installations.map((candidate) => (
                <option key={candidate.installationId} value={candidate.installationId}>
                  {candidate.accountLogin}
                </option>
              ))}
            </select>
          ) : null}
          <select
            aria-label="Private repository"
            disabled={repositories.length === 0}
            onChange={(event) => setRepositoryId(event.target.value)}
            value={selectedRepositoryId}
          >
            {repositories.length === 0 ? <option value="">No granted private repositories</option> : null}
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>{repository.fullName}</option>
            ))}
          </select>
          <Input
            aria-label="Skill root"
            onChange={(event) => setRoot(event.target.value)}
            placeholder="skills/example"
            value={root}
          />
          <Button
            disabled={saving || !selectedRepositoryId || !root.trim()}
            onClick={() => void register()}
          >
            Register
          </Button>
        </div>
      )}

      {view.sources.length > 0 ? (
        <div className="private-source-list">
          {view.sources.map((source) => (
            <div className="private-source-row" key={source.id}>
              <strong>{source.repositorySlug}</strong>
              <span>{source.normalizedRoot}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
