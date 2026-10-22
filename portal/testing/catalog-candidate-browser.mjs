import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const preparation = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.equal(preparation.stage, "candidate-web-prepared-not-hosted");
const origin = "https://omgskills-setup-test-f3b.netlify.app";
assert.equal(preparation.origin, origin);
assert.equal(preparation.deployable, false);
const site = preparation.site;
assert.ok(site.startsWith(path.join(root, "menubar/.build/catalog-candidate-web/candidate-")));
assert.equal(preparation.download, null); assert.equal(preparation.updateFeed, null);
for (const [file, hash] of Object.entries(preparation.files)) {
  assert.equal(createHash("sha256").update(await readFile(path.join(site, file))).digest("hex"), hash);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-extensions"] });
const output = path.join(root, "output/playwright/catalog-candidate");
const ids = ["example/tools:skills/novel", "example/tools:skills/pinned"];
const key = "omgskills.app.catalog-install-intent.v1.candidate";
const f1Key = "omgskills.app.catalog-install-intent.v1.f1";
const target = id => `${origin}/app/?view=discover&skill=${encodeURIComponent("catalog:" + id)}`;
const skill = id => ({ id, name: id.split("/").at(-1), author_handle: "example", description: "Public test skill.",
  github_url: "https://github.com/example/tools", tags: [], stars: 10,
  ...(id.endsWith("pinned") ? { repo_commit_sha: "a".repeat(40), skill_md_path: "aliases/pinned/SKILL.md" } : {}) });
const errors = [], forbidden = [], tools = [];
let intercepted = 0, missing = false, failed = false;
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.addInitScript(() => { window.__candidateHandoffs = []; });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = value => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (url.origin !== origin && url.origin !== "https://omgskills.com") {
      if (["github.com", "avatars.githubusercontent.com"].includes(url.hostname) && request.resourceType() === "image") {
        return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2r0AAAAASUVORK5CYII=", "base64") });
      }
      forbidden.push(url.origin + url.pathname); return route.abort();
    }
    if (url.pathname.startsWith("/api/") || /appcast|\.zip$|\.dmg$/.test(url.pathname)) {
      forbidden.push(url.pathname); return route.abort();
    }
    if (url.pathname === "/mcp") {
      const { id, params } = request.postDataJSON(); tools.push(params.name);
      assert.ok(["get_skill", "list_trending", "search_skills", "list_by_author"].includes(params.name));
      if (params.name === "get_skill" && failed) return route.fulfill({ status: 503, body: "Unavailable" });
      return json({ jsonrpc: "2.0", id, result: { structuredContent: params.name === "get_skill"
        ? { found: !missing, skill: missing ? null : skill(params.arguments.id) } : { skills: ids.map(skill) } } });
    }
    if (url.pathname.endsWith("manifest.json")) return json({ collections: { path: "collections.json" } });
    if (url.pathname.endsWith("collections.json")) return json({ collections: [] });
    if (url.pathname === "/catalog-skill-urls.json") return json({ skills: {} });
    const relative = url.pathname === "/app/" ? "app/index.html" : url.pathname.slice(1);
    if (!Object.hasOwn(preparation.files, relative)) { forbidden.push(url.pathname); return route.abort(); }
    let body = await readFile(path.join(site, relative));
    const extension = path.extname(relative);
    const contentType = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2" }[extension];
    if (extension === ".js") {
      const source = body.toString();
      assert.equal(source.split("window.location.assign(href)").length, 2, "Intercept the native handoff before loading the artifact");
      body = Buffer.from(source.replace("window.location.assign(href)", "window.__candidateHandoffs.push(href)"));
      intercepted++;
      assert.doesNotMatch(source, /ClerkProvider|clerk\.accounts|accounts\.dev|omgskills-setup-test:\/\//);
    }
    const headers = extension === ".html" ? { "Content-Security-Policy": (await readFile(path.join(site, "_headers"), "utf8"))
      .split("\n").find(line => line.trim().startsWith("Content-Security-Policy:")).trim().slice("Content-Security-Policy:".length).trim() } : {};
    return route.fulfill({ contentType, body, headers });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  const region = page.getByRole("region", { name: "Install skill", exact: true });
  const open = () => region.getByRole("button", { name: "Open in OMGSkills Candidate", exact: true });
  const setup = () => region.getByRole("button", { name: "Set up OMGSkills Candidate", exact: true });
  const retry = () => region.getByRole("button", { name: "Try opening again", exact: true });
  const cancel = () => region.getByRole("button", { name: "Cancel setup", exact: true });
  const handoffs = () => page.evaluate(() => window.__candidateHandoffs);
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(target(ids[0])); await open().waitFor(); assert.ok(intercepted > 0);
    await page.evaluate(key => sessionStorage.setItem(key, "unrelated F1 request"), f1Key);
    for (const agent of ["codex", "claude"]) {
      await region.getByLabel("Install in", { exact: true }).selectOption(agent);
      await open().click();
      const link = new URL((await handoffs()).at(-1));
      assert.equal(link.protocol, "omgskills:"); assert.equal(link.host, "catalog-install");
      assert.deepEqual(Object.fromEntries(link.searchParams), { v: "1", id: ids[0], agent });
      assert.match(await region.getByRole("status").innerText(), /^Opening requested/);
      await cancel().click();
    }
    await setup().click();
    assert.ok(await region.getByRole("button", { name: "Download for Mac", exact: true }).isDisabled());
    assert.equal(await region.getByRole("link").count(), 0);
    await page.reload(); await retry().waitFor(); assert.deepEqual(await handoffs(), []);
    assert.equal(await region.getByLabel("Install in", { exact: true }).inputValue(), "claude");
    const reads = tools.filter(name => name === "get_skill").length;
    await retry().click(); await open().waitFor(); assert.deepEqual(await handoffs(), []);
    assert.ok(tools.filter(name => name === "get_skill").length > reads);
    await open().click(); assert.equal((await handoffs()).length, 1);
    await region.getByLabel("Install in", { exact: true }).selectOption("codex");
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
    await setup().click(); await region.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${width}-setup.png`) });
    const dimensions = await region.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth,
      boxes: [...node.querySelectorAll("button,select")].map(control => ({ left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right })) }));
    assert.ok(dimensions.scroll <= dimensions.width + 1);
    assert.ok(dimensions.boxes.every(box => box.left >= 0 && box.right <= width));
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), f1Key), "unrelated F1 request");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open pinned", exact: true }).first().click();
    await open().waitFor(); assert.ok(await open().isEnabled());
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
    await region.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, `${width}-open.png`) });
  }
  const previousHandoffs = await handoffs();
  await setup().click(); failed = true; await retry().click();
  await region.getByRole("status").filter({ hasText: "Could not check" }).waitFor(); assert.deepEqual(await handoffs(), previousHandoffs);
  failed = false; missing = true; await retry().click();
  await region.getByRole("status").filter({ hasText: "no longer available" }).waitFor(); assert.ok(await retry().isDisabled());
  assert.deepEqual(await handoffs(), previousHandoffs);
  await cancel().click(); missing = false;
  await page.goto("https://omgskills.com/app/?view=discover");
  await page.getByRole("heading", { name: "Candidate test unavailable" }).waitFor();
  assert.equal(await region.count(), 0); assert.deepEqual(await handoffs(), []);
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
  const receipt = { boundary: "Locally built candidate artifact; all network responses mocked; all native handoffs intercepted; no hosting, account access or app launch",
    preparation: process.argv[2], widths: [1440, 390], targets: ["codex", "claude"], intercepted,
    checks: ["exact candidate origin", "product ID-only handoff", "both targets", "setup/reload/explicit retry", "download unavailable",
      "F1 isolation", "target/selection isolation", "legacy/pinned details", "failure/missing states", "production origin refused", "no overflow"], errors, forbidden };
  await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log("PASS: offline candidate browser checks at 1440/390px. Evidence: " + output);
} finally { await browser.close(); }
