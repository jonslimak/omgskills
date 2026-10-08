import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const origin = process.env.PORTAL_REVIEW_ORIGIN || "http://127.0.0.1:5191";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
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
  page.setDefaultTimeout(6000);
  page.on("response", response => { if (response.status() >= 400) console.error(response.status(), response.url()); });
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  const output = new URL("../../output/playwright/account-dialogs/", import.meta.url);
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + "/app/testing/unified-acceptance/?view=profile&accountDialogs=1&catalog=0");
    await page.getByRole("button", { name: "Edit profile", exact: true }).click().catch(async error => {
      console.error(await page.locator("body").innerText(), forbidden); throw error;
    });
    const profile = page.getByRole("dialog", { name: "Edit profile", exact: true });
    await profile.getByRole("textbox", { name: "Handle" }).fill("updated-reviewer");
    await profile.getByRole("button", { name: "Confirm", exact: true }).click();
    await profile.getByRole("alert").waitFor();
    assert.equal(await profile.getByRole("button", { name: "Cancel", exact: true }).isEnabled(), true);
    assert.equal(await profile.getByRole("button", { name: "Confirm", exact: true }).isDisabled(), true);
    assert.equal(await profile.getByText("Saving...", { exact: true }).count(), 0);
    await profile.getByRole("button", { name: "Cancel", exact: true }).click();
    await profile.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Edit profile", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Refresh sample account" }).click();
    await page.getByRole("button", { name: "Edit profile", exact: true }).click();
    await profile.getByRole("textbox", { name: "Handle" }).fill("updated-reviewer");
    await profile.getByRole("button", { name: "Confirm", exact: true }).click();
    await profile.waitFor({ state: "hidden" });
    await page.getByText("@updated-reviewer", { exact: true }).waitFor();

    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await page.getByRole("button", { name: "Account menu", exact: true }).filter({ visible: true }).click();
        await page.getByRole("menuitem", { name: "Dark appearance", exact: true }).click();
      }
      for (const title of ["Connect app", "Revoke Sample Mac?"]) {
        await page.getByRole("button", { name: title === "Connect app" ? "Connect app" : "Revoke Sample Mac", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: title, exact: true });
        await dialog.waitFor();
        const colors = await dialog.evaluate(node => ({ bg: getComputedStyle(node).backgroundColor,
          ink: getComputedStyle(node).color, scheme: getComputedStyle(node).colorScheme }));
        assert.equal(colors.bg, theme === "dark" ? "rgb(16, 16, 18)" : "rgb(255, 255, 255)");
        assert.equal(colors.ink, theme === "dark" ? "rgb(245, 245, 247)" : "rgb(17, 17, 19)");
        assert.equal(colors.scheme, theme);
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900);
        await page.screenshot({ path: new URL(`${width}-${theme}-${title === "Connect app" ? "connect" : "revoke"}.png`, output).pathname });
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      }
    }
  }
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  console.log("PASS: profile error recovery and connection/revoke dialogs in both themes at 390/1440px; no API or external requests.");
} finally {
  await browser.close();
}
