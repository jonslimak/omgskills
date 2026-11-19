import assert from "node:assert/strict";
import test from "node:test";
import { duplicateSkillPages } from "./duplicate-skill-pages.mjs";

const text = "Airflow 3 plugins let you embed FastAPI apps, React UIs and middleware in Airflow. ".repeat(4);
const page = (urlPath, author, body, extra = {}) => ({ skill: { author_handle: author, body, stars: extra.stars ?? 0 }, urlPath, indexable: extra.indexable ?? true, isEditorial: !!extra.isEditorial, isTrending: !!extra.isTrending });
const textFor = (skill) => skill.body;

test("one creator's copies point at the main copy; the main copy has none", () => {
  const map = duplicateSkillPages([
    page("/library/astronomer/agents/skills/airflow-plugins/", "astronomer", text),
    page("/library/astronomer/agents/airflow-plugins/", "astronomer", text),
  ], textFor);
  assert.deepEqual([...map], [["/library/astronomer/agents/skills/airflow-plugins/", "/library/astronomer/agents/airflow-plugins/"]]);
});

test("editorial, then trending, then stars pick the main copy", () => {
  const a = page("/library/x/a/s/", "x", text, { stars: 900 });
  const b = page("/library/x/bbbbbbbb/s/", "x", text, { isEditorial: true });
  const c = page("/library/x/c/s/", "x", text, { isTrending: true });
  const map = duplicateSkillPages([a, b, c], textFor);
  assert.equal(map.get(a.urlPath), b.urlPath);
  assert.equal(map.get(c.urlPath), b.urlPath);
  assert.equal(map.has(b.urlPath), false);
  assert.equal(duplicateSkillPages([a, c], textFor).get(a.urlPath), c.urlPath);
});

test("other creators, short text and different text are not copies", () => {
  assert.equal(duplicateSkillPages([page("/library/a/r/s/", "a", text), page("/library/b/r/s/", "b", text)], textFor).size, 0);
  assert.equal(duplicateSkillPages([page("/library/a/r/s/", "a", "Short."), page("/library/a/q/s/", "a", "Short.")], textFor).size, 0);
  assert.equal(duplicateSkillPages([page("/library/a/r/s/", "a", text), page("/library/a/q/s/", "a", `${text} More.`)], textFor).size, 0);
});

test("the main copy is a listed page; with none listed, nothing changes", () => {
  const listed = page("/library/x/a/s/", "x", text);
  const hidden = page("/library/x/b/s/", "x", text, { stars: 900, isEditorial: true, indexable: false });
  assert.deepEqual([...duplicateSkillPages([listed, hidden], textFor)], [[hidden.urlPath, listed.urlPath]]);
  const hidden2 = page("/library/x/c/s/", "x", text, { indexable: false });
  assert.equal(duplicateSkillPages([hidden, hidden2], textFor).size, 0);
});
