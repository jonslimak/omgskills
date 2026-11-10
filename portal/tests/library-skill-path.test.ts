import assert from "node:assert/strict";
import test from "node:test";
import { catalogSkillPath, parsePublicNavigationPath } from "../src/app/unified/model";

// The build (scripts/takeover-pages.mjs) writes each skill page where the app expects it.
test("the build's library skill addresses match the app's", async () => {
  const { librarySkillPath } = await import("../../scripts/takeover-pages.mjs" as string) as { librarySkillPath: (id: string) => string | null };
  for (const id of ["anthropics/skills:skills/frontend-design", "abpframework/abp:.claude/skills/abp-angular",
    "n8n-io/n8n:n8n:create-community-node-lint-rule", "n8n-io/n8n:packages/@n8n/instance-ai/skills/agent-builder",
    "AgriciDaniel/claude-seo:extensions/ahrefs/skills/seo-ahrefs", "trending/repo:skill", "owner/repo:../x", "owner/repo:",
    "owner/repo", "owner/repo/extra:skill", "Library/repo:skill", "owner/repo:a b/ü",
    "CROW-B3/.claude:skills/x", "o/r:dot-claude/x", "o/r:dot-dot-x/y", "o/r:.dot-x/y", "o/r:.agents/skills/.hidden"]) {
    const app = catalogSkillPath(id);
    assert.equal(librarySkillPath(id), app ? `/${app}` : null, id);
  }
});

test("dot-safe library addresses open the original skill, and old dot addresses still parse", () => {
  for (const id of ["abpframework/abp:.claude/skills/abp-angular", "CROW-B3/.claude:skills/x", "o/r:dot-claude/x",
    "o/r:dot-dot-x/y", "o/r:.agents/skills/.hidden", "anthropics/skills:skills/frontend-design"]) {
    const path = catalogSkillPath(id)!;
    assert.doesNotMatch(path, /\/\./, id);
    assert.equal(parsePublicNavigationPath(path, "")?.selected, `catalog:${id}`, id);
  }
  assert.equal(catalogSkillPath("o/r:.dot-x/y"), null);
  assert.equal(parsePublicNavigationPath("library/o/r/dot-/", ""), null);
  assert.equal(parsePublicNavigationPath("library/o/r/x/dot-./", ""), null);
  assert.equal(parsePublicNavigationPath("library/abpframework/abp/.claude/skills/abp-angular/", "")?.selected,
    "catalog:abpframework/abp:.claude/skills/abp-angular");
});
