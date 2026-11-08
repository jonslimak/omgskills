import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { PortalApiError } from "../../api-error";
import type { GithubLinkSkills, MySkillAdditions } from "../my-skills-additions";
import { Avatar } from "./Avatar";

type Found = { link: string } & ({ state: "loading" } | { state: "error"; message: string } | ({ state: "ready" } & GithubLinkSkills));

/**
 * "Add skill": paste a GitHub link (repo, folder or SKILL.md) and add the library skills it points at to My skills.
 * Skills not in the library can't be added yet.
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
    additions.findByGithubLink(value, controller.signal).then(
      result => { if (!controller.signal.aborted) setFound({ link: value, state: "ready", ...result }); },
      error => {
        if (controller.signal.aborted) return;
        setFound({ link: value, state: "error", message: error instanceof PortalApiError && error.status === 400
          ? error.message : "The library couldn't be checked. Try again." });
      });
  };
  // A link pasted in search arrives already filled in.
  useEffect(() => { if (initialLink) find(initialLink); return () => request.current?.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const added = (id: string) => additions.skills.some(skill => skill.catalogId === id);
  return <div className="ua-add-skill">
    <form onSubmit={event => { event.preventDefault(); find(link); }}>
      <label>
        GitHub link
        <input autoFocus type="url" inputMode="url" value={link} maxLength={500} required
          placeholder="https://github.com/owner/repo" onChange={event => setLink(event.target.value)} />
      </label>
      <p className="ua-muted">A repo, a folder or a SKILL.md.</p>
      <button type="submit" className="ua-pill ua-primary" disabled={!link.trim() || found?.state === "loading"}>
        {found?.state === "loading" ? "Finding…" : "Find skills"}
      </button>
    </form>
    {found && found.state !== "loading" && <div role="status" aria-live="polite">
      {found.state === "error" ? <p className="ua-add-skill-note">{found.message}</p>
        : !found.skills.length ? <p className="ua-add-skill-note">No library skills at that link yet. Adding other GitHub skills is coming soon.</p>
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
