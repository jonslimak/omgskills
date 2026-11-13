// site/install.sh: the Mac app installer behind "Set up with your agent" (setup-prompt.md).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const constant = (script, name) => script.match(new RegExp(`^${name}="([^"]*)"$`, "m"))?.[1];

test("the installer downloads the published Mac app and nothing else", async () => {
  const script = await read("site/install.sh");
  const distribution = await read("portal/src/app/unified/production-distribution.ts");
  const field = name => distribution.match(new RegExp(`${name}: "([^"]+)"`))?.[1];
  assert.equal(constant(script, "VERSION"), field("version"));
  assert.equal(constant(script, "BUILD"), field("build"));
  assert.equal(constant(script, "URL"), field("url"));
  assert.equal(constant(script, "SHA256"), field("sha256"));
  assert.match(await read("site/_redirects"), new RegExp(`^/download ${field("url").replace(/[.]/g, "\\.")} 302$`, "m"));
  assert.match(constant(script, "SHA256"), /^[0-9a-f]{64}$/);
  assert.match(script, /^set -euo pipefail$/m);
  const code = script.split("\n").filter(line => !line.trimStart().startsWith("#")).join("\n");
  for (const forbidden of [/\bsudo\b/, /LaunchAgents/, /\.claude/, /\.codex/, /\bxattr\b/, /\.zshrc|\.bashrc|\.profile/]) {
    assert.doesNotMatch(code, forbidden);
  }
  const headers = await read("netlify.toml");
  assert.match(headers, /for = "\/install\.sh"\s+\[headers\.values\]\s+Content-Type = "text\/plain; charset=utf-8"\s+Cache-Control = "public, max-age=0, must-revalidate"/);
});

// Runs the real script against stand-in system tools and a fake app, on a Mac only.
const mac = process.platform === "darwin";

