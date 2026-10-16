import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const origin = process.env.PORTAL_REVIEW_ORIGIN || "http://127.0.0.1:5193";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = fileURLToPath(new URL("../../output/playwright/c1-search-integration/", import.meta.url));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [], forbidden = [], checks = [];
try {
  const context = await browser.newContext();
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) { forbidden.push(url.href); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  await mkdir(output, { recursive: true });
  const go = async (query = "q=design") => {
    const params = new URLSearchParams(query); params.set("paging", "1");
    if (!params.has("view")) params.set("view", "discover");
    await page.goto(`${origin}/app/testing/unified-acceptance/?${params}`);
  };
  const publicNames = () => page.locator(".ua-row-name").filter({ hasText: /^design-\d{2}$/ });
  const count = text => page.locator(".ua-catalog-controls [role=status]").filter({ hasText: new RegExp(`^${text}$`) }).waitFor();
  const fits = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(await page.locator(".ua-content, .ua-detail, .ua-catalog-controls").evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className)), []);
  };
  for (const width of [1440, 390, 320]) {
    console.log(`Checking paging at ${width}px`);
    await page.setViewportSize({ width, height: 844 });
    await go(); await count("30 of 65"); await fits();
    await page.getByRole("button", { name: "Load more", exact: true }).dblclick(); await count("60 of 65");
    assert.equal(await publicNames().count(), 60);
    assert.equal(await page.getByRole("dialog").count(), 0, "The second click must not open a newly appended row");
    console.log(`First append at ${width}px:`, await page.locator(".ua-catalog-more").innerText());
    await page.waitForTimeout(550); // Begin a new click gesture after the double-click test.
    await page.getByRole("button", { name: "Load more", exact: true }).click(); await count("65 of 65");
    assert.equal(await page.getByRole("button", { name: "Load more", exact: true }).count(), 0);
    await page.getByRole("combobox", { name: "Sort skills" }).selectOption("name"); await count("30 of 65");
    assert.equal(await publicNames().first().innerText(), "design-65");
    assert.equal(new URL(page.url()).searchParams.get("sort"), "name");
    await page.getByRole("button", { name: "Open design-65 details", exact: true }).click();
    await page.getByRole("dialog").getByRole("heading", { name: "design-65", exact: true }).waitFor(); await fits();
    await page.screenshot({ path: join(output, `${width}-detail.png`) });
    await page.getByRole("dialog").getByRole("button", { name: "Close skill details", exact: true }).click();
    await count("30 of 65");
    await page.screenshot({ path: join(output, `${width}-search.png`) });
    const input = page.locator(width < 760 ? ".ua-mobile-header input[type=search]" : ".ua-sidebar input[type=search]");
    await input.fill("no-results"); await count("0 of 0"); await page.getByRole("heading", { name: "Nothing matches", exact: true }).first().waitFor();
    await input.fill("first"); await input.fill("second"); await count("30 of 65");
    await page.getByText('Results for "second"', { exact: true }).waitFor();
    checks.push({ width, paging: true, sort: true, detail: true, empty: true, rapidQueries: true });
  }
  await page.setViewportSize({ width: 1440, height: 844 });
  for (const failure of ["append", "snapshot", "metadata"]) {
    await go(`q=design&pageFailure=${failure}`); await count("30 of 65");
    await page.getByRole("button", { name: "Load more", exact: true }).click();
    if (failure === "append") {
      await page.getByRole("button", { name: "Retry", exact: true }).click(); await count("60 of 65");
    } else if (failure === "snapshot") {
      await page.getByRole("button", { name: "Refresh results", exact: true }).click(); await count("30 of 65");
    } else {
      await count("60 of 65");
      await page.waitForTimeout(1800); await count("60 of 65");
    }
    checks.push({ failure, passed: true });
  }
  await go("view=creator&id=anthropics"); await count("30 of 65");
  await page.getByRole("button", { name: "Load more", exact: true }).click(); await count("60 of 65");
  await go("view=top"); await count("30 of 65");
  assert.equal(await page.getByRole("combobox", { name: "Sort skills" }).count(), 0);
  await page.getByRole("button", { name: "Load more", exact: true }).click(); await count("60 of 65");
  assert.equal(await page.locator(".ua-rank").last().innerText(), "60");
  checks.push({ creatorAndTrending: true });
  await go("q=design"); await count("30 of 65");
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Dark appearance", exact: true }).click();
  assert.equal(await page.locator(".ua-root").getAttribute("data-theme"), "dark");
  await fits(); await page.screenshot({ path: join(output, "1440-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await fits();
  await page.screenshot({ path: join(output, "390-dark.png") });
  await go("q=design&signedOut=1"); await count("30 of 65");
  await page.getByRole("button", { name: "Load more", exact: true }).click(); await count("60 of 65");
  checks.push({ dark: true, signedOut: true });
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
  await writeFile(join(output, "receipt.json"), JSON.stringify({ origin, checks, errors, forbidden,
    boundary: "Local synthetic public catalog only; no account backend, production requests or deployment." }, null, 2));
  console.log(JSON.stringify({ output, checks }, null, 2));
} finally { await browser.close(); }
