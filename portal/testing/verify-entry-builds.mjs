import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Finish with the default-off artifact; none of these placeholder-key builds is deployable.
for (const [redesign, web, mac] of [["1", "1", "1"], ["1", "1", "0"], ["1", "0", "0"], ["0", "1", "0"]]) {
  const build = spawnSync("npm", ["--workspace", "portal", "run", "build"], {
    cwd: root, encoding: "utf8", timeout: 120000,
    env: { ...process.env,
      // Non-secret placeholder keeps the authenticated branch in the build.
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
      VITE_PORTAL_REDESIGN_ENABLED: redesign, VITE_SKILLGROUPS_WEB_ENABLED: web, VITE_SKILLGROUPS_MAC_ENABLED: mac,
      VITE_PORTAL_INTEGRATION: "1", VITE_PORTAL_PREVIEW: "1" },
  });
  assert.equal(build.status, 0, build.stderr || build.stdout || String(build.error));
  const assets = path.join(root, "portal/dist/assets");
  const files = (await readdir(assets)).filter((file) => file.endsWith(".js"));
  const code = (await Promise.all(files.map((file) => readFile(path.join(assets, file), "utf8")))).join("\n");
  assert.equal(files.some((file) => file.startsWith("redesign-main-")), redesign === "1", "Redesign entry must be absent when disabled");
  assert.doesNotMatch(code, /D4 isolated browser fixtures|Local E fixture only|local-github-simulation|PORTAL_TEST_ENVIRONMENT_VERIFIED|Test environment required/);
  if (redesign === "1" && web === "1") assert.match(code, /Sign in to omgskills/);
  console.log(`Entry build passed: redesign=${redesign}, web=${web}, Mac=${mac}; local entries/fixtures excluded.`);
}
