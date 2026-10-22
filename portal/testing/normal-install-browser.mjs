import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Real normal-route UI; auth/catalog responses and the OS handoff are browser-local mocks.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../output/playwright/f4/", import.meta.url));
process.chdir(root);
process.env.VITE_NEWMAC_WEB_INSTALL_TEST = "1";
process.env.VITE_CLERK_PUBLISHABLE_KEY = "pk_test_ZjQtdGVzdC5jbGVyay5hY2NvdW50cy5kZXYk";
const cache = await mkdtemp(join(tmpdir(), "omgskills-f4-browser-"));
const server = await createServer({ root, cacheDir: cache, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-extensions"] });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const errors = [], forbidden = [], calls = [];
  let handoffIntercepted = 0, changedSource = false, holdDetail = null;
  const ids = ["example/tools:skills/novel", "example/tools:skills/second"];
  const skill = id => ({ id, name: id.split("/").at(-1), description: "Public catalog example for isolated browser verification.",
    author_handle: "example", github_url: changedSource ? "https://github.com/example/changed" : "https://github.com/example/tools",
    skill_md_path: `skills/${id.split("/").at(-1)}/SKILL.md`, tags: [], stars: 20,
    ...(id.endsWith("pinned") ? { repo_commit_sha: "a".repeat(40) } : {}) });
  const target = id => `${origin}/app/?view=discover&skill=${encodeURIComponent("catalog:" + id)}`;
  await context.addInitScript(() => {
    window.__f4Handoffs = [];
    window.__f4Downloads = [];
    document.addEventListener("click", event => {
      const link = event.target.closest?.("a");
      if (link?.href.startsWith("https://omgskills-setup-test-f3b.netlify.app/")) {
        event.preventDefault();
        window.__f4Downloads.push(link.href);
      }
    }, true);
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.origin !== origin) {
      if (["github.com", "avatars.githubusercontent.com"].includes(url.hostname) && request.resourceType() === "image") {
        return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2r0AAAAASUVORK5CYII=", "base64") });
      }
      forbidden.push(url.origin + url.pathname);
      return route.abort();
    }
    if (url.pathname.startsWith("/api/")) { forbidden.push(url.pathname); return route.abort(); }
    if (url.pathname.includes("@clerk_clerk-react.js")) {
      return route.fulfill({ contentType: "text/javascript", body: `
        const token = async () => { throw new Error("No account requests in F4 browser test"); };
        export const ClerkProvider = ({children}) => children;
        export const useAuth = () => ({isLoaded:true, isSignedIn:false, userId:null, sessionId:null, getToken:token});
        export const useUser = () => ({isLoaded:true, user:null});
        export const useClerk = () => ({openSignIn:()=>{throw new Error("Unexpected sign-in")}});
      ` });
    }
    if (url.pathname.endsWith("/src/app/unified/PublicInstallSetup.tsx")) {
      const response = await route.fetch();
      const body = await response.text();
      assert.equal(body.split("window.location.assign(href)").length, 2, "OS handoff must be replaced before any click");
      handoffIntercepted++;
      return route.fulfill({ response, body: body.replace("window.location.assign(href)", "window.__f4Handoffs.push(href)") });
    }
    if (url.pathname.endsWith("manifest.json")) return json({ collections: { path: "collections-abc123.json" } });
    if (url.pathname.includes("collections-abc123")) return json({ collections: [] });
    if (url.pathname === "/catalog-skill-urls.json") return json({ skills: {} });
    if (url.pathname === "/mcp") {
      const { id, params } = request.postDataJSON();
      assert.ok(["list_trending", "get_skill", "get_skills", "search_skills", "list_by_author"].includes(params.name));
      calls.push(params.name);
      if (params.name === "get_skill" && holdDetail) await holdDetail;
      const data = params.name === "get_skill" ? (params.arguments.id.endsWith("missing") ? { found: false, skill: null }
        : { found: true, skill: skill(params.arguments.id) }) : { skills: ids.map(skill) };
      return json({ jsonrpc: "2.0", id, result: { structuredContent: data } });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  const install = page.getByRole("region", { name: "Install in Codex" });
  const review = () => install.getByRole("button", { name: "Review in OMGSkills Setup Test", exact: true });
  const retry = () => install.getByRole("button", { name: "Try opening again", exact: true });
  const setup = () => install.getByRole("button", { name: "Set up OMGSkills Setup Test", exact: true });
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    changedSource = false;
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(target(ids[0]));
    await review().waitFor();
    assert.ok(handoffIntercepted > 0);
    await review().click();
    assert.equal(await page.evaluate(() => window.__f4Handoffs.length), 1);
    assert.match(await install.getByRole("status").innerText(), /Opening requested/);
    await setup().click();
    const download = install.getByRole("link", { name: "Download OMGSkills Setup Test", exact: true });
    assert.match(await download.getAttribute("href"), /\/updates\/f3d\/OMGSkills-Setup-Test-0\.1\.2-arm64\.zip$/);
    await download.click();
    assert.equal(await page.evaluate(() => window.__f4Downloads.length), 1);
    await install.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${width}-setup.png`) });
    const overflow = await install.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth,
      controls: [...node.querySelectorAll("button,a")].map(control => ({ left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right })) }));
    assert.ok(overflow.scroll <= overflow.width + 1);
    assert.ok(overflow.controls.every(box => box.left >= 0 && box.right <= width));
    await page.reload();
    await retry().waitFor();
    assert.equal(await page.evaluate(() => window.__f4Handoffs.length), 0);
    const reads = calls.filter(name => name === "get_skill").length;
    await retry().click();
    await review().waitFor();
    assert.ok(calls.filter(name => name === "get_skill").length > reads);
    assert.equal(await page.evaluate(() => window.__f4Handoffs.length), 0);
    await review().click();
    assert.equal(await page.evaluate(() => window.__f4Handoffs.length), 1);
    changedSource = true;
    await retry().click();
    await install.getByText("The source or version changed. Cancel setup and select the skill again.", { exact: true }).waitFor();
    assert.equal(await retry().isDisabled(), true);
    await install.getByRole("button", { name: "Cancel setup" }).click();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("omgskills.app.install-intent.v1.setup-test")), null);
    changedSource = false;
    await setup().click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open second", exact: true }).first().click();
    await review().waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("omgskills.app.install-intent.v1.setup-test")), null);
    await install.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${width}-review.png`) });
  }
  for (const name of ["pinned", "missing"]) {
    await page.goto(target(`example/tools:skills/${name}`));
    if (name === "pinned") {
      await install.getByRole("status").filter({ hasText: "needs pin verification" }).waitFor();
      assert.equal(await review().isDisabled(), true);
    } else {
      await page.getByRole("dialog").getByRole("status").filter({ hasText: "no longer available" }).waitFor();
      assert.equal(await install.count(), 0);
    }
    assert.equal(await page.evaluate(() => window.__f4Handoffs.length), 0);
  }
  let release;
  holdDetail = new Promise(resolve => { release = resolve; });
  await page.goto(target(ids[0]), { waitUntil: "domcontentloaded" });
  await page.getByRole("dialog").getByRole("status").filter({ hasText: "Loading skill" }).waitFor();
  assert.equal(await install.count(), 0);
  release();
  holdDetail = null;
  await review().waitFor();
  assert.equal(await review().isEnabled(), true);
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  const receipt = { boundary: "Offline browser mocks; no account, app launch, download, install or VM action",
    widths: [1440, 390], checks: ["normal /app/ bootstrap", "signed-out detail", "setup/reload/retry", "explicit handoff click", "fixed B ZIP",
      "source-change refusal", "cancel", "selection isolation", "pinned/missing/loading refusal", "no overflow"],
    handoffIntercepted, errors, forbidden };
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log("PASS: normal-page browser checks at 1440/390px; all native/download actions intercepted. Screenshots: " + output);
} finally {
  await browser?.close();
  await server.close();
}
