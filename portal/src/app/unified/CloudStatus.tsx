import { useState } from "react";
import { Cloud, CloudOff, TriangleAlert } from "lucide-react";
import { needsAttention, statusHelp, statusText, labelText, type CloudSaveState, type CloudSkillRow } from "../../cloud-save/cloud-save";

/** The account's cloud save state, and confirming a skill flagged for a key is safe to save. */
export type CloudInfo = { state: CloudSaveState; confirm: (key: string) => Promise<void> };

/** A skill's cloud save status as one short label beside its actions; the detail shows on hover. */
export function CloudStatusBadge({ row: shown, notInstalled = false }: { row: CloudSkillRow | null; notInstalled?: boolean }) {
  if (!shown) return null;
  // A skill already marked Not installed just reads Saved.
  const row = notInstalled && shown.status === "deleted" ? { ...shown, status: "saved" as const } : shown;
  const attention = needsAttention(row.status);
  const Icon = row.status === "review" ? TriangleAlert : attention ? CloudOff : Cloud;
  const saved = ["saved", "deleted", "library", "set"].includes(row.status);
  const history = [
    saved && row.versionCount > 0 ? `${row.versionCount} ${row.versionCount === 1 ? "version" : "versions"}` : "",
    saved && row.savedAt ? `last saved ${new Date(row.savedAt).toLocaleDateString()}` : "",
  ].filter(Boolean).join(", ");
  const detail = attention ? undefined : [history && `${history[0].toUpperCase()}${history.slice(1)}.`, statusHelp[row.status]].filter(Boolean).join(" ");
  return <span className="ua-cloud-badge" data-status={row.status} data-attention={attention || undefined} title={detail || undefined}
    aria-label={`Sync: ${statusText[row.status]}${detail ? `. ${detail}` : ""}`}>
    <Icon aria-hidden="true" /><span aria-hidden="true">{statusText[row.status]}</span>
  </span>;
}

/** What to do about a skill cloud save can't keep, and any labels on its saved copy, below the actions. */
export function CloudStatusSection({ row, confirm }: { row: CloudSkillRow | null; confirm?: (key: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!row) return null;
  const attention = needsAttention(row.status);
  if (!attention && !row.labels.length) return null;
  return <section className="ua-cloud-status" aria-label="Sync" data-status={row.status}>
    {attention && statusHelp[row.status] && <p className="ua-muted">{row.status === "review" && row.origin
      ? `A file in this skill from ${row.origin === "library" ? "the library" : "a Set"} looks like it contains a key or password, so it wasn't saved. If it's only an example, confirm it's safe.`
      : statusHelp[row.status]}</p>}
    {row.findings.map(file => <p className="ua-muted ua-cloud-finding" key={file.path}>
      {file.path}: {file.findings.map(finding => `${finding.kind} on line ${finding.line}`).join(", ")}
    </p>)}
    {row.labels.length > 0 && <p className="ua-cloud-labels">{row.labels.map(label => <span key={label}>{labelText[label]}</span>)}</p>}
    {row.status === "review" && confirm && <button type="button" className="ua-pill" disabled={busy} onClick={() => {
      setBusy(true);
      setError("");
      void confirm(row.key).catch(() => setError("It couldn't be confirmed. Try again.")).finally(() => setBusy(false));
    }}>{busy ? "Confirming..." : "It's safe, save it"}</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
