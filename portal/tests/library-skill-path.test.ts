import assert from "node:assert/strict";
import test from "node:test";
import { catalogSkillPath } from "../src/app/unified/model";

// The build (scripts/takeover-pages.mjs) writes each skill page where the app expects it.
test("the build's library skill addresses match the app's", async () => {
  const { librarySkillPath } = await import("../../scripts/takeover-pages.mjs" as string) as { librarySkillPath: (id: string) => string | null };
  for (const id of ["anthropics/skills:skills/frontend-design", "abpframework/abp:.claude/skills/abp-angular",
    "n8n-io/n8n:n8n:create-community-node-lint-rule", "n8n-io/n8n:packages/@n8n/instance-ai/skills/agent-builder",
    "AgriciDaniel/claude-seo:extensions/ahrefs/skills/seo-ahrefs", "trending/repo:skill", "owner/repo:../x", "owner/repo:",
    "owner/repo", "owner/repo/extra:skill", "Library/repo:skill", "owner/repo:a b/ü"]) {
    const app = catalogSkillPath(id);
    assert.equal(librarySkillPath(id), app ? `/${app}` : null, id);
  }
});
