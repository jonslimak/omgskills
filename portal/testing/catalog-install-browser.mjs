import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../output/playwright/catalog-install/", import.meta.url));
process.chdir(root);
for (const key of ["VITE_NEWMAC_WEB_INSTALL_TEST", "VITE_NEWMAC_F1", "VITE_NEWMAC_SETUP_TEST", "VITE_PORTAL_INTEGRATION", "VITE_PORTAL_PREVIEW"]) process.env[key] = "0";
process.env.VITE_NEWMAC_CATALOG_INSTALL_TEST = "1";
process.env.VITE_CLERK_PUBLISHABLE_KEY = "pk_test_ZjQtdGVzdC5jbGVyay5hY2NvdW50cy5kZXYk";
const cache = await mkdtemp(join(tmpdir(), "catalog-install-browser-"));
let browser, server;
try {
  await assert.rejects(createServer({ root, cacheDir: cache, server: { host: "0.0.0.0" }, logLevel: "error" }), /must bind to loopback/);
  server = await createServer({ root, cacheDir: cache, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  // Exercise the actual Vite bridge before the offline browser response fixtures.
  const health = await (await fetch(origin + "/mcp/health")).json();
  assert.equal(health.sourceTrack, "local-catalog-install-test");
  assert.ok(health.skillCount > 0);
  assert.equal((await fetch(origin + "/api/portal/skills")).status, 403);
  const detailId = "anthropics/skills:skills/frontend-design";
  const raw = await (await fetch(origin + "/api/catalog/install-record?id=" + encodeURIComponent(detailId))).json();
  assert.equal(raw.found, true); assert.equal(raw.skill.id, detailId);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-extensions"] });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const errors = [], forbidden = [], calls = [];
  let intercepted = 0, holdDetail = null, missing = false, failed = false;
  const key = "omgskills.app.catalog-install-intent.v1.f1";
  const ids = ["example/tools:skills/novel", "example/tools:skills/second"];
  const target = id => `${origin}/app/?view=discover&skill=${encodeURIComponent("catalog:" + id)}`;
  const skill = id => ({ id, name: id.split("/").at(-1), description: "Public catalog fixture for browser verification.", author_handle: "example",
    github_url: "https://github.com/example/tools", tags: [], stars: 20,
    ...(id.endsWith("pinned") ? { repo_commit_sha: "a".repeat(40), skill_md_path: "aliases/pinned/SKILL.md" } : {}) });
  await context.addInitScript(() => { window.__catalogHandoffs = []; });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.origin !== origin) {
      if (["github.com", "avatars.githubusercontent.com"].includes(url.hostname) && request.resourceType() === "image") {
        return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2r0AAAAASUVORK5CYII=", "base64") });
      }
      forbidden.push(url.origin + url.pathname); return route.abort();
    }
    if (url.pathname.startsWith("/api/")) { forbidden.push(url.pathname); return route.abort(); }
    if (url.pathname.includes("@clerk_clerk-react.js")) return route.fulfill({ contentType: "text/javascript", body: `
      const token = async () => { throw new Error("Unexpected account request"); };
      export const ClerkProvider = ({children}) => children;
      export const useAuth = () => ({isLoaded:true,isSignedIn:false,userId:null,sessionId:null,getToken:token});
      export const useUser = () => ({isLoaded:true,user:null});
      export const useClerk = () => ({openSignIn:()=>{throw new Error("Unexpected sign-in")}});
    ` });
    if (url.pathname.endsWith("/src/app/unified/CatalogInstallSetup.tsx")) {
      const response = await route.fetch(), body = await response.text();
      assert.equal(body.split("window.location.assign(href)").length, 2, "Intercept the OS handoff before every click");
      intercepted++;
      return route.fulfill({ response, body: body.replace("window.location.assign(href)", "window.__catalogHandoffs.push(href)") });
    }
    if (url.pathname === "/mcp") {
      const { id, params } = request.postDataJSON();
      calls.push(params.name);
      if (params.name === "get_skill" && holdDetail) await holdDetail;
      if (params.name === "get_skill" && failed) return route.fulfill({ status: 503, body: "unavailable" });
      return json({ jsonrpc: "2.0", id, result: { structuredContent: params.name === "get_skill"
        ? { found: !missing, skill: missing ? null : skill(params.arguments.id) } : { skills: ids.map(skill) } } });
    }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  const install = page.getByRole("region", { name: "Install skill", exact: true });
  const open = () => install.getByRole("button", { name: "Open in OMGSkills F1 Test", exact: true });
  const retry = () => install.getByRole("button", { name: "Try opening again", exact: true });
  const setup = () => install.getByRole("button", { name: "Set up OMGSkills F1 Test", exact: true });
  const cancel = () => install.getByRole("button", { name: "Cancel setup", exact: true });
  const handoffs = () => page.evaluate(() => window.__catalogHandoffs);
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(target(ids[0])); await open().waitFor(); assert.ok(intercepted > 0);
    for (const agent of ["codex", "claude"]) {
      await install.getByLabel("Install in", { exact: true }).selectOption(agent);
      await open().click();
      const link = new URL((await handoffs()).at(-1));
      assert.equal(link.protocol, "omgskills-f1:"); assert.equal(link.host, "catalog-install");
      assert.deepEqual(Object.fromEntries(link.searchParams), { v: "1", id: ids[0], agent });
      assert.match(await install.getByRole("status").innerText(), /^Opening requested/);
      await cancel().click();
    }
    await setup().click();
    assert.ok(await install.getByRole("button", { name: "Download for Mac", exact: true }).isDisabled());
    assert.equal(await install.getByRole("link").count(), 0, "No incompatible setup-test download");
    await page.reload(); await retry().waitFor(); assert.deepEqual(await handoffs(), []);
    assert.equal(await install.getByLabel("Install in", { exact: true }).inputValue(), "claude");
    const reads = calls.filter(value => value === "get_skill").length;
    await retry().click(); await open().waitFor(); assert.deepEqual(await handoffs(), []);
    assert.ok(calls.filter(value => value === "get_skill").length > reads);
    await open().click(); assert.equal((await handoffs()).length, 1);
    await install.getByLabel("Install in", { exact: true }).selectOption("codex");
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
    await setup().click(); await install.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${width}-setup.png`) });
    const overflow = await install.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth,
      boxes: [...node.querySelectorAll("button,select")].map(control => ({ left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right })) }));
    assert.ok(overflow.scroll <= overflow.width + 1); assert.ok(overflow.boxes.every(box => box.left >= 0 && box.right <= width));
    await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Open second", exact: true }).first().click();
    await open().waitFor(); assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
    await install.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, `${width}-open.png`) });
  }
  await page.goto(target("example/tools:skills/pinned")); await open().waitFor(); assert.ok(await open().isEnabled());
  await setup().click(); failed = true; await retry().click();
  await install.getByRole("status").filter({ hasText: "Could not check" }).waitFor(); assert.deepEqual(await handoffs(), []);
  failed = false; missing = true; await retry().click();
  await install.getByRole("status").filter({ hasText: "no longer available" }).waitFor(); assert.ok(await retry().isDisabled());
  await cancel().click();
  await page.goto(target("example/tools:skills/missing"));
  await page.getByRole("dialog").getByRole("status").filter({ hasText: "no longer available" }).waitFor();
  assert.equal(await install.count(), 0); missing = false;
  let release; holdDetail = new Promise(resolve => { release = resolve; });
  await page.goto(target(ids[0]), { waitUntil: "domcontentloaded" });
  await page.getByRole("dialog").getByRole("status").filter({ hasText: "Loading skill" }).waitFor();
  assert.equal(await install.count(), 0); release(); holdDetail = null; await open().waitFor();
  assert.deepEqual(await handoffs(), []); assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
  const receipt = { boundary: "Local Vite read checks plus offline browser fixtures; all OS handoffs intercepted; no app or account actions",
    widths: [1440, 390], targets: ["codex", "claude"], localSnapshotCount: health.skillCount,
    checks: ["normal /app/", "ID-only handoff", "both targets", "setup/reload/explicit retry", "no incompatible download", "selection/target isolation",
      "missing-path and pinned skills", "error/missing/loading states", "no overflow"], intercepted, errors, forbidden };
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log("PASS: catalog install browser checks at 1440/390px. Screenshots: " + output);
} finally {
  await browser?.close(); await server?.close(); await rm(cache, { recursive: true, force: true });
}
