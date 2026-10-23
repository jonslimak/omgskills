import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PublicReadmeClient, parseDocuments, parseReadme, publicReadmeId, readmeBrowseUrl, readmeTitle } from "../src/app/unified/public-readme";
import type { SkillDisplay } from "../src/app/unified/model";

const id = "owner/repo:skills/design";
const skill: SkillDisplay = { key: `catalog:${id}`, catalogId: id, name: "Design", description: "", author: "owner", githubUrl: "https://github.com/owner/repo", tags: [] };
const readme = { markdown: "# Repo\n\nDocumentation.", repository: "owner/repo", sourceUrl: "https://github.com/owner/repo/blob/custom/README.md", truncated: false, kind: "repository" as const };
const payload = { skillId: id, readme };
const docs = { skill: null, readme };
const signal = () => new AbortController().signal;

test("only public catalog identities enter the README request", () => {
  assert.equal(publicReadmeId(skill), id);
  assert.equal(publicReadmeId(null), "");
  assert.equal(publicReadmeId({ ...skill, catalogId: undefined }), "");
  assert.equal(publicReadmeId({ ...skill, installed: { isLocalOnly: true } as never }), "");
  assert.equal(publicReadmeId({ ...skill, setItemKind: "private-release" }), "");
  assert.equal(publicReadmeId({ ...skill, setItemKind: "github" }), "");
  assert.equal(publicReadmeId({ ...skill, catalogId: "synced:private" }), "");
  assert.equal(publicReadmeId({ ...skill, catalogId: "owner/repo" }), "owner/repo", "repo-level skills have no :skill part");
});

test("README reads use no account credentials, source filters or private context", async () => {
  const client = new PublicReadmeClient(async (url, init) => {
    assert.equal(url, `/api/public/skill-readme?id=${encodeURIComponent(id)}`);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.deepEqual(init.headers, { Accept: "application/json" });
    assert.equal(init.body, undefined);
    return Response.json(payload);
  });
  assert.deepEqual(await client.load(id, signal()), docs);
});

test("successful and empty README reads are cached with expiry", async () => {
  for (const document of [readme, null]) {
    let calls = 0, now = 0;
    const client = new PublicReadmeClient(async () => { calls++; return Response.json({ skillId: id, readme: document }); }, () => now);
    assert.deepEqual(await client.load(id, signal()), document && { skill: null, readme: document });
    await client.load(id, signal());
    assert.equal(calls, 1);
    now = document ? 600_001 : 60_001;
    await client.load(id, signal());
    assert.equal(calls, 2);
  }
});

test("not found hides the README, but upstream failures retry rather than poison the cache", async () => {
  assert.equal(await new PublicReadmeClient(async () => new Response("", { status: 404 })).load(id, signal()), null);
  let calls = 0;
  const client = new PublicReadmeClient(async () => ++calls === 1 ? new Response("", { status: 503 }) : Response.json(payload));
  await assert.rejects(client.load(id, signal()));
  assert.deepEqual(await client.load(id, signal()), docs);
  assert.equal(calls, 2);
});

test("cancellation prevents a late response from entering the cache", async () => {
  let release!: (response: Response) => void, calls = 0;
  const client = new PublicReadmeClient(async () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { release = resolve; }) : Response.json(payload);
  });
  const controller = new AbortController();
  const pending = client.load(id, controller.signal);
  controller.abort();
  release(Response.json(payload));
  await assert.rejects(pending);
  assert.deepEqual(await client.load(id, signal()), docs);
  assert.equal(calls, 2);
});

test("invalid identity, unsafe source and oversized Markdown are rejected", () => {
  for (const value of [{ ...payload, skillId: "other" }, { skillId: id, readme: {} }, { skillId: id, readme: { ...readme, markdown: "x".repeat(20_001) } },
    { skillId: id, readme: { ...readme, sourceUrl: "javascript:alert(1)" } }, { skillId: id, readme: { ...readme, sourceUrl: "https://github.com/other/repo/blob/main/README.md" } }]) {
    assert.throws(() => parseReadme(value, id));
  }
});

