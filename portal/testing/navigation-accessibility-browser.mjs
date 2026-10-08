import assert from "node:assert/strict";

const origin = process.env.PORTAL_REVIEW_ORIGIN || "http://127.0.0.1:5191";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  const forbidden = [], errors = [], failures = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      forbidden.push(url.origin + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on("pageerror", error => errors.push(error.message));
  const mainFocused = async () => page.locator("main").evaluate(node => node === document.activeElement);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(origin + "/app/testing/unified-acceptance/?view=discover&catalog=0");
    await page.getByRole("heading", { name: "Discover", exact: true }).waitFor();
    assert.equal(await mainFocused(), false, "Initial load must not move focus");
    await page.getByRole("button", { name: /^Collection Build your next thing/ }).press("Enter");
    await page.getByRole("heading", { name: "Build your next thing", exact: true }).waitFor();
    if (!await mainFocused()) failures.push(`${width}: collection navigation lost focus`);
    const rows = page.locator(".ua-row-main");
    for (const row of await rows.all()) {
      const name = (await row.getAttribute("aria-label")).slice("Open ".length);
      if (await page.getByRole("button", { name: `Open ${name} details`, exact: true }).count() === 0) {
        failures.push(`${width}: missing named Open action for ${name}`);
      }
    }
    const search = page.getByRole("searchbox").filter({ visible: true });
    await search.fill("frontend");
    await page.getByRole("heading", { name: "Search results", exact: true }).waitFor();
    assert.equal(await search.evaluate(node => node === document.activeElement), true, "Typing must retain search focus");
    await search.fill("");
    await page.getByRole("heading", { name: "Build your next thing", exact: true }).waitFor();
    await page.getByRole("button", { name: "Open frontend-design", exact: true }).press("Enter");
    const detail = page.getByRole("dialog");
    await detail.waitFor();
    assert.equal(await detail.evaluate(node => node.contains(document.activeElement)), true);
    await page.keyboard.press("Escape");
    await detail.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Open frontend-design", exact: true })
      .evaluate(node => node === document.activeElement), true, "Closing details must return to the skill");
    const openAction = page.getByRole("button", { name: "Open frontend-design details", exact: true });
    if (await openAction.count()) {
      await openAction.press("Enter");
      await detail.getByRole("heading", { name: "frontend-design", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await detail.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open frontend-design details");
      assert.equal(await openAction.evaluate(node => node === document.activeElement), true);
    }
    if (width < 760) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("button", { name: "Discover", exact: true }).filter({ visible: true }).last().press("Enter");
    await page.getByRole("heading", { name: "Discover", exact: true }).waitFor();
    if (!await mainFocused()) failures.push(`${width}: return navigation lost focus`);
    await page.goBack();
    await page.getByRole("heading", { name: "Build your next thing", exact: true }).waitFor();
    if (!await mainFocused()) failures.push(`${width}: browser Back lost focus`);
    await page.goForward();
    await page.getByRole("heading", { name: "Discover", exact: true }).waitFor();
    if (!await mainFocused()) failures.push(`${width}: browser Forward lost focus`);
    const accountMenu = page.getByRole("button", { name: "Account menu", exact: true }).filter({ visible: true });
    for (const destination of ["Profile", "Agents 2 observed"]) {
      if (width < 760) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      await accountMenu.press("Enter");
      await page.getByRole("menuitem", { name: destination, exact: true }).press("Enter");
      await page.getByRole("menu").waitFor({ state: "hidden" });
      await page.waitForFunction(() => !document.querySelector('[data-radix-popper-content-wrapper]'));
      if (!await mainFocused()) failures.push(`${width}: ${destination} returned focus to account menu`);
    }
    if (width < 760) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await accountMenu.press("Enter");
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "hidden" });
    assert.equal(await accountMenu.evaluate(node => node === document.activeElement), true, "Dismissing the menu must still return to its trigger");
  }
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log("PASS: 390/1440px navigation focus, named Open actions, search focus, detail focus return, Back/Forward; no API or external requests.");
} finally {
  await browser.close();
}
