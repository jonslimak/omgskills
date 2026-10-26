import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");

test("skill identity and actions stay in the header above the scroll region", () => {
  const start = source.indexOf('<div className="ua-detail-header">');
  const body = source.indexOf('<div className="ua-detail-body"', start);
  const header = source.slice(start, body);
  assert.ok(start > 0 && body > start);
  assert.match(header, /<Dialog\.Title>\{detail\.name\}<\/Dialog\.Title>/);
  assert.match(header, /label="Close skill details"/);
  assert.match(header, /className="ua-detail-actions"/);
  assert.match(header, /label="Share skill"/);
  assert.doesNotMatch(header, /className="ua-description"/);
  const content = source.slice(body, source.indexOf("</Dialog.Content>", body));
  assert.match(content, /role="region" aria-label="Skill content" tabIndex=\{0\}/);
  assert.match(content, /className="ua-description"/);
  assert.match(content, /<SkillReadme skill=\{detail\} \/>/);
  assert.match(content, /className="ua-detail-account"/);
  assert.match(content, /className="ua-more"/);
});

test("only the body scrolls and can shrink beneath the fixed header", () => {
  const rule = (selector: string) => styles.slice(styles.indexOf(`${selector} {`)).split("}")[0];
  assert.match(rule(".ua-detail"), /overflow: hidden/);
  assert.match(rule(".ua-detail-header"), /flex-shrink: 0/);
  assert.match(rule(".ua-detail-body"), /flex: 1 1 auto/);
  assert.match(rule(".ua-detail-body"), /min-height: 0/);
  assert.match(rule(".ua-detail-body"), /overflow-y: auto/);
  assert.match(rule(".ua-detail-body"), /overscroll-behavior: contain/);
  assert.match(rule(".ua-detail-body > *"), /flex-shrink: 0/);
  assert.match(styles, /\.ua-detail-body\s*\{\s*padding-bottom: max\(28px, env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.ua-detail \.ua-more\s*\{[^}]*margin-top: auto/);
});

test("mobile skill overlays reserve their full height before content loads", () => {
  const mobile = styles.slice(styles.indexOf("@media (max-width: 759px)", styles.indexOf(".ua-detail {")));
  const panel = mobile.slice(mobile.indexOf(".ua-detail {")).split("}")[0];
  assert.match(panel, /\n\s+height: 92dvh;/);
  assert.match(panel, /\n\s+max-height: 92dvh;/);
  assert.match(panel, /\n\s+bottom: 0;/);
  const desktop = styles.slice(styles.indexOf(".ua-detail {")).split("}")[0];
  assert.doesNotMatch(desktop, /\n\s+height:/);
});
