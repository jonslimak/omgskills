import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { PortalApiError } from "../../api-error";
import { formatBytes, labelText, type CloudLabel } from "../../cloud-save/cloud-save";
import type { GithubLinkSkills, GithubSkillPreview, MySkillAdditions } from "../my-skills-additions";
import { Avatar } from "./Avatar";

/** A skill that isn't in the library: read from GitHub, or why it can't be added. */
type GithubResult = { state: "preview"; preview: GithubSkillPreview; adding?: boolean; error?: string } | { state: "error"; message: string }
  | { state: "added"; name: string };
type Found = { link: string } & ({ state: "loading" } | { state: "error"; message: string }
  | ({ state: "ready"; github?: GithubResult } & GithubLinkSkills));

/** The server's GitHub skill messages are written to be shown; a failed request without one gets a plain retry line. */
const reason = (error: unknown, fallback: string) =>
  error instanceof PortalApiError && !error.message.startsWith("Request failed") ? error.message : fallback;

/**
 * "Add skill": paste a GitHub link (repo, folder or SKILL.md) and add the skills it points at to My skills.
 * Library skills are added as library skills. Any other GitHub skill is shown first (files, warnings, SKILL.md),
 * then saved as it is now, like a skill synced from a Mac; when it can't be, the reason is shown.
 */
