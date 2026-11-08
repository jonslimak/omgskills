import assert from "node:assert/strict";
import test from "node:test";
import { GithubImportError, parseGithubImportLink, readGithubSkill, skillMdHeader } from "./github-skill-import.js";
import { githubSkillKey } from "./github-skill-save.js";
import { gitObjectSha } from "./skill-package.js";

const COMMIT = "c".repeat(40);
const ROOT = "a".repeat(40);

type RepoFile = { text: string; mode?: string; type?: string };

/** A pretend public repo on GitHub: refs, one recursive tree, and raw files. */
function github(files: Record<string, RepoFile>, options: { refs?: string[]; private?: boolean; limited?: boolean; secondary?: boolean; tamper?: string; truncated?: boolean; flaky?: string } = {}) {
  const calls: string[] = [];
  const dropped = new Set<string>();
  const blob = (file: RepoFile) => gitObjectSha("blob", Buffer.from(file.text));
  const fetcher = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (options.limited) return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.now() / 1000 + 600) } });
    if (options.secondary) return new Response('{"message":"You have exceeded a secondary rate limit."}', { status: 403, headers: { "x-ratelimit-remaining": "4000" } });
    const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/o\/r\/([0-9a-f]{40})\/(.+)$/);
    if (raw) {
      const path = raw[2].split("/").map(decodeURIComponent).join("/");
      const file = files[path];
      if (!file) return new Response("", { status: 404 });
      // A flaky file fails its first request, the way the raw CDN now and then does.
      if (path === options.flaky && !dropped.has(path)) { dropped.add(path); throw new TypeError("fetch failed"); }
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
      return json({ truncated: options.truncated ?? false, tree: [
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
  assert.equal(githubSkillKey({ folder: "x".repeat(250), repo: "o/r", name: "y".repeat(250) }, new Set()), null);
});

test("SKILL.md is read the way the Mac reads it, or refused with the reason", () => {
  assert.deepEqual(skillMdHeader("---\nname:  My   Skill \ndescription: 'It''s  good' # note\n---\n"), { name: "My Skill", description: "It's good" });
  assert.deepEqual(skillMdHeader('---\nname: "pdf"\ndescription: Read # and write\n---'), { name: "pdf", description: "Read" });
  // Multi-line descriptions, as many real skills write them.
  assert.deepEqual(skillMdHeader("---\nname: x\ndescription: >-\n  Turn an idea\n  into a plan.\n---"), { name: "x", description: "Turn an idea into a plan." });
  assert.deepEqual(skillMdHeader("---\nname: x\ndescription: |\n  Line one\n  line two\n---"), { name: "x", description: "Line one line two" });
  assert.deepEqual(skillMdHeader("---\nname: x\ndescription: Starts here\n  and carries on\nlicense: MIT\n---"), { name: "x", description: "Starts here and carries on" });
  assert.deepEqual(skillMdHeader('---\nname: x\ndescription: "a \\" b"\n---'), { name: "x", description: 'a " b' });
  // Quoted 0o17 is text; U+FEFF inside a name is kept, as the Mac keeps it.
  assert.deepEqual(skillMdHeader('---\nname: "0o17"\ndescription: y\n---'), { name: "0o17", description: "y" });
  assert.deepEqual(skillMdHeader("---\nname: a\uFEFFb\ndescription: y\n---"), { name: "a\uFEFFb", description: "y" });
  // Text to Yams though YAML 1.1 would type them.
  for (const plain of ["y", "N", "-.5", "0:30", "2024-1-1"]) {
    assert.deepEqual(skillMdHeader(`---\nname: x\ndescription: ${plain}\n---`), { name: "x", description: plain }, plain);
  }
  for (const [text, why] of [
    ["\uFEFF---\nname: x\ndescription: y\n---", /doesn't start with a --- header/],
    ["---\nname: x\ndescription: y", /isn't closed/],
    ["---\nname: x\n---", /has no description/],
    ["---\nname: 123\ndescription: y\n---", /name isn't text/],
    ["---\nname: yes\ndescription: y\n---", /name isn't text/],
    ["---\nname: x\ndescription: [a, b]\n---", /description isn't text/],
    ["---\nname: x\ndescription: For example: this\n---", /isn't valid YAML at line 3 \(text with ": " in it needs quotes\)/],
    ["---\nname: x\nname: y\ndescription: y\n---", /same field twice/],
    ["---\n- a\n---", /no name or description/],
    ["---\nname: x\ndescription: a\u2028b\n---", /hidden control character/],
    ["---\nname: x\ndescription: a\u0007b\n---", /hidden control character/],
    ["---\n<<: {name: a}\n<<: {description: b}\n---", /same field twice/],
    ["---\nname: 0o17\ndescription: y\n---", /name isn't text/],
  ] as const) {
    assert.throws(() => skillMdHeader(text), (error) => error instanceof GithubImportError && why.test(error.message), text);
  }
});

test("GitHub's secondary limits and slow reads say so", async () => {
  await fails(read("https://github.com/o/r", github({ "SKILL.md": { text: skillMd("x") } }, { secondary: true })), "rate_limited");
  const repo = github({ "SKILL.md": { text: skillMd("x") } });
  await fails(readGithubSkill(parseGithubImportLink("github.com/o/r")!, { fetcher: repo.fetcher, token: "", deadline: Date.now() - 1 }),
    "too_slow", /took too long/);
  await fails(read("https://github.com/o/r", github({ "a/SKILL.md": { text: skillMd("a") } }, { truncated: true })), "several_skills", /too big to read whole/);
});

test("a pinned read checks the repo is still public", async () => {
  const repo = github({ "pdf/SKILL.md": { text: skillMd("pdf") } }, { private: true });
  await fails(readGithubSkill(parseGithubImportLink("https://github.com/o/r/tree/main/pdf")!,
    { fetcher: repo.fetcher, token: "", pinned: { commitSha: COMMIT, folder: "pdf" } }), "not_found");
});

test("a repo or folder whose only skill is in a folder below reads that skill", async () => {
  const repo = github({
    "README.md": { text: "# repo\n" },
    "skills/prompt/SKILL.md": { text: skillMd("prompt") },
    "skills/prompt/references/guide.md": { text: "guide\n" },
    "docs/notes.md": { text: "notes\n" },
  });
  for (const url of ["https://github.com/o/r", "https://github.com/o/r/tree/main/skills"]) {
    const skill = await read(url, repo);
    assert.equal(skill.folder, "skills/prompt", url);
    assert.equal(skill.name, "prompt");
    // Only the skill's own files, relative to its folder.
    assert.deepEqual(skill.files.map(file => file.path).sort(), ["SKILL.md", "references/guide.md"], url);
  }
  // The add re-reads exactly the folder the preview showed.
  const pinned = await readGithubSkill(parseGithubImportLink("https://github.com/o/r")!,
    { fetcher: repo.fetcher, token: "", pinned: { commitSha: COMMIT, folder: "skills/prompt" } });
  assert.equal(pinned.folder, "skills/prompt");
  // A deeper single skill is found too.
  const deep = await read("https://github.com/o/r", github({ "a/b/c/SKILL.md": { text: skillMd("c") } }));
  assert.equal(deep.folder, "a/b/c");
});

test("a SKILL.md at the top wins over skills inside it; two below still asks for one", async () => {
  const top = await read("https://github.com/o/r", github({
    "SKILL.md": { text: skillMd("top") }, "examples/demo/SKILL.md": { text: skillMd("demo") } }));
  assert.equal(top.name, "top");
  assert.equal(top.folder, "");
  assert.equal(top.files.length, 2);
  await fails(read("https://github.com/o/r/tree/main/skills", github({
    "skills/a/SKILL.md": { text: skillMd("a") }, "skills/b/SKILL.md": { text: skillMd("b") } })), "several_skills", /folder has 2 skills/);
  await fails(read("https://github.com/o/r/tree/main/skills", github({ "skills/README.md": { text: "x" }, "SKILL.md": { text: skillMd("x") } })),
    "no_skill", /No SKILL.md in this folder/);
});

test("a dropped file request is tried once more; a stale copy too", async () => {
  const skill = await read("https://github.com/o/r", github({ "SKILL.md": { text: skillMd("x") }, "a.md": { text: "a" } }, { flaky: "a.md" }));
  assert.equal(skill.files.length, 2);
  // A file that never matches its hash is still refused.
  await fails(read("https://github.com/o/r", github({ "SKILL.md": { text: skillMd("x") } }, { tamper: "SKILL.md" })), "unavailable");
});
