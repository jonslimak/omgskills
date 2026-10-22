import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { makeFixtures } from "../src/preview/fixtures";
import { skillDisplays, type SkillDisplay } from "../src/app/unified/model";
import { emptyMembershipResult, type MembershipCommand } from "../src/integration/membership-data";
import type { MembershipResult } from "../src/app/model";
import type { UnifiedManagement } from "../src/app/unified/management";

// Exercise the real action handler without loading browser-only styles in Node.
register(`data:text/javascript,${encodeURIComponent('export async function load(url, context, next) { return url.endsWith("/app/unified/unified.css") ? { format: "module", source: "export default {}", shortCircuit: true } : next(url, context); }')}`, import.meta.url);
const { useManagement } = await import("../src/integration/unified/useManagement");

const catalogSkill: SkillDisplay = { key: "catalog:owner/repo:skill", catalogId: "owner/repo:skill", name: "Skill", description: "", author: "owner", githubUrl: null, tags: [] };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function harness(options: { busy?: boolean; blocked?: boolean; catalogFavorite?: boolean; save?: (command: MembershipCommand) => Promise<MembershipResult> } = {}) {
  const data = makeFixtures();
  if (options.catalogFavorite) data.sets[0].items.push({ id: "saved-catalog", kind: "catalog", syncedSkillId: null,
    catalogSkillId: catalogSkill.catalogId, name: catalogSkill.name, description: "", githubUrl: null });
  const mine = skillDisplays(data, { skills: [], creators: [], collections: [], categories: [], trendingIds: [] }).mine;
  const calls: MembershipCommand[] = [];
  let management!: UnifiedManagement;
  function Harness() {
    management = useManagement({ data, mine, busy: !!options.busy, blocked: !!options.blocked,
      scope: "test", base: "/app/", local: true,
      saveSet: async () => { throw new Error("Unexpected set mutation"); },
      saveMembership: command => { calls.push(command); return options.save?.(command) ?? Promise.resolve(emptyMembershipResult()); },
      detail: { set: null, state: "ready", error: "", retry: () => {} } });
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return { management, calls, mine };
}

test("liking a catalog skill saves immediately through the existing membership command", async () => {
  const h = harness();
  h.management.favorite(catalogSkill);
  assert.deepEqual(h.calls, [{ kind: "catalog", catalogId: catalogSkill.catalogId, favorite: true }]);
  assert.equal(h.management.dialog("light"), null);
  await settle();
});

test("liking an installed skill uses its existing installed identity", async () => {
  const h = harness();
  const skill = h.mine.find(skill => skill.name === "copywriting")!;
  h.management.favorite(skill);
  assert.deepEqual(h.calls, [{ kind: "favorites", skills: [skill.installed], add: true }]);
  await settle();
});

test("unliking an installed skill saves immediately without uninstalling it", async () => {
  const h = harness();
  const skill = h.mine.find(skill => skill.name === "brand-voice")!;
  h.management.favorite(skill);
  assert.deepEqual(h.calls, [{ kind: "remove-favorite", catalogId: skill.catalogId, skillId: skill.installed!.id }]);
  assert.equal(h.management.dialog("light"), null);
  await settle();
});

test("unliking a catalog skill saves immediately using its exact identity", async () => {
  const h = harness({ catalogFavorite: true });
  h.management.favorite(catalogSkill);
  assert.deepEqual(h.calls, [{ kind: "remove-favorite", catalogId: catalogSkill.catalogId, skillId: undefined }]);
  assert.equal(h.management.dialog("light"), null);
  await settle();
});

test("liking and unliking protect blocked accounts, busy saves, and rapid duplicate taps", async () => {
  for (const catalogFavorite of [false, true]) {
    for (const options of [{ busy: true }, { blocked: true }]) {
      const h = harness({ ...options, catalogFavorite });
      h.management.favorite(catalogSkill);
      assert.equal(h.calls.length, 0);
    }
    let release!: (result: MembershipResult) => void;
    const h = harness({ catalogFavorite, save: () => new Promise(resolve => { release = resolve; }) });
    h.management.favorite(catalogSkill);
    h.management.favorite(catalogSkill);
    assert.equal(h.calls.length, 1);
    release(emptyMembershipResult());
    await settle();
    h.management.favorite(catalogSkill);
    assert.equal(h.calls.length, 2);
    release(emptyMembershipResult());
    await settle();
  }
});

test("failed and uncertain heart actions release the pending lock without unhandled errors", async () => {
  for (const save of [
    async () => { throw new Error("Offline"); },
    async () => ({ ...emptyMembershipResult(), uncertain: true }),
    async () => ({ ...emptyMembershipResult(), failed: [{ id: "skill", name: "Skill", message: "Rejected" }] }),
  ]) {
    for (const catalogFavorite of [false, true]) {
      const h = harness({ save, catalogFavorite });
      h.management.favorite(catalogSkill);
      assert.equal(h.calls.length, 1);
      await settle();
      h.management.favorite(catalogSkill);
      assert.equal(h.calls.length, 2);
      await settle();
    }
  }
});

test("save feedback is available inside an open detail sheet instead of behind it", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('management?.notice && !detail && <p className="ua-muted" role="status">'));
  const actions = source.indexOf('<div className="ua-detail-actions">');
  const description = source.indexOf('<div className="ua-description">', actions);
  assert.match(source.slice(actions, description), /management\?\.notice && <p className="ua-muted" role="status">\{management.notice\}/);
});

test("sample favorites stay opt-in and cannot write through a backend", () => {
  const source = readFileSync(new URL("../testing/unified-acceptance-review.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('if (!favoritesReview) return rejectWrite();'));
  assert.ok(source.includes('!import.meta.env.DEV'));
  assert.ok(source.includes('["127.0.0.1", "localhost"].includes(location.hostname)'));
  const save = source.slice(source.indexOf('async function saveReviewFavorite'), source.indexOf('const management = useManagement'));
  assert.doesNotMatch(save, /\bfetch\s*\(|\bapi\s*\(|localStorage|sessionStorage/);
  assert.ok(save.includes('setReviewData(current =>'));
});
