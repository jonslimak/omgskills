import assert from "node:assert/strict";
import test from "node:test";
import { relatedSkillsPicker } from "./related-skills.mjs";

const skill = (id, name, description, stars = 10) => ({ id, name, description, author_handle: id.split("/")[0], stars });
// Filler so the shared words are rare, as they are in the real catalog.
const filler = Array.from({ length: 200 }, (_, index) => skill(`filler${index}/repo:s${index}`, `thing-${index}`, `Unrelated words number ${index} alpha${index} beta${index}`));

test("related skills share rare wording with other creators; one shared common word is not enough", () => {
  const base = skill("a/repo:figma-to-react", "figma-to-react", "Turn Figma frames into React components with tokens and variants");
  const near = skill("b/repo:figma-export", "figma-export", "Export Figma frames as React components and design tokens", 500);
  const own = skill("a/repo:figma-icons", "figma-icons", "Export Figma frames as React icon components with tokens");
  const loose = skill("c/repo:react-store", "react-store", "A store for React state");
  const related = relatedSkillsPicker([base, near, own, loose, ...filler]);
  assert.deepEqual(related(base).map(item => item.id), ["b/repo:figma-export"]);
  // The creator's own skills and ones already shown elsewhere are left out.
  assert.deepEqual(related(base, { exclude: new Set(["b/repo:figma-export"]) }), []);
});

test("at most five, two per creator, one copy of each name, nothing for a skill without a page", () => {
  const base = skill("a/repo:playwright-tests", "playwright-tests", "Write Playwright browser tests with fixtures and traces");
  const others = ["b", "b", "b", "c", "d", "e", "f"].map((owner, index) =>
    skill(`${owner}/repo${index}:playwright-${index % 5}`, `playwright-${owner === "f" ? 0 : index}`, "Playwright browser tests with fixtures and traces", 100 - index));
  const related = relatedSkillsPicker([base, ...others, ...filler]);
  const picked = related(base);
  assert.ok(picked.length <= 5);
  assert.ok(picked.filter(item => item.author_handle === "b").length <= 2);
  assert.equal(new Set(picked.map(item => item.name)).size, picked.length);
  assert.deepEqual(related(skill("z/repo:none", "none", "")), []);
});
