import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");
const search = source.slice(source.indexOf('<div className="ua-search-results">'), source.indexOf(') : nav.view === "discover" ? ('));

test("public search hides personal labels and the sign-in prompt when there are no personal matches", () => {
  assert.ok(search.includes('matchingMine.length > 0 && <details'));
  assert.ok(search.includes('matchingMine.length > 0 && <h2 className="ua-search-library-label">Library</h2>'));
  assert.equal(search.includes('In my skills'), false);
  assert.equal(search.includes('Sign in to see your skills.'), false);
  assert.ok(source.includes('const mine = signedIn ? models.mine : [];'));
});

test("personal results use a native disclosure that starts collapsed for each search scope", () => {
  assert.ok(search.includes('<details className="ua-search-personal" key={scopeKey}'));
  assert.ok(search.includes('open={expandedSearchScope === scopeKey}'));
  assert.ok(search.includes('onToggle={event => setExpandedSearchScope(event.currentTarget.open ? scopeKey : null)}'));
  assert.ok(search.includes('<summary className="ua-search-personal-toggle">'));
  assert.ok(source.includes('const [expandedSearchScope, setExpandedSearchScope] = useState<string | null>(null);'));
  assert.ok(search.includes('My library'));
  assert.ok(search.includes('{matchingMine.length} {matchingMine.length === 1 ? "skill" : "skills"}'));
  assert.ok(search.includes('{rows(matchingMine)}'));
  assert.ok(source.includes('const scopeKey = `${nav.view}:${nav.id}:${nav.query}:${nav.source}:${signedIn}`;'));
  const reset = source.slice(source.indexOf('    setEditing(false);'), source.indexOf('  }, [scopeKey]);'));
  assert.ok(reset.includes('setExpandedSearchScope(null);'));
});

test("the public Library label is visible only while the personal disclosure is open", () => {
  assert.match(styles, /\.ua-search-personal-hide,\s*\.ua-search-library-label\s*\{\s*display: none/);
  assert.match(styles, /\.ua-search-personal\[open\] \+ \.ua-search-library \.ua-search-library-label\s*\{\s*display: block/);
  assert.ok(search.indexOf('</details>') < search.indexOf('<section className="ua-search-library">'));
});

test("the expanded disclosure replaces its chevron with a Hide affordance", () => {
  assert.ok(search.includes('<ChevronRight aria-hidden="true" />'));
  assert.ok(search.includes('<span className="ua-search-personal-hide">Hide</span>'));
  assert.match(styles, /\.ua-search-personal\[open\] \.ua-search-personal-count svg\s*\{\s*display: none/);
  assert.match(styles, /\.ua-search-personal\[open\] \.ua-search-personal-hide\s*\{\s*display: inline/);
});

test("public results and paging controls remain independent of the personal disclosure", () => {
  const publicResults = search.slice(search.indexOf('<section className="ua-search-library">'));
  assert.ok(publicResults.includes('{catalogControls}'));
  assert.ok(publicResults.includes('rows(matchingLibrary)'));
  assert.ok(source.includes('const matchingLibrary = publicStatus ? remoteRows : library.filter((skill) => matchesSearch(skill, nav.query));'));
});

test("personal-only matches do not show a misleading Nothing matches message", () => {
  assert.ok(search.includes('matchingMine.length > 0 && !matchingLibrary.length ? ('));
  assert.ok(search.includes('<Empty title="No library matches">'));
});

test("private and set searches keep their existing results rather than collapsing them", () => {
  const privateResults = source.slice(source.indexOf(') : nav.query && setPage ?'), source.indexOf('<div className="ua-search-results">'));
  assert.ok(privateResults.includes('rows(visible.filter(skill => matchesSearch(skill, nav.query)))'));
  assert.ok(privateResults.includes('nav.query && privateSearch ?'));
  assert.ok(privateResults.includes('<SectionHeading title="In my skills" />'));
  assert.ok(privateResults.includes('rows(matchingMine)'));
});