test("response streaming is bounded and HTML fallback responses are not rendered", async () => {
  for (const response of [new Response("x".repeat(128_001), { headers: { "content-type": "application/json" } }), new Response("<html>fallback</html>", { headers: { "content-type": "text/html" } })]) {
    await assert.rejects(new PublicReadmeClient(async () => response).load(id, signal()));
  }
});

test("panel loads independently, aborts old selections and puts README before related skills", () => {
  const component = readFileSync(new URL("../src/app/unified/SkillReadme.tsx", import.meta.url), "utf8");
  assert.match(component, /return \(\) => controller\.abort\(\)/);
  assert.match(component, /state\.id === id/);
  assert.match(component, /if \(!controller\.signal\.aborted\)/);
  assert.match(component, /lazy\(\(\) => import\("\.\/ReadmeMarkdown"\)\)/);
  assert.match(component, /static getDerivedStateFromError\(\)/);
  assert.match(component, /<ReadmeRenderBoundary/);
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.ok(app.indexOf('<div className="ua-description">') < app.indexOf('<SkillReadme skill={detail} />'));
  assert.ok(app.indexOf('<SkillReadme skill={detail} />') < app.indexOf('<section className="ua-more">'));
});

test("stalled README fetches time out without blocking the ordinary skill detail", async () => {
  const client = new PublicReadmeClient(async (_url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json(payload)), 100);
    init.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Timed out")); }, { once: true });
  }), Date.now, 5);
  await assert.rejects(client.load(id, signal()));
});

test("README kinds are validated; responses cached before kinds existed read as repository READMEs", () => {
  for (const kind of ["skill-readme", "skill", "repository"] as const) {
    assert.equal(parseReadme({ skillId: id, readme: { ...readme, kind } }, id)?.kind, kind);
  }
  const { kind: _kind, ...legacy } = readme;
  assert.equal(parseReadme({ skillId: id, readme: legacy }, id)?.kind, "repository");
  assert.throws(() => parseReadme({ skillId: id, readme: { ...readme, kind: "html" } }, id));
});

test("panel titles say whose documentation is shown", () => {
  assert.equal(readmeTitle("owner/repo:skills/design", "skill"), "Skill instructions");
  assert.equal(readmeTitle("owner/repo:skills/design", "skill-readme"), "README");
  assert.equal(readmeTitle("owner/repo:skills/design", "repository"), "Repository README");
  assert.equal(readmeTitle("owner/ponytail:skills/ponytail", "repository"), "README");
  assert.equal(readmeTitle("owner/repo", "repository"), "README");
});

test("the README link opens the skill's folder, or the repository for a root skill", () => {
  const skill = { ...readme, kind: "skill" as const, sourceUrl: "https://github.com/owner/repo/blob/HEAD/skills/design/SKILL.md" };
  assert.equal(readmeBrowseUrl(skill), "https://github.com/owner/repo/tree/HEAD/skills/design");
  assert.equal(readmeBrowseUrl({ ...skill, sourceUrl: "https://github.com/owner/repo/blob/HEAD/SKILL.md" }), "https://github.com/owner/repo#readme");
});

test("both documents are read together; an older single-document SKILL.md moves to the skill tab", () => {
  const skillDoc = { ...readme, kind: "skill" as const, sourceUrl: "https://github.com/owner/repo/blob/HEAD/skills/design/SKILL.md" };
  assert.deepEqual(parseDocuments({ skillId: id, skill: skillDoc, readme }, id), { skill: skillDoc, readme });
  assert.deepEqual(parseDocuments({ skillId: id, readme: skillDoc }, id), { skill: skillDoc, readme: null });
  assert.equal(parseDocuments({ skillId: id, skill: null, readme: null }, id), null);
  assert.throws(() => parseDocuments({ skillId: id, skill: readme, readme }, id), "a README cannot fill the skill tab");
  assert.throws(() => parseDocuments({ skillId: id, skill: skillDoc, readme: skillDoc }, id));
});
