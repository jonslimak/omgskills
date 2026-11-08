import assert from "node:assert/strict";
import test from "node:test";
import { GithubImportError, parseGithubImportLink, readGithubSkill } from "./github-skill-import.js";
import { githubSkillKey } from "./github-skill-save.js";
import { gitObjectSha } from "./skill-package.js";

const COMMIT = "c".repeat(40);
const ROOT = "a".repeat(40);

type RepoFile = { text: string; mode?: string; type?: string };

/** A pretend public repo on GitHub: refs, one recursive tree, and raw files. */
function github(files: Record<string, RepoFile>, options: { refs?: string[]; private?: boolean; limited?: boolean; tamper?: string } = {}) {
  const calls: string[] = [];
  const blob = (file: RepoFile) => gitObjectSha("blob", Buffer.from(file.text));
  const fetcher = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (options.limited) return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.now() / 1000 + 600) } });
    const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/o\/r\/([0-9a-f]{40})\/(.+)$/);
    if (raw) {
      const path = raw[2].split("/").map(decodeURIComponent).join("/");
      const file = files[path];
      if (!file) return new Response("", { status: 404 });
      return new Response(path === options.tamper ? `${file.text}!` : file.text);
    }
    const path = url.replace("https://api.github.com", "");
    if (path === "/repos/o/r") return json({ private: options.private ?? false });
    const ref = path.match(/^\/repos\/o\/r\/commits\/(.+)$/)?.[1];
    if (ref) {
      const name = ref.split("/").map(decodeURIComponent).join("/");
      return (options.refs ?? ["main", "HEAD"]).includes(name) ? json({ sha: COMMIT, commit: { tree: { sha: ROOT } } }) : json({}, 422);
    }
    if (path === `/repos/o/r/git/commits/${COMMIT}`) return json({ tree: { sha: ROOT } });
    if (path === `/repos/o/r/git/trees/${ROOT}?recursive=1`) {
      const folders = new Set<string>();
      for (const name of Object.keys(files)) name.split("/").slice(0, -1).forEach((_, index, parts) => folders.add(parts.slice(0, index + 1).join("/")));
      return json({ truncated: false, tree: [
        ...[...folders].map(folder => ({ path: folder, mode: "040000", type: "tree", sha: "b".repeat(40) })),
        ...Object.entries(files).map(([name, file]) => ({ path: name, mode: file.mode ?? "100644", type: file.type ?? "blob",
          sha: blob(file), size: Buffer.byteLength(file.text) })),
      ] });
    }
    return json({}, 404);
  }) as typeof fetch;
  return { fetcher, calls };
}

const skillMd = (name: string) => `---\nname: ${name}\ndescription: "Does ${name} things."\n---\n# ${name}\n`;
const read = (url: string, repo: ReturnType<typeof github>) => readGithubSkill(parseGithubImportLink(url)!, { fetcher: repo.fetcher, token: "" });
const fails = (promise: Promise<unknown>, code: string, message?: RegExp) =>
  assert.rejects(promise, (error) => error instanceof GithubImportError && error.code === code && (!message || message.test(error.message)));

test("a link reads as owner/repo and the path after tree or blob", () => {
  assert.deepEqual(parseGithubImportLink("github.com/o/r"), { owner: "o", repo: "r", kind: "repo", rest: [] });
  assert.deepEqual(parseGithubImportLink("https://github.com/o/r/tree/release/v2/skills/pdf"),
    { owner: "o", repo: "r", kind: "tree", rest: ["release", "v2", "skills", "pdf"] });
  assert.deepEqual(parseGithubImportLink("https://github.com/o/r/blob/main/pdf/SKILL.md"), { owner: "o", repo: "r", kind: "blob", rest: ["main", "pdf"] });
  for (const bad of ["https://github.com/o/r/blob/main/README.md", "https://github.com/o/r/tree/main/a%5Cb", "https://gitlab.com/o/r",
    "https://github.com/o/r/issues/1", "https://u:p@github.com/o/r"]) {
    assert.equal(parseGithubImportLink(bad), null, bad);
  }
});

