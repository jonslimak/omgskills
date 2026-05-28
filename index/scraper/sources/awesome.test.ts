import test from "node:test";
import assert from "node:assert/strict";
import { searchAwesomeAgentSkills } from "./awesome.js";

test("plain awesome repo link emits unresolved path", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("raw.githubusercontent.com/VoltAgent/awesome-agent-skills")) {
      return new Response(
        "- **[Lum1104/Understand-Anything](https://github.com/Lum1104/Understand-Anything)**\n",
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const hits = await searchAwesomeAgentSkills();
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.path, "__RESOLVE__");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("awesome explicit officialskills path keeps concrete path", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("raw.githubusercontent.com/VoltAgent/awesome-agent-skills")) {
      return new Response(
        "- **[owner/repo](https://officialskills.sh/anything)**\n",
        { status: 200 },
      );
    }
    if (url.includes("officialskills.sh/anything")) {
      return new Response(
        'https://github.com/owner/repo/tree/main/skills/my-skill',
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const hits = await searchAwesomeAgentSkills();
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.path, "skills/my-skill/SKILL.md");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("awesome explicit github tree path keeps concrete path", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("raw.githubusercontent.com/VoltAgent/awesome-agent-skills")) {
      return new Response(
        "- **[owner/repo](https://github.com/owner/repo/tree/main/skills/my-skill)**\n",
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const hits = await searchAwesomeAgentSkills();
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.path, "skills/my-skill/SKILL.md");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