export function AddSkillForm({ additions, initialLink = "", notify }: {
  additions: MySkillAdditions & Required<Pick<MySkillAdditions, "findByGithubLink">>;
  initialLink?: string;
  notify: (message: string) => void;
}) {
  const [link, setLink] = useState(initialLink);
  const [found, setFound] = useState<Found | null>(null);
  const request = useRef<AbortController | null>(null);
  const find = (value: string) => {
    request.current?.abort();
    if (!value.trim()) { setFound(null); return; }
    const controller = new AbortController();
    request.current = controller;
    setFound({ link: value, state: "loading" });
    void (async () => {
      let result: GithubLinkSkills;
      try {
        result = await additions.findByGithubLink(value, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) setFound({ link: value, state: "error", message: error instanceof PortalApiError && error.status === 400
          ? error.message : "The library couldn't be checked. Try again." });
        return;
      }
      let github: GithubResult | undefined;
      if (!result.skills.length && additions.previewGithubSkill) {
        try {
          github = { state: "preview", preview: await additions.previewGithubSkill(value, controller.signal) };
        } catch (error) {
          github = { state: "error", message: reason(error, "GitHub couldn't be checked. Try again.") };
        }
      }
      if (!controller.signal.aborted) setFound({ link: value, state: "ready", ...result, github });
    })();
  };
  // A link pasted in search arrives already filled in.
  useEffect(() => { if (initialLink) find(initialLink); return () => request.current?.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const added = (id: string) => additions.skills.some(skill => skill.catalogId === id);
  // An add's result belongs to the link it was made from; a search for another link meanwhile keeps its own results.
  const setGithub = (forLink: string, github: GithubResult) =>
    setFound(old => old?.state === "ready" && old.link === forLink ? { ...old, github } : old);
  // One add at a time: a double click sends one request.
  const adding = useRef(false);
  const addFromGithub = (preview: GithubSkillPreview) => {
    if (!additions.addGithubSkill || found?.state !== "ready" || adding.current) return;
    adding.current = true;
    const forLink = found.link;
    setGithub(forLink, { state: "preview", preview, adding: true });
    additions.addGithubSkill(preview).then(saved => {
      setGithub(forLink, { state: "added", name: saved.name });
      notify(`Added ${saved.name} to My skills`);
    }, error => setGithub(forLink, { state: "preview", preview, error: reason(error, "The skill couldn't be added. Try again.") }))
      .finally(() => { adding.current = false; });
  };
  return <div className="ua-add-skill">
    <form onSubmit={event => { event.preventDefault(); find(link); }}>
      <label>
        GitHub link
        <input autoFocus type="text" inputMode="url" autoComplete="off" spellCheck={false} value={link} maxLength={500} required
          placeholder="https://github.com/owner/repo" onChange={event => setLink(event.target.value)} />
      </label>
      <p className="ua-muted">A repo, a folder or a SKILL.md.</p>
      <button type="submit" className="ua-pill ua-primary" disabled={!link.trim() || found?.state === "loading"}>
        {found?.state === "loading" ? "Finding…" : "Find skills"}
      </button>
    </form>
    {/* Results belong to the link they were found for; editing the link hides them until Find runs again. */}
    {found && found.state !== "loading" && found.link.trim() === link.trim() && <div role="status" aria-live="polite">
      {found.state === "error" ? <p className="ua-add-skill-note">{found.message}</p>
        : found.github ? <GithubSkill result={found.github} onAdd={addFromGithub} />
        : !found.skills.length ? <p className="ua-add-skill-note">No skills at that link.</p>
        : <ul className="ua-add-skill-list" aria-label="Skills at this link">
          {found.skills.map(skill => {
            const name = skill.name || skill.catalogId.split(":").at(-1) || skill.catalogId;
            const inMySkills = added(skill.catalogId);
            return <li key={skill.catalogId}>
              <Avatar src={skill.author ? `https://github.com/${encodeURIComponent(skill.author)}.png?size=80` : undefined} name={skill.author || name} />
              <span className="ua-add-skill-text">
                <strong>{name}</strong>
                {skill.description && <small>{skill.description}</small>}
              </span>
              {inMySkills ? <span className="ua-pill"><Check aria-hidden="true" />In My skills</span>
                : <button type="button" className="ua-pill" aria-label={`Add ${name} to My skills`}
                  disabled={additions.pending.includes(skill.catalogId)}
                  onClick={() => void additions.add(skill.catalogId, { name: skill.name, description: skill.description,
                    author: skill.author, githubUrl: skill.githubUrl }).then(() => notify(`Added ${name} to My skills`),
                    error => notify(error instanceof PortalApiError && [404, 409].includes(error.status) ? error.message
                      : "Couldn't update My skills. Try again."))}>
                  Add <Plus aria-hidden="true" />
                </button>}
            </li>;
          })}
        </ul>}
      {found.state === "ready" && found.more && <p className="ua-muted">Showing the first {found.skills.length}. Paste a folder link to see the rest.</p>}
    </div>}
  </div>;
}

/** A GitHub skill that isn't in the library, shown before it is added (its files come from someone else). */
function GithubSkill({ result, onAdd }: { result: GithubResult; onAdd: (preview: GithubSkillPreview) => void }) {
  if (result.state === "error") return <p className="ua-add-skill-note"><strong>Can't add this skill.</strong> {result.message}</p>;
  if (result.state === "added") return <p className="ua-add-skill-note"><Check aria-hidden="true" /> Added {result.name} to My skills.
    Open it there to install it on a Mac.</p>;
  const { preview } = result;
  const where = `github.com/${preview.repo}${preview.folder ? `/${preview.folder}` : ""}`;
  return <div className="ua-github-skill">
    <span className="ua-add-skill-text">
      <strong>{preview.name}</strong>
      {preview.description && <small>{preview.description}</small>}
    </span>
    <p className="ua-muted">Not in the library. From {where} · {preview.fileCount} file{preview.fileCount === 1 ? "" : "s"},{" "}
      {formatBytes(preview.totalBytes)}. Added as it is now; it won't update by itself.</p>
    {preview.labels.length > 0 && <ul className="ua-github-skill-labels" aria-label="Check before adding">
      {preview.labels.map(label => <li key={label}>{labelText[label as CloudLabel] ?? label}</li>)}
    </ul>}
    <details>
      <summary>Read SKILL.md</summary>
      <pre>{preview.skillMd}{preview.skillMdTruncated ? "\n…" : ""}</pre>
    </details>
    {preview.fileCount > 1 && <details>
      <summary>Files</summary>
      <ul className="ua-github-skill-files">
        {preview.files.map(file => <li key={file.path}>{file.path} <span className="ua-muted">{formatBytes(file.bytes)}</span></li>)}
        {preview.fileCount > preview.files.length && <li className="ua-muted">and {preview.fileCount - preview.files.length} more</li>}
      </ul>
    </details>}
    {preview.blocker ? <p className="ua-add-skill-note"><strong>Can't add this skill.</strong> {preview.blocker}</p>
      : <>
        {result.error && <p className="ua-add-skill-note"><strong>Not added.</strong> {result.error}</p>}
        <button type="button" className="ua-pill ua-primary" disabled={result.adding} onClick={() => onAdd(preview)}>
          {result.adding ? "Adding…" : "Add to My skills"}
        </button>
      </>}
  </div>;
}