test("a folder link reads that skill, pinned to the commit, with its labels", async () => {
  const repo = github({
    "skills/pdf/SKILL.md": { text: skillMd("pdf") },
    "skills/pdf/scripts/run.sh": { text: "echo hi\n", mode: "100755" },
    "skills/docx/SKILL.md": { text: skillMd("docx") },
  });
  const skill = await read("https://github.com/o/r/tree/main/skills/pdf", repo);
  assert.equal(skill.name, "pdf");
  assert.equal(skill.description, "Does pdf things.");
  assert.equal(skill.commitSha, COMMIT);
  assert.equal(skill.folder, "skills/pdf");
  assert.deepEqual(skill.files.map(file => file.path).sort(), ["SKILL.md", "scripts/run.sh"]);
  assert.deepEqual(skill.labels, ["scripts"]);
  // Files come from raw at the pinned commit, not the branch.
  assert.ok(repo.calls.some(url => url === `https://raw.githubusercontent.com/o/r/${COMMIT}/skills/pdf/SKILL.md`));
});

test("a branch name with slashes is found", async () => {
  const repo = github({ "skills/pdf/SKILL.md": { text: skillMd("pdf") } }, { refs: ["release/v2"] });
  assert.equal((await read("https://github.com/o/r/tree/release/v2/skills/pdf", repo)).folder, "skills/pdf");
  await fails(read("https://github.com/o/r/tree/nope/skills/pdf", repo), "branch_not_found");
});

test("each refusal says why", async () => {
  const many = github({ "a/SKILL.md": { text: skillMd("a") }, "b/SKILL.md": { text: skillMd("b") } });
  await fails(read("https://github.com/o/r", many), "several_skills", /has 2 skills/);
  await fails(read("https://github.com/o/r", github({ "README.md": { text: "hi" } })), "no_skill", /No SKILL.md/);
  await fails(read("https://github.com/o/r", github({ "SKILL.md": { text: "# no frontmatter" } })), "no_name");
  await fails(read("https://github.com/o/r/tree/main/missing", many), "folder_not_found");
  await fails(read("https://github.com/o/r", github({ "SKILL.md": { text: skillMd("x") }, "link": { text: "SKILL.md", mode: "120000" } })),
    "unsupported_file", /symbolic link/);
  await fails(read("https://github.com/o/r", github({ "SKILL.md": { text: skillMd("x") },
    "config.env": { text: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLEKEY9\naws_access_key_id = AKIAZ3MJW5RLT7Q4NBVX\n" } })),
  "secret", /config.env" line \d+ looks like a password or key/);
  await fails(read("https://github.com/o/r", github({ "SKILL.md": { text: skillMd("x") } }, { private: true })), "not_found", /public/);
  await fails(read("https://github.com/o/r", github({ "SKILL.md": { text: skillMd("x") } }, { limited: true })), "rate_limited", /Try again in \d+ minutes/);
  await fails(read("https://github.com/o/r", github({ "SKILL.md": { text: skillMd("x") } }, { tamper: "SKILL.md" })), "unavailable");
});

test("a pinned read uses the commit it was shown, not the branch", async () => {
  const repo = github({ "pdf/SKILL.md": { text: skillMd("pdf") } }, { refs: [] });
  const skill = await readGithubSkill(parseGithubImportLink("https://github.com/o/r/tree/main/pdf")!,
    { fetcher: repo.fetcher, token: "", pinned: { commitSha: COMMIT, folder: "pdf" } });
  assert.equal(skill.name, "pdf");
  assert.ok(!repo.calls.some(url => url.includes("/commits/main")));
});

test("the saved key is the folder name, then folder@agents", () => {
  const skill = { folder: "skills/PDF", repo: "o/r", name: "pdf" };
  assert.equal(githubSkillKey(skill, new Set()), "pdf");
  assert.equal(githubSkillKey(skill, new Set(["pdf"])), "pdf@agents");
  assert.equal(githubSkillKey(skill, new Set(["pdf", "pdf@agents"])), "pdf@agents-2");
  assert.equal(githubSkillKey({ folder: "", repo: "o/My-Skill", name: "x" }, new Set()), "my-skill");
});
