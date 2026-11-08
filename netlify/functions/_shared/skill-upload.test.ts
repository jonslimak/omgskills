import assert from "node:assert/strict";
import test from "node:test";
import { GithubImportError } from "./github-skill-import.js";
import { portalUploadSkill } from "../portal-upload-skill.mjs";
import { MAX_UPLOAD_BODY_BYTES, readUploadedSkill } from "./skill-upload.js";

const skillMd = (name: string) => `---\nname: ${name}\ndescription: Helps with ${name}.\n---\n# ${name}\n`;

function form(folder: string, files: Record<string, string | Uint8Array<ArrayBuffer>>, extra: Record<string, string> = {}) {
  const data = new FormData();
  data.append("folder", folder);
  data.append("paths", JSON.stringify(Object.keys(files)));
  for (const [path, body] of Object.entries(files)) data.append("file", new Blob([body]), path.split("/").at(-1));
  for (const [key, value] of Object.entries(extra)) data.append(key, value);
  return data;
}

const refused = (promise: Promise<unknown>, code: string, message?: RegExp) => assert.rejects(promise,
  (error) => error instanceof GithubImportError && error.code === code && (!message || message.test(error.message)));

test("an uploaded folder is checked like a GitHub skill", async () => {
  const skill = await readUploadedSkill(form("notes", {
    "SKILL.md": skillMd("notes"), "scripts/run.sh": "#!/bin/sh\necho hi\n", "refs/a.md": "A\n",
    ".DS_Store": "junk", ".git/config": "[core]\n", "refs/.DS_Store": "junk",
  }));
  assert.equal(skill.name, "notes");
  assert.equal(skill.description, "Helps with notes.");
  assert.equal(skill.folder, "notes");
  assert.deepEqual(skill.files.map(file => [file.path, file.mode]).sort(),
    [["SKILL.md", "100644"], ["refs/a.md", "100644"], ["scripts/run.sh", "100755"]]);
  assert.ok(skill.labels.includes("scripts"));
});

test("the one skill in a folder below is the one meant; files picked one by one sit at the top", async () => {
  const nested = await readUploadedSkill(form("my-repo", { "README.md": "repo\n", "skills/pdf/SKILL.md": skillMd("pdf"), "skills/pdf/x.md": "x\n" }));
  assert.equal(nested.folder, "pdf");
  assert.deepEqual(nested.files.map(file => file.path).sort(), ["SKILL.md", "x.md"]);
  const loose = await readUploadedSkill(form("", { "SKILL.md": skillMd("loose") }));
  assert.equal(loose.folder, "");
  assert.equal(loose.name, "loose");
});

test("what can't be added says why", async () => {
  await refused(readUploadedSkill(form("x", { "a/SKILL.md": skillMd("a"), "b/SKILL.md": skillMd("b") })), "several_skills", /2 skills/);
  await refused(readUploadedSkill(form("x", { "README.md": "hi\n" })), "no_skill");
  await refused(readUploadedSkill(form("x", { "SKILL.md": skillMd("x"), "../evil": "x" })), "unsupported_file", /\.\.\/evil/);
  await refused(readUploadedSkill(form("x", { "SKILL.md": skillMd("x"), "big.bin": new Uint8Array(5 * 1024 * 1024) })), "too_large");
  await refused(readUploadedSkill(form("x", { "SKILL.md": skillMd("x"),
    "config.env": "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLEKEY9\naws_access_key_id = AKIAZ3MJW5RLT7Q4NBVX\n" })),
    "secret", /config.env" line \d+ looks like a password or key/);
  await refused(readUploadedSkill(form("x", { "SKILL.md": "no header\n" })), "no_name");
  const broken = new FormData();
  broken.append("folder", "x");
  broken.append("paths", JSON.stringify(["SKILL.md", "extra"]));
  broken.append("file", new Blob([skillMd("x")]), "SKILL.md");
  await refused(readUploadedSkill(broken), "invalid_link");
  assert.ok(MAX_UPLOAD_BODY_BYTES * 4 / 3 < 6 * 1024 * 1024, "fits under Netlify's 6 MB limit once base64-encoded");
});

test("the endpoint previews, and refuses a body over the limit before reading it", async () => {
  const dependencies = {
    available: () => true, requireUserId: async () => "user-1", store: () => { throw new Error("no store in a preview"); },
    pool: () => ({ query: async (sql: string) => sql.includes("cloud_save_settings")
      ? { rows: [{ enabled: true, excludedSkillKeys: [] }] } : { rows: [] } }) as never,
  };
  const sent = new Request("https://omgskills.com/api/portal/upload-skill", { method: "POST", body: form("notes", { "SKILL.md": skillMd("notes") }) });
  const bytes = await sent.arrayBuffer();
  const ok = await portalUploadSkill(new Request(sent.url, { method: "POST", body: bytes,
    headers: { "content-type": sent.headers.get("content-type")!, "content-length": String(bytes.byteLength) } }), dependencies);
  const body = await ok.json();
  assert.equal(ok.status, 200, JSON.stringify(body));
  assert.equal(body.name, "notes");
  assert.equal(body.fileCount, 1);
  const big = await portalUploadSkill(new Request("https://omgskills.com/api/portal/upload-skill",
    { method: "POST", headers: { "content-length": String(10 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" }, body: "x" }), dependencies);
  assert.equal(big.status, 413);
});
