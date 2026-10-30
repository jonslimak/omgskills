import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("homepage marketing stays intact with adjacent Coming soon labels", () => {
  const home = read("site/index.html");
  for (const copy of [
    '<h1 id="hero-title">share skills<br>with your team</h1>',
    "Put your team's agent skills in one place. Share a set once, and everyone's Claude Code and Codex stay in sync.",
    'From your library to your team\'s agents. No zip files, no Slack threads, no "which version do you have?"',
    "Add teammates by email, or share one link. Everyone gets the same skills, at the same version.",
    "Install the set in Claude Code or Codex. When the set changes, everyone stays up to date.",
    "Public, invite only, or only me. Share one link, and when you update a set, your team gets the change.",
    '<h2 id="closing-title">Your team\'s skills, every agent</h2>',
  ]) assert.ok(home.includes(copy), copy);
  const labels = [...home.matchAll(/<small class="coming-soon" data-planned-feature="([^"]+)">([^<]+)<\/small>/g)];
  assert.deepEqual(labels.map(m => m[1]), ["team-sync", "set-updates", "set-subscription"]);
  for (const label of labels) assert.match(label[2], /Coming soon/);
});

test("guide, structured answers and generated Markdown describe the same available flow", () => {
  const html = read("site/guide/index.html");
  const generator = read("scripts/build-web-library.mjs");
  const structured = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map(m => JSON.parse(m[1]));
  const faq = structured.find(item => item["@type"] === "FAQPage");
  const answer = name => faq.mainEntity.find(item => item.name === name).acceptedAnswer.text;
  assert.match(answer("What is the easiest way to share skills with a team?"), /Install a whole Set from the Mac companion\. Automatic team updates are coming soon/);
  assert.match(answer("Are skills safe?"), /not a security audit/);
  assert.equal(structured.find(item => item["@type"] === "TechArticle").dateModified, "2026-10-28");
  for (const text of [html, generator]) {
    assert.match(text, /Sync reports installed skills; it does not update their files\./);
    assert.match(text, /Automatic team updates: Coming soon\./);
    assert.match(text, /Original Mac app/);
  }
});

test("help and privacy distinguish reporting, local installs and account deletion", () => {
  assert.match(read("site/about/index.html"), /Sync reports what is installed; it does not automatically update skill files/);
  const support = read("site/support/index.html");
  assert.match(support, /Resync/);
  assert.match(support, /same account/);
  assert.match(support, /Apple silicon Mac with macOS 14/);
  const privacy = read("site/privacy/index.html");
  for (const copy of ["Clerk", "SKILL.md fingerprint", "Inventory reports do not upload full local paths or full skill files", "Sets and invitations", "account-deletion request", "hi@omgskills.com"]) {
    assert.ok(privacy.includes(copy), copy);
  }
  assert.match(read("site/terms/index.html"), /Set installation is available in the companion; automatic skill updates are coming soon/);
});
