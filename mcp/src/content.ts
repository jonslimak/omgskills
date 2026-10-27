import type { SkillResult } from "./library.js";
import { githubRepo, gitBlobSha, pinnedInstallFor, skillMdParts } from "./install.js";

const maxSkillMdBytes = 256 * 1024;

export type SkillContent = {
  id: string;
  path: string;
  /** The commit the text was read at, or HEAD for skills without a pinned commit. */
  ref: string;
  pinned: boolean;
  /** True when the text matches the catalog's skill_md_sha. */
  verified: boolean;
  truncated: boolean;
  content: string;
};

export class SkillContentError extends Error {}

/** Reads SKILL.md from GitHub at the pinned commit (or HEAD) and checks it against the catalog hash. */
export async function readSkillContent(skill: SkillResult, maxChars: number, fetcher: typeof fetch = fetch): Promise<SkillContent> {
  const pin = pinnedInstallFor(skill);
  const repo = pin?.repo ?? githubRepo(skill.github_url);
  const parts = skillMdParts(skill.skill_md_path);
  if (!repo || !parts) throw new SkillContentError("This skill has no recorded SKILL.md location, so its text can't be read.");
  const ref = pin?.commit_sha ?? "HEAD";
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${parts.map(encodeURIComponent).join("/")}`;
  let response: Response;
  try {
    response = await fetcher(url, { redirect: "follow", credentials: "omit", signal: AbortSignal.timeout(8_000),
      headers: { Accept: "text/plain", "User-Agent": "omgskills-mcp" } });
  } catch {
    throw new SkillContentError("GitHub could not be reached. Try again shortly.");
  }
  if (response.url && new URL(response.url).hostname !== "raw.githubusercontent.com") {
    await response.body?.cancel();
    throw new SkillContentError("GitHub redirected somewhere unexpected; not reading it.");
  }
  if (response.status === 404) throw new SkillContentError(pin ? "SKILL.md is missing at the pinned commit." : "SKILL.md is no longer at its recorded path on the default branch.");
  if (!response.ok) throw new SkillContentError(`GitHub returned ${response.status}. Try again shortly.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxSkillMdBytes) throw new SkillContentError("SKILL.md is unusually large; not returning it.");
  const text = new TextDecoder().decode(bytes);
  return {
    id: skill.id,
    path: parts.join("/"),
    ref,
    pinned: !!pin,
    verified: !!skill.skill_md_sha && gitBlobSha(bytes) === skill.skill_md_sha.toLowerCase(),
    truncated: text.length > maxChars,
    content: text.slice(0, maxChars)
  };
}
