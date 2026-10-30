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

const largeFileMessage = "SKILL.md is unusually large; not returning it.";
const redirectMessage = "GitHub redirected somewhere unexpected; not reading it.";
const unavailableMessage = "GitHub could not be reached. Try again shortly.";

function allowedUrl(url: URL) {
  return url.origin === "https://raw.githubusercontent.com" && !url.username && !url.password;
}

async function cancel(response: Response) {
  await response.body?.cancel().catch(() => {});
}

async function boundedBytes(response: Response, controller: AbortController) {
  if (Number(response.headers.get("content-length")) > maxSkillMdBytes) {
    await cancel(response);
    controller.abort();
    throw new SkillContentError(largeFileMessage);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSkillMdBytes) throw new SkillContentError(largeFileMessage);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) {
    controller.abort();
    await reader.cancel().catch(() => {});
    throw error instanceof SkillContentError ? error : new SkillContentError(unavailableMessage);
  } finally {
    reader.releaseLock();
  }
}

/** Reads SKILL.md from GitHub at the pinned commit (or HEAD) and checks it against the catalog hash. */
export async function readSkillContent(skill: SkillResult, maxChars: number, fetcher: typeof fetch = fetch, options: { pinnedOnly?: boolean } = {}): Promise<SkillContent> {
  const pin = pinnedInstallFor(skill);
  if (options.pinnedOnly && !pin) throw new SkillContentError("Pinned file inspection cannot read the default branch.");
  const repo = pin?.repo ?? githubRepo(skill.github_url);
  const parts = skillMdParts(skill.skill_md_path);
  if (!repo || !parts) throw new SkillContentError("This skill has no recorded SKILL.md location, so its text can't be read.");
  const ref = pin?.commit_sha ?? "HEAD";
  let url = new URL(`https://raw.githubusercontent.com/${repo}/${ref}/${parts.map(encodeURIComponent).join("/")}`);
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]);
  let response: Response;
  try {
    for (let redirects = 0; ; redirects++) {
      response = await fetcher(url.toString(), { redirect: "manual", credentials: "omit", signal,
        headers: { Accept: "text/plain", "User-Agent": "omgskills-mcp" } });
      if (response.url && (!allowedUrl(new URL(response.url)) || (options.pinnedOnly && response.url !== url.toString()))) {
        await cancel(response);
        throw new SkillContentError(redirectMessage);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await cancel(response);
      if (options.pinnedOnly) throw new SkillContentError("Pinned file inspection does not follow redirects.");
      if (!location || redirects >= 3) throw new SkillContentError(redirectMessage);
      const next = new URL(location, url);
      if (!allowedUrl(next)) throw new SkillContentError(redirectMessage);
      url = next;
    }
  } catch (error) {
    controller.abort();
    throw error instanceof SkillContentError ? error : new SkillContentError(unavailableMessage);
  }
  if (!response.ok) {
    await cancel(response);
    controller.abort();
    if (response.status === 404) throw new SkillContentError(pin ? "SKILL.md is missing at the pinned commit." : "SKILL.md is no longer at its recorded path on the default branch.");
    throw new SkillContentError(`GitHub returned ${response.status}. Try again shortly.`);
  }
  const bytes = await boundedBytes(response, controller);
  const verified = !!skill.skill_md_sha && gitBlobSha(bytes) === skill.skill_md_sha.toLowerCase();
  if (options.pinnedOnly && !verified) throw new SkillContentError("SKILL.md does not match the pinned catalog hash; not returning unverified text.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: !!options.pinnedOnly }).decode(bytes); }
  catch { throw new SkillContentError("SKILL.md is not plain UTF-8 text."); }
  if (options.pinnedOnly && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
    throw new SkillContentError("SKILL.md is not plain UTF-8 text.");
  return {
    id: skill.id,
    path: parts.join("/"),
    ref,
    pinned: !!pin,
    verified,
    truncated: text.length > maxChars,
    content: text.slice(0, maxChars)
  };
}
