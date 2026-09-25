import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Set PLAYWRIGHT_MODULE to a locally installed Playwright entry point when not a project dependency.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const normalRoutes = process.env.PORTAL_BROWSER_REVIEW === "app";
const output = path.resolve(root, `../output/playwright/${normalRoutes ? "e" : "d4"}`);
const prefix = normalRoutes ? "/app/" : "/app/testing/d4/";
const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/testing/${normalRoutes ? "e" : "d4"}-review.tsx"></script></body></html>`;
const server = await createServer({ configFile: false, envFile: false, root, base: "/app/",
  cacheDir: path.join(root, "node_modules/.vite-d4"),
  resolve: { alias: { "@": path.join(root, "src") } },
  server: { host: "127.0.0.1", port: 0, open: false },
  plugins: [react(), tailwindcss(), { name: "d4-fixture-page", configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith(prefix)) return next();
      if (normalRoutes && !/^\/app\/(?:agents|sets|home|groups\/[^/?]+)?(?:\?.*)?$/.test(req.url)) return next();
      try { res.setHeader("Content-Type", "text/html"); res.end(await vite.transformIndexHtml(req.url, html)); }
      catch (error) { next(error); }
    });
  } }],
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [], forbidden = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      forbidden.push(url.origin + url.pathname); return route.abort();
    }
    return route.continue();
  });
  await mkdir(output, { recursive: true });
  const go = (suffix = "", waitUntil = "networkidle") => page.goto(origin + prefix + suffix, { waitUntil, timeout: 15000 });
  const fits = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Page overflow: ${page.url()}`);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    for (const [route, title] of [["", "Skills"], ["sets", "Sets"], ["agents", "Agents"], ["home", "Home"], ["groups/marketing", "Marketing essentials"]]) {
      await go(route);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      if (route.startsWith("groups/")) await page.locator(".rd-detail-table").waitFor();
      await fits();
      await page.screenshot({ path: path.join(output, `${width}-${route.replaceAll("/", "-") || "skills"}.png`), fullPage: true });
    }
    await go("agents");
    const connect = page.getByRole("button", { name: "Connect app", exact: true });
    await connect.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Generate connection code", exact: true }).click();
    await dialog.locator('input[aria-label="Connection code"]').waitFor();
    assert.equal(await dialog.locator('input[aria-label="Connection code"]').getAttribute("type"), "password");
    await fits();
    const tabList = await dialog.getByRole("tablist").boundingBox();
    const tabPanel = await dialog.getByRole("tabpanel").boundingBox();
    assert.ok(tabList && tabPanel && tabPanel.y >= tabList.y + tabList.height, "Connection description must sit below the tabs");
    assert.equal(await dialog.evaluate((element) => [...element.querySelectorAll('[role="tabpanel"], [role="tablist"]')]
      .every((child) => child.scrollWidth <= child.clientWidth)), true, "Connection tabs and description must not clip");
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= (width < 500 ? 844 : 900));
    await page.screenshot({ path: path.join(output, `${width}-connection.png`) });
    await dialog.getByRole("tab", { name: "Legacy token", exact: true }).click();
    assert.equal(await dialog.locator('input[aria-label="Connection code"]').count(), 0);
    await dialog.getByRole("button", { name: "Generate legacy token", exact: true }).click();
    await dialog.locator('input[aria-label="Legacy token"]').waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction((element) => element === document.activeElement, await connect.elementHandle(), { timeout: 1000 });
    assert.equal(await connect.evaluate((element) => element === document.activeElement), true);
    await connect.click();
    await dialog.getByRole("button", { name: "Generate connection code", exact: true }).waitFor();
    assert.equal(await dialog.locator('input[type="password"]').count(), 0);
    await page.keyboard.press("Escape");
    if (width < 500) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("link", { name: /^Sets/ }).last().click();
      await page.getByRole("heading", { name: "Sets", exact: true }).waitFor();
      await page.getByRole("button", { name: "Close navigation" }).waitFor({ state: "hidden" });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await go("");
  await page.getByRole("link", { name: /^Sets/ }).first().click();
  await page.getByRole("heading", { name: "Sets", exact: true }).waitFor();
  await page.goBack(); await page.getByRole("heading", { name: "Skills", exact: true }).waitFor();
  await page.goForward(); await page.getByRole("heading", { name: "Sets", exact: true }).waitFor();
  await page.reload(); await page.getByRole("heading", { name: "Sets", exact: true }).waitFor();
  await go("groups/shared");
  await page.getByText("You have read-only access", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Edit|Delete|Remove access|Add email/ }).count(), 0);
  await go("groups/denied");
  await page.getByText("Could not load this set", { exact: true }).waitFor();
  assert.equal(await page.locator(".rd-detail-table").count(), 0);
  await go("groups/marketing?slow=1", "domcontentloaded");
  await page.getByText("Loading set...", { exact: true }).waitFor();
  await page.getByRole("link", { name: /^Agents/ }).first().click();
  await page.getByRole("heading", { name: "Agents", exact: true }).waitFor();
  await page.waitForTimeout(750);
  assert.equal(await page.locator(".rd-detail-table").count(), 0);
  for (const scenario of ["empty", "loading", "error", "long-content"]) {
    await page.setViewportSize({ width: 320, height: 844 });
    await go(`${scenario === "long-content" ? "sets" : ""}?scenario=${scenario}`);
    const expected = { empty: "No skills found", loading: "Loading your library...", error: "Couldn't load your library",
      "long-content": "Marketing, communications, and international product launch planning" };
    await page.getByText(expected[scenario], { exact: true }).waitFor();
    await fits();
    await page.screenshot({ path: path.join(output, `320-${scenario}.png`), fullPage: true });
  }
  if (normalRoutes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await go("groups/marketing");
    await page.locator(".rd-detail-table").waitFor();
    assert.equal(await page.getByRole("link", { name: "Install", exact: true }).count(), 0);
    await go("groups/marketing?install=1");
    const install = page.getByRole("link", { name: "Install", exact: true });
    await install.waitFor();
    assert.match(await install.getAttribute("href"), /^omgskills:\/\/group\?url=/);
    await go("home");
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    assert.equal(await page.getByText(/Local GitHub simulation|changes stay local/).count(), 0);
  }
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
  console.log(`${normalRoutes ? "E normal-route controller" : "D4"} browser passed: 5 screens x 4 widths; connection modes/masking/clearing/focus/Escape; navigation/reload; shared/denied detail; late reads; empty/loading/error/long content. No real API or external requests.`);
} finally { await browser?.close(); await server.close(); }
