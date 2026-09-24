import test from "node:test";
import assert from "node:assert/strict";
import { isLocalPreview } from "../src/app/preview-gate";
import { parseRoute } from "../src/app/routes";
import { filterSkills, isMember, sourceLabel } from "../src/app/model";
import { groupSyncedSkills } from "../src/synced-skill-grouping";
import { makeFixtures } from "../src/preview/fixtures";
import { changeMembership } from "../src/preview/state";

test("preview requires development, explicit opt-in, loopback, and the dedicated path", () => {
  const valid = {
    development: true,
    enabled: "1",
    hostname: "127.0.0.1",
    pathname: "/app/preview/",
  };
  assert.equal(isLocalPreview(valid), true);
  for (const change of [
    { development: false },
    { enabled: undefined },
    { enabled: "true" },
    { hostname: "omgskills.com" },
    { hostname: "127.0.0.1.example.com" },
    { pathname: "/app/" },
    { pathname: "/app/preview-spoof" },
    { pathname: "/app/connect" },
  ]) {
    assert.equal(isLocalPreview({ ...valid, ...change }), false);
  }
});

test("routes preserve groups, filters, and unknown paths without swallowing connect", () => {
  const base = "/app/preview/";
  assert.equal(parseRoute(base, "", base).page, "skills");
  assert.equal(parseRoute("/app/preview", "", base).page, "skills");
  assert.deepEqual(
    parseRoute(`${base}groups/marketing`, "?source=Claude", base),
    { page: "detail", groupId: "marketing", source: "Claude" },
  );
  assert.equal(parseRoute(`${base}groups/%E0%A4`, "", base).page, "missing");
  assert.equal(parseRoute("/app/connect", "", base).page, "missing");
  assert.equal(parseRoute(`${base}unknown`, "", base).page, "missing");
});

test("search includes non-representative text and filters retain every member ID", () => {
  const data = makeFixtures();
  data.skills[0].description = "A unique hidden-member phrase";
  const rows = groupSyncedSkills(data.skills);
  const matches = filterSkills(rows, "hidden-member", "Claude");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, "Codex");
  assert.equal(matches[0].allSkillIds.length, 2);
  assert.equal(filterSkills(rows, "not present", "all").length, 0);
});

test("membership matches non-representative physical IDs and removals preserve unrelated items", () => {
  const data = makeFixtures();
  const row = groupSyncedSkills(data.skills).find(
    (skill) => skill.name === "brand-voice",
  )!;
  const set = data.sets.find((set) => set.id === "marketing")!;
  assert.notEqual(set.items[0].syncedSkillId, row.id);
  assert.equal(isMember(set, row), true);
  assert.equal(
    changeMembership(set, [row], true).items.length,
    set.items.length,
  );
  const duplicated = {
    ...set,
    items: [
      ...set.items,
      { ...set.items[0], id: "another-member", syncedSkillId: row.id },
    ],
  };
  const removed = changeMembership(duplicated, [row], false);
  assert.equal(isMember(removed, row), false);
  assert.deepEqual(removed.items, set.items.slice(1));
});

test("membership cannot modify shared sets and supports mixed source kinds", () => {
  const data = makeFixtures();
  const rows = groupSyncedSkills(data.skills);
  const shared = data.sets.find((set) => set.role === "invited")!;
  assert.equal(changeMembership(shared, rows, true), shared);
  const personal = data.sets.find((set) => set.id === "personal")!;
  const added = changeMembership(personal, [rows[0]], true);
  assert.equal(added.items.length, 2);
  assert.deepEqual(
    changeMembership(added, [rows[0]], false).items,
    personal.items,
  );
});

test("fixtures reset deterministically and unknown source URLs are not trusted", () => {
  const data = makeFixtures();
  data.sets[0].name = "changed";
  assert.equal(makeFixtures().sets[0].name, "Favorites");
  assert.deepEqual(makeFixtures("empty").skills, []);
  assert.equal(
    sourceLabel("https://github.com/anthropics/skills/tree/main"),
    "anthropics/skills",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://github.com.evil.test/owner/repo",
    "not a URL",
    null,
  ])
    assert.equal(sourceLabel(url), null);
});
