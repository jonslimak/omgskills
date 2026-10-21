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

test("public results and sorting remain independent of the personal disclosure", () => {
  const publicResults = search.slice(search.indexOf('<section className="ua-search-library">'));
  assert.equal(publicResults.includes('{catalogControls}'), false);
  assert.ok(source.includes('{nav.query && catalogSort}'));
  assert.ok(publicResults.includes('rows(matchingLibrary)'));
  assert.ok(source.includes('const matchingLibrary = publicStatus ? remoteRows : library.filter((skill) => matchesSearch(skill, nav.query));'));
});

test("search sorting sits at the top right of the title while the subtitle spans the header", () => {
  assert.ok(source.includes('nav.query ? " ua-heading-search" : ""'));
  assert.match(styles, /\.ua-heading-search > \.ua-filter\s*\{\s*grid-column: 2;\s*grid-row: 1;/);
  assert.match(styles, /\.ua-heading-search \.ua-search-meta\s*\{\s*grid-column: 1 \/ -1;\s*grid-row: 2;/);
  assert.ok(source.includes('{!nav.query && catalogControls}'));
});

test("mobile sorting keeps the accessible native options behind a compact icon", () => {
  assert.ok(source.includes('className="ua-filter ua-sort-filter" title="Sort skills"'));
  assert.ok(source.includes('<ArrowUpDown className="ua-sort-icon" aria-hidden="true" />'));
  assert.ok(source.includes('<select aria-label="Sort skills" value={nav.sort ?? "relevance"}'));
  assert.ok(source.includes('publicSorts.map(value => <option'));
  const mobile = styles.slice(styles.indexOf("@media (max-width: 759px)"));
  assert.match(mobile, /\.ua-sort-filter\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(mobile, /\.ua-sort-filter select\s*\{[^}]*position: absolute;[^}]*opacity: 0;/);
  assert.match(mobile, /\.ua-sort-filter\s*\{[^}]*background: transparent;/);
  assert.match(mobile, /\.ua-sort-filter \.ua-sort-icon\s*\{[^}]*color: var\(--ua-faint\);/);
  assert.match(styles, /\.ua-sort-icon\s*\{\s*display: none;/);
});

test("all skill rows show available mobile star counts on their title line", () => {
  const row = source.slice(source.indexOf('  function renderRow('), source.indexOf('  function rows('));
  const heading = row.slice(row.indexOf('<span className="ua-row-heading">'), row.indexOf('<span className="ua-row-description">'));
  assert.ok(heading.includes('skill.stars !== undefined && ('));
  assert.ok(heading.includes('className="ua-row-stars ua-row-stars-mobile"'));
  assert.ok(heading.includes('aria-label={`${starCount(skill.stars)} stars`}'));
  assert.equal(heading.includes('!compact && skill.stars'), false);
  assert.match(styles, /\.ua-row-stars-mobile\s*\{\s*display: none;/);
  const mobile = styles.slice(styles.indexOf("@media (max-width: 759px)"));
  assert.match(mobile, /\.ua-row-stars-mobile\s*\{\s*display: inline-flex;[^}]*flex-shrink: 0;[^}]*margin-left: auto;/);
  assert.match(mobile, /\.ua-row \.ua-row-heading \.ua-row-name\s*\{\s*flex-shrink: 1;\s*min-width: 0;/);
});

test("mobile Trending removes duplicate subtitle stars and their separator only on phones", () => {
  assert.ok(source.includes('className="ua-trending-separator" aria-hidden="true"'));
  const mobile = styles.slice(styles.indexOf("@media (max-width: 759px)"));
  assert.match(mobile, /\.ua-trending-stars,\s*\.ua-trending-separator\s*\{\s*display: none;/);
  assert.match(styles, /\.ua-trending-stars\s*\{\s*display: inline-flex;/);
});

test("search result counts sit beside the query subtitle without duplicating browse counts", () => {
  assert.ok(source.includes('const catalogCount = publicList && publicStatus.page ?'));
  assert.ok(source.includes('<p className="ua-search-meta"><span>{meta}</span>{catalogCount}{catalogNote && <span role="status">{catalogNote}</span>}</p>'));
  assert.ok(source.includes('const catalogNote = publicList && listState === "ready" ? publicStatus.note : "";'));
  assert.ok(source.includes('{!nav.query && catalogNote && <p className="ua-muted ua-catalog-note" role="status">{catalogNote}</p>}'));
  assert.ok(source.includes('{!nav.query && catalogCount}'));
  assert.equal((source.match(/\{publicStatus.loaded\} of \{publicStatus.page.total\}/g) ?? []).length, 1);
  assert.match(styles, /\.ua-search-meta\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
  assert.match(styles, /\.ua-catalog-count\s*\{[^}]*white-space: nowrap;/);
  assert.match(styles, /\.ua-catalog-controls > \.ua-filter\s*\{\s*margin-left: auto;/);
});

test("Enter shows the submitted query as the title without changing live search", () => {
  assert.ok(source.includes('const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);'));
  assert.ok(source.includes('submittedQuery === nav.query ? `\\u201c${nav.query.trim()}\\u201d` : "Search results"'));
  assert.ok(source.includes('onChange={(event) => changeQuery(event.target.value)}'));
  assert.ok(source.includes('event.key !== "Enter" || event.nativeEvent.isComposing || !nav.query.trim()'));
  assert.ok(source.includes('setSubmittedQuery(nav.query);'));
  assert.ok(source.includes('enterKeyHint="search"'));
});

test("editing the query or leaving its page resets the submitted title, unlike sorting and paging", () => {
  assert.match(source, /useEffect\(\(\) => \{\s*setSubmittedQuery\(null\);\s*\}, \[nav.query, nav.view, nav.id, signedIn\]\);/);
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
