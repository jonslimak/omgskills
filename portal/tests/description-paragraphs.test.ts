import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { descriptionParagraphs } from "../src/app/unified/description-paragraphs";

test("unbroken descriptions become one paragraph per period-space sentence", () => {
  assert.deepEqual(descriptionParagraphs("Build the interface. Test the behavior. Ship the result."), [
    "Build the interface.", "Test the behavior.", "Ship the result.",
  ]);
});

test("existing paragraph breaks take precedence over automatic sentence breaks", () => {
  assert.deepEqual(descriptionParagraphs("First sentence. Same paragraph.\n\nSecond paragraph. Keep together."), [
    "First sentence. Same paragraph.", "Second paragraph. Keep together.",
  ]);
});

test("Mac, Windows and Unicode line separators preserve explicit paragraphs", () => {
  for (const separator of ["\n", "\r\n", "\r", "\v", "\f", "\u0085", "\u2028", "\u2029"]) {
    assert.deepEqual(descriptionParagraphs(`  First paragraph. ${separator} Second paragraph.  `), [
      "First paragraph.", "Second paragraph.",
    ]);
  }
});

test("blank lines do not create empty paragraphs or prevent sentence splitting", () => {
  for (const text of ["", "  ", "\r\n\t\n"]) assert.deepEqual(descriptionParagraphs(text), []);
  assert.deepEqual(descriptionParagraphs("\n First.   Second. \n"), ["First.", "Second."]);
});

test("sentence punctuation and unfinished final sentences are not rewritten", () => {
  assert.deepEqual(descriptionParagraphs("First. Continue without a full stop"), ["First.", "Continue without a full stop"]);
  assert.deepEqual(descriptionParagraphs("Does it work? Yes!"), ["Does it work? Yes!"]);
  assert.deepEqual(descriptionParagraphs("Wait... Continue."), ["Wait...", "Continue."]);
});

test("bullet text, filenames, URLs and decimals are preserved", () => {
  assert.deepEqual(descriptionParagraphs("\u2022 Read SKILL.md.\n- Use version 2.4.0.\n* Visit https://example.com/docs."), [
    "\u2022 Read SKILL.md.", "- Use version 2.4.0.", "* Visit https://example.com/docs.",
  ]);
  assert.deepEqual(descriptionParagraphs("Use v2.4.0 and user@example.com. Then visit https://example.com/path."), [
    "Use v2.4.0 and user@example.com.", "Then visit https://example.com/path.",
  ]);
});

test("the splitter uses the Mac app's existing paragraph and period-space boundaries", () => {
  const mac = readFileSync(new URL("../../menubar/Sources/omgskills/ContentView.swift", import.meta.url), "utf8");
  const formatter = mac.slice(mac.indexOf("private func descriptionParagraphs("), mac.indexOf("private func cleanDescriptionParagraph("));
  assert.ok(formatter.includes("if explicitParagraphs.count > 1"));
  assert.ok(formatter.includes('.components(separatedBy: ". ")'));
  assert.deepEqual(descriptionParagraphs("A sentence? Not a new paragraph! Still together"), ["A sentence? Not a new paragraph! Still together"]);
});

test("paragraph formatting is confined to the detail description and preserves its fallback", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/descriptionParagraphs\(/g) ?? []).length, 1);
  assert.ok(source.includes('const detailParagraphs = detail ? descriptionParagraphs(detail.description) : [];'));
  assert.ok(source.includes('<div className="ua-description">'));
  assert.ok(source.includes('detailParagraphs.length ? detailParagraphs : ["No description available."]'));
  assert.ok(source.includes('<p key={index}>{paragraph}</p>'));
  assert.ok(source.includes('skill.description || "No description available"'));
  const styles = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");
  assert.match(styles, /\.ua-description > p \+ p\s*\{\s*margin-top: 12px/);
});
