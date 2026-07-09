import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "./types.js";
import { buildReadmeSnippetFromSkillContent, enrichCandidate, seedRepoCache } from "./enrich.js";

function mockFetchOnce(handler: (url: string) => { ok: boolean; status: number; text: string }) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const response = handler(url);
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.text,
    } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("cached enrich reuse preserves resolved skill_md_path and install_cmd", async () => {
  const restoreFetch = mockFetchOnce((url) => {
    if (url.includes("raw.githubusercontent.com/facebook/react/main/extract-errors/SKILL.md")) {
      return {
        ok: false,
        status: 404,
        text: "",
      };
    }
    if (url.includes("raw.githubusercontent.com/facebook/react/main/.claude/skills/extract-errors/SKILL.md")) {
      return {
        ok: true,
        status: 200,
        text: "---\nname: extract-errors\ndescription: desc\n---\nbody",
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  try {
    seedRepoCache("facebook/react", {
      stars: 123,
      lastUpdated: "2026-06-02T00:00:00Z",
      tags: [],
      githubUrl: "https://github.com/facebook/react",
    });

    const existing: Skill = {
      id: "facebook/react:.claude/skills/extract-errors",
      name: "extract-errors",
      description: "desc",
      github_url: "https://github.com/facebook/react",
      install_cmd: "old-install",
      author_handle: "facebook",
      tags: [],
      stars: 100,
      last_updated: "2026-05-01T00:00:00Z",
      first_seen: "2026-05-01",
      skill_md_sha: "08bb1830eb491801910d6b65aeb575ac612d4d3c",
    };

    const result = await enrichCandidate(
      {
        id: existing.id,
        skill_md_path: "__RESOLVE__",
        skill_name_hint: existing.name,
      },
      new Map([[existing.id, existing.first_seen]]),
      new Map([[existing.id, existing]]),
      "2026-06-02",
    );

    assert.ok(result.skill);
    assert.equal(result.skill?.skill_md_path, ".claude/skills/extract-errors/SKILL.md");
    assert.equal(
      result.skill?.install_cmd,
      "git clone https://github.com/facebook/react /tmp/react && ln -s /tmp/react/.claude/skills/extract-errors ~/.claude/skills/extract-errors",
    );
  } finally {
    restoreFetch();
  }
});

test("refresh preserves existing optional source and tweet metadata", async () => {
  const restoreFetch = mockFetchOnce((url) => {
    if (url.includes("raw.githubusercontent.com/facebook/react/main/.claude/skills/extract-errors/SKILL.md")) {
      return {
        ok: true,
        status: 200,
        text: "---\nname: extract-errors\ndescription: desc\n---\nbody",
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  try {
    const existing: Skill = {
      id: "facebook/react:.claude/skills/extract-errors",
      name: "extract-errors",
      description: "old desc",
      github_url: "https://github.com/facebook/react",
      install_cmd: "old-install",
      author_handle: "facebook",
      tags: ["existing"],
      stars: 100,
      last_updated: "2026-05-01T00:00:00Z",
      first_seen: "2026-05-01",
      skill_md_sha: "old-sha",
      source_tag: "registry",
      source_url: "https://example.com/source",
      tweet_url: "https://x.com/example/status/1",
      tweet_likes: 10,
      tweet_retweets: 2,
      tweet_replies: 1,
      tweet_views: 100,
      tweet_author_handle: "example",
      tweet_author_name: "Example",
      tweet_posted_at: "2026-05-01T00:00:00Z",
      tweet_text: "tweet text",
    };

    const result = await enrichCandidate(
      {
        id: existing.id,
        skill_md_path: ".claude/skills/extract-errors/SKILL.md",
      },
      new Map([[existing.id, existing.first_seen]]),
      new Map([[existing.id, existing]]),
      "2026-06-02",
      {
        stars: 123,
        lastUpdated: "2026-06-02T00:00:00Z",
        tags: ["fresh"],
        githubUrl: "https://github.com/facebook/react",
      },
    );

    assert.ok(result.skill);
    assert.equal(result.skill?.source_tag, "registry");
    assert.equal(result.skill?.source_url, "https://example.com/source");
    assert.equal(result.skill?.tweet_url, "https://x.com/example/status/1");
    assert.equal(result.skill?.tweet_likes, 10);
    assert.equal(result.skill?.tweet_retweets, 2);
    assert.equal(result.skill?.tweet_replies, 1);
    assert.equal(result.skill?.tweet_views, 100);
    assert.equal(result.skill?.tweet_author_handle, "example");
    assert.equal(result.skill?.tweet_author_name, "Example");
    assert.equal(result.skill?.tweet_posted_at, "2026-05-01T00:00:00Z");
    assert.equal(result.skill?.tweet_text, "tweet text");
  } finally {
    restoreFetch();
  }
});

test("readme snippet starts at first heading after frontmatter and cleans markdown", () => {
  const snippet = buildReadmeSnippetFromSkillContent(
    `---
name: browser-helper
description: Short description for search.
---
This opening prose repeats the frontmatter description and should not appear.

# Browser Helper

![build badge](https://example.com/badge.svg)

\`\`\`bash
npm install browser-helper
\`\`\`

Install: git clone https://github.com/acme/browser-helper ~/.claude/skills/browser-helper

<p>This skill helps agents inspect browser pages, capture structured page state, and summarize interactive UI behavior for debugging. It focuses on practical browser investigation workflows, clear evidence capture, and repeatable checks that are useful when validating web applications.</p>
`,
    "Short description for search.",
  );

  assert.equal(
    snippet,
    "Browser Helper This skill helps agents inspect browser pages, capture structured page state, and summarize interactive UI behavior for debugging. It focuses on practical browser investigation workflows, clear evidence capture, and repeatable checks that are useful when validating web applications.",
  );
});

test("readme snippet ignores hash characters before the first markdown heading", () => {
  const snippet = buildReadmeSnippetFromSkillContent(
    `---
name: hash-test
description: A # symbol in frontmatter should not count.
---
This line mentions issue #123 before any heading and should be skipped.

## Real Section

Use this section as the snippet because it is the first real content heading.
`,
    "A # symbol in frontmatter should not count.",
  );

  assert.equal(snippet, "Real Section Use this section as the snippet because it is the first real content heading.");
});

test("readme snippet truncates near 1000 characters", () => {
  const repeatedDetail = Array.from(
    { length: 18 },
    (_, index) =>
      `Detail sentence ${index + 1} explains how the skill collects evidence, compares repository state, and writes a concise implementation report for maintainers.`,
  ).join(" ");
  const snippet = buildReadmeSnippetFromSkillContent(
    `---
name: long-skill
description: Small summary.
---
# Long Skill

${repeatedDetail} After limit marker should not appear because the snippet should stop cleanly near the maximum size expected by the web library generator and search previews.
`,
    "Small summary.",
  );

  assert.ok(snippet);
  assert.ok(snippet!.endsWith("."));
  assert.ok(snippet!.length <= 1000);
  assert.equal(snippet!.includes("After limit marker"), false);
});

test("readme snippet falls back to body when no heading exists", () => {
  const description = "Use when debugging browser automation failures and collecting clear evidence.";
  assert.equal(
    buildReadmeSnippetFromSkillContent(
      `---
name: no-heading
description: ${description}
---
${description}
`,
      description,
    ),
    description,
  );
});

test("readme snippet omits empty source but keeps short useful source", () => {
  assert.equal(
    buildReadmeSnippetFromSkillContent(
      `---
name: tiny
description: tiny
---
# Tiny
Short useful source.
`,
      "tiny",
    ),
    "Tiny Short useful source.",
  );

  assert.equal(
    buildReadmeSnippetFromSkillContent(
      `---
name: tiny
description: tiny
---
![badge](https://example.com/badge.svg)
`,
      "tiny",
    ),
    undefined,
  );
});

test("fresh enrich emits readme_snippet from fetched SKILL.md content", async () => {
  const restoreFetch = mockFetchOnce((url) => {
    if (url.includes("raw.githubusercontent.com/acme/browser-tools/main/SKILL.md")) {
      return {
        ok: true,
        status: 200,
        text: `---
name: browser-tools
description: Browser testing helper.
tags:
  - browser
---
# Browser Tools

This skill gives agents a practical workflow for inspecting web pages, collecting visible state, checking interactive behavior, and producing concise bug reports. It emphasizes repeatable validation steps, clear screenshots, and evidence that another engineer can use without rerunning the full investigation.
`,
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  try {
    const result = await enrichCandidate(
      {
        id: "acme/browser-tools",
        skill_md_path: "SKILL.md",
      },
      new Map(),
      new Map(),
      "2026-07-09",
      {
        stars: 123,
        lastUpdated: "2026-07-09T00:00:00Z",
        tags: [],
        githubUrl: "https://github.com/acme/browser-tools",
      },
    );

    assert.ok(result.skill);
    assert.ok(result.skill?.readme_snippet);
    assert.match(result.skill!.readme_snippet!, /practical workflow/);
  } finally {
    restoreFetch();
  }
});