async function sandbox(t, { arm64 = "1", macos = "15.1", team = "S4R7UHY755", spctl = 0, running = false, existingBuild, userBuild, foreign = false, readOnlyApps = false, badChecksum = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "omgskills-install-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home"); const apps = path.join(root, "Applications"); const bin = path.join(root, "bin");
  await Promise.all([mkdir(home, { recursive: true }), mkdir(apps), mkdir(bin)]);
  const makeApp = async (dir, build, id = "com.jonslimak.omgskills") => {
    const contents = path.join(dir, "omgskills.app", "Contents");
    await mkdir(contents, { recursive: true });
    await writeFile(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleVersion</key><string>${build}</string><key>CFBundleShortVersionString</key><string>0.0.${build}</string></dict></plist>`);
  };
  const staging = path.join(root, "staging");
  await makeApp(staging, "38");
  const zip = path.join(root, "release.zip");
  assert.equal(spawnSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", path.join(staging, "omgskills.app"), zip]).status, 0);
  const sha = badChecksum ? "0".repeat(64) : createHash("sha256").update(await readFile(zip)).digest("hex");
  if (existingBuild) await makeApp(apps, existingBuild);
  if (userBuild) await makeApp(path.join(home, "Applications"), userBuild);
  if (foreign) await makeApp(apps, "1", "com.example.other");
  if (readOnlyApps) { await chmod(apps, 0o555); t.after(() => chmod(apps, 0o755).catch(() => {})); }
  const log = path.join(root, "calls.log");
  const stub = async (name, body) => { await writeFile(path.join(bin, name), `#!/bin/bash\n${body}\n`); await chmod(path.join(bin, name), 0o755); };
  await stub("uname", 'echo Darwin');
  await stub("sysctl", `echo ${arm64}`);
  await stub("sw_vers", `echo ${macos}`);
  await stub("pgrep", running ? "exit 0" : "exit 1");
  await stub("curl", `echo "curl $*" >> "${log}"; while [ $# -gt 0 ]; do if [ "$1" = -o ]; then cp "${zip}" "$2"; fi; shift; done`);
  await stub("codesign", `if [ "$1" = -dv ]; then echo "TeamIdentifier=${team}" >&2; fi; exit 0`);
  await stub("spctl", `exit ${spctl}`);
  await stub("open", `echo "open $*" >> "${log}"`);
  const script = (await read("site/install.sh"))
    .replace(/^SHA256=".*"$/m, `SHA256="${sha}"`)
    .replace(/^APPLICATIONS_DIR=".*"$/m, `APPLICATIONS_DIR="${apps}"`);
  const run = (input = script) => {
    const result = spawnSync("/bin/bash", ["-s"], { input, encoding: "utf8",
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin:/usr/sbin`, TMPDIR: root } });
    return { ...result, output: result.stdout + result.stderr };
  };
  const calls = async () => { try { return await readFile(log, "utf8"); } catch { return ""; } };
  const build = async dir => (spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleVersion", path.join(dir, "omgskills.app/Contents/Info.plist")], { encoding: "utf8" }).stdout || "").trim();
  return { run, calls, apps, home, build, script };
}

test("installs into Applications and opens it", { skip: !mac }, async t => {
  const box = await sandbox(t);
  const result = box.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(await box.build(box.apps), "38");
  assert.match(await box.calls(), new RegExp(`open ${box.apps.replace(/[.]/g, "\\.")}/omgskills\\.app`));
  assert.match(result.output, /Installed in .* and opened/);
});

for (const [name, options, message] of [
  ["Intel Mac", { arm64: "0" }, /Apple silicon/],
  ["old macOS", { macos: "13.6" }, /macOS 14 or later/],
  ["checksum mismatch", { badChecksum: true }, /checksum/],
  ["another signer", { team: "ABCDE12345" }, /isn't signed by omgskills/],
  ["not approved by macOS", { spctl: 3 }, /did not approve/],
]) {
  test(`stops without installing: ${name}`, { skip: !mac }, async t => {
    const box = await sandbox(t, options);
    const result = box.run();
    assert.notEqual(result.status, 0);
    assert.match(result.output, message);
    assert.deepEqual(await readdir(box.apps), []);
    assert.doesNotMatch(await box.calls(), /^open /m);
  });
}

test("an up-to-date install is opened, not downloaded again", { skip: !mac }, async t => {
  const box = await sandbox(t, { existingBuild: "38" });
  const result = box.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /already installed/);
  assert.doesNotMatch(await box.calls(), /curl/);
});

test("an older install is moved to the Trash and replaced", { skip: !mac }, async t => {
  const box = await sandbox(t, { existingBuild: "20" });
  const result = box.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(await box.build(box.apps), "38");
  assert.match((await readdir(path.join(box.home, ".Trash"))).join(), /^omgskills-0\.0\.20-\d+\.app$/);
});

test("an older install that is open is left alone", { skip: !mac }, async t => {
  const box = await sandbox(t, { existingBuild: "20", running: true });
  const result = box.run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Quit it/);
  assert.equal(await box.build(box.apps), "20");
});

test("the site and the app offer the same prompt, next to Download, on a Mac only", async () => {
  const widget = await read("site/setup-prompt.js");
  const app = await read("portal/src/app/unified/setup-prompt.ts");
  const prompt = source => [...source.match(/PROMPT = ([\s\S]*?);\n/)[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`)).join("");
  assert.equal(prompt(widget), prompt(app));
  assert.match(prompt(app), /curl -fsSL https:\/\/omgskills\.com\/install\.sh \| bash/);
  assert.match(prompt(app), /Don't connect anything unless I say yes/);
  assert.match(prompt(app), /older copy goes to the Trash/);
  assert.match(prompt(app), /missing issuer \(iss\) error, your Codex is too old/);
  for (const source of [widget, app]) assert.match(source, /maxTouchPoints > 1/);
  for (const page of ["site/guide/index.html", "site/support/index.html", "site/connect-stripe-to-claude/index.html"]) {
    const html = await read(page);
    assert.match(html, /<script defer src="\/setup-prompt\.js"><\/script>/, page);
    assert.match(html, /data-setup-prompt[^>]*hidden/, page);
  }
  assert.match(await read("portal/src/app/unified/CatalogInstallSetup.tsx"), /<AgentSetupPrompt \/>/);
});

test("a script cut off mid-download runs nothing", { skip: !mac }, async t => {
  const box = await sandbox(t, { existingBuild: "20" });
  const cut = box.script.slice(0, box.script.indexOf("main \"$@\"")) + "\n";
  const result = box.run(cut);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output, "");
  assert.equal(await box.build(box.apps), "20");
  assert.equal(await box.calls(), "");
});

test("something else named omgskills.app is left alone", { skip: !mac }, async t => {
  const box = await sandbox(t, { foreign: true });
  const result = box.run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /is not the omgskills app/);
  assert.doesNotMatch(await box.calls(), /curl/);
});

test("a newer copy in ~/Applications is opened, not replaced", { skip: !mac }, async t => {
  const box = await sandbox(t, { existingBuild: "20", userBuild: "38" });
  const result = box.run();
  assert.equal(result.status, 0, result.output);
  assert.match(await box.calls(), /open .*home\/Applications\/omgskills\.app/);
  assert.equal(await box.build(box.apps), "20");
  assert.doesNotMatch(await box.calls(), /curl/);
});

test("without access to /Applications it installs into ~/Applications", { skip: !mac || process.getuid?.() === 0 }, async t => {
  const box = await sandbox(t, { readOnlyApps: true });
  const result = box.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(await box.build(path.join(box.home, "Applications")), "38");
  assert.deepEqual(await readdir(box.apps), []);
});

test("the install pop-over points agents to a safety page that matches the app", async () => {
  const pop = await read("portal/src/app/unified/CatalogInstallSetup.tsx");
  assert.match(pop, /href="https:\/\/omgskills\.com\/safety\/"/);
  const page = await read("site/safety/index.html");
  const script = await read("site/install.sh");
  assert.match(page, new RegExp(constant(script, "TEAM_ID")));
  assert.match(page, /href="\/install\.sh"/);
  assert.match(page, /github\.com\/jonslimak\/omgskills\/tree\/main\/menubar/);
});
