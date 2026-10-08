import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reuse a running Vite frontend. This script never starts an API or database.
const origin = process.env.PORTAL_REVIEW_ORIGIN || "http://127.0.0.1:5191";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Review must use localhost");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = fileURLToPath(new URL("../../output/playwright/unified-acceptance/", import.meta.url));
const base = "/app/testing/unified-acceptance/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  const forbidden = [], errors = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      forbidden.push(url.origin + url.pathname); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(6000);
  await mkdir(output, { recursive: true });
  const go = async (query = "") => {
    const params = new URLSearchParams(query);
    params.set("catalog", "0");
    await page.goto(origin + base + `?${params}`);
    await page.locator("h1").waitFor();
  };
  const fits = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow: ${page.url()}`);
    assert.deepEqual(await page.locator(".ua-main, .ua-content, .ua-detail, .ua-modal").evaluateAll(nodes => nodes
      .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className)), [], "Content overflow");
  };
  const focused = async label => {
    await page.waitForFunction(label => document.activeElement?.getAttribute("aria-label") === label, label);
  };
  await page.goto(origin + base + "?authDelay=5000&catalog=0");
  await page.getByRole("status", { name: "Loading omgskills" }).waitFor();
  await page.locator("h1").waitFor();
  assert.equal(await page.locator(".portal-loading").count(), 0);
  for (const query of ["?view=favorites", "?view=favorites&setCatalog=1"]) {
    await go(query);
    await page.locator(".ua-row-name").first().waitFor();
    assert.equal(await page.locator('.ua-agent-tile[data-present="false"]').count(), 0,
      "Favorites must not render empty agent squares");
  }
  for (const width of [320, 390, 759, 760]) {
    await page.setViewportSize({ width, height: 844 });
    for (const signedOut of [false, true]) {
      await go(`?view=discover${signedOut ? "&signedOut=1" : ""}`);
      const header = page.locator(".ua-mobile-header");
      assert.equal(await header.isVisible(), width < 760);
      if (width >= 760) continue;
      const logo = await header.locator(".ua-mobile-logo").boundingBox();
      const search = await header.locator(".ua-search-mobile").boundingBox();
      const account = await header.getByRole("button", { name: signedOut ? "Sign in" : "Open navigation", exact: true }).boundingBox();
      assert.ok(logo && search && account);
      assert.ok(logo.x + logo.width <= search.x && search.x + search.width <= account.x);
      const centers = [logo, search, account].map(box => box.y + box.height / 2);
      assert.ok(Math.max(...centers) - Math.min(...centers) < 1, "Mobile header controls must share one row");
      await fits();
      assert.equal(await page.locator(".ua-mobile-tabs").count(), 0);
      if (signedOut) {
        assert.equal(await header.getByRole("button", { name: "Open navigation", exact: true }).count(), 0);
      } else {
        await header.getByRole("button", { name: "Open navigation", exact: true }).click();
        const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
        assert.equal(await drawer.locator(".ua-drawer-logo").count(), 0);
        assert.equal(await header.getByRole("button", { name: "Account menu", exact: true }).count(), 0);
        await drawer.getByRole("button", { name: "Account menu", exact: true }).click();
        await page.getByRole("menuitem", { name: "Profile", exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await focused("Account menu");
        assert.deepEqual(await drawer.getByRole("navigation").getByRole("button").allTextContents(),
          ["My Skills", "Favorites", "Sets", "Discover", "Trending", "Creators", "Collections"]);
        await page.keyboard.press("Escape");
        await drawer.waitFor({ state: "hidden" });
        await focused("Open navigation");
      }
      await page.screenshot({ path: path.join(output, `${width}-header-${signedOut ? "public" : "account"}.png`) });
      await header.getByRole("searchbox").fill("frontend");
      await page.waitForURL(url => url.searchParams.get("q") === "frontend");
    }
  }
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await go();
    if (width < 760) {
      assert.equal(await page.locator(".ua-row-name").first().evaluate(node => getComputedStyle(node).fontSize), "14px");
      assert.equal(await page.locator(".ua-agent-count").first().innerText(), "2");
    }
    await page.getByRole("button", { name: "Open frontend-design", exact: true }).click();
    const detail = page.getByRole("dialog");
    await detail.getByRole("heading", { name: "frontend-design", exact: true }).waitFor();
    if (width < 760) {
      const close = await detail.locator(".ua-detail-top .ua-icon").boundingBox();
      assert.ok(close && close.width === 44 && close.height === 44);
    }
    await fits();
    await page.screenshot({ path: path.join(output, `${width}-detail.png`) });
    const box = await detail.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 845);
    if (width >= 1180) {
      assert.equal(box.y, 0, "Desktop detail must start at the top of the viewport");
    } else if (width >= 760) {
      assert.equal(box.y, 44, "Tablet detail must retain its top inset");
    } else {
      assert.ok(Math.abs(box.y + box.height - 844) < 1, "Mobile detail must stay bottom-aligned");
    }
    if (width < 1180) {
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press("Tab");
        assert.equal(await detail.evaluate(node => node.contains(document.activeElement)), true, "Sheet focus escaped");
      }
    }
    await detail.getByRole("button", { name: "Add to set", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Add to set", exact: true });
    await modal.waitFor();
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "hidden" });
    await focused("Add to set");
    await detail.getByRole("button", { name: /^design-system Build/ }).click();
    await detail.getByRole("heading", { name: "design-system", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await detail.waitFor({ state: "hidden" });
    await focused("Open frontend-design");
    await page.goBack();
    await page.getByRole("dialog").waitFor();
    await page.goForward();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.screenshot({ path: path.join(output, `${width}-library.png`) });

    await go("?view=set&id=marketing&scenario=long-content");
    await fits();
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await page.getByRole("dialog", { name: "Invite to set" }).waitFor();
    await fits();
    await page.screenshot({ path: path.join(output, `${width}-invite.png`) });
    await page.keyboard.press("Escape");
    await go("?view=discover");
    await fits();
    await page.getByRole("button", { name: "Account menu", exact: true }).filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: "Dark appearance", exact: true }).click();
    await page.screenshot({ path: path.join(output, `${width}-discover-dark.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ["top", "creators", "collections"]) {
    await go(`?view=${view}&signedOut=1`);
    await page.getByRole("button", { name: "Discover", exact: true }).filter({ visible: true }).click();
    await page.getByRole("heading", { name: "Discover", exact: true }).waitFor();
  }
  await go("?view=discover&signedOut=1&q=design");
  await page.getByRole("button", { name: "Discover", exact: true }).filter({ visible: true }).click();
  await page.getByRole("heading", { name: "Discover", exact: true }).waitFor();
  await go("?view=collection&id=build");
  await page.getByRole("button", { name: "Open frontend-design", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^design-system Build/ }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "design-system", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await focused("Open frontend-design");
  await go();
  await page.getByRole("button", { name: "Open frontend-design", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^pdf Read/ }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "pdf", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("view"), "discover");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.tagName === "MAIN");
  await go("?view=discover&skill=catalog%3Aanthropics%2Fskills%3Afrontend-design");
  await page.getByRole("dialog").waitFor();
  await page.reload();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.tagName === "MAIN");
  assert.equal(await page.locator("main").evaluate(node => node === document.activeElement), true, "Direct-link close needs a focus fallback");
  await page.setViewportSize({ width: 1440, height: 844 });
  await go();
  await page.getByRole("button", { name: "Open frontend-design", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("dialog").waitFor();
  await page.locator(".ua-detail-overlay").waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("dialog").evaluate(node => node.contains(document.activeElement)), true,
    `Resize focus: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200))}`);
  await page.keyboard.press("Escape");
  await focused("Open frontend-design");
  for (const scenario of ["empty", "loading", "error", "long-content"]) {
    await go(`?scenario=${scenario}`);
    await fits();
    await page.screenshot({ path: path.join(output, `390-${scenario}.png`) });
    if (scenario === "error") {
      await page.getByRole("button", { name: /Try again/ }).click();
      await page.getByRole("button", { name: "Open frontend-design", exact: true }).waitFor();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  console.log("PASS: 4 widths; detail/nested dialog/related focus; Back/Forward; invites; dark mode; signed-out navigation; direct-link reload; empty/loading/error/long content. No API or external requests.");
} finally { await browser.close(); }
