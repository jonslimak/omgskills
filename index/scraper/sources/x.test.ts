import test from "node:test";
import assert from "node:assert/strict";
import { englishOnlyXQuery, isEnglishOnlyTweetText } from "./x.js";

test("X queries request English results", () => {
  assert.equal(
    englishOnlyXQuery('"skill" "github.com"'),
    '"skill" "github.com" lang:en',
  );
  assert.equal(
    englishOnlyXQuery('"skill" lang:en'),
    '"skill" lang:en',
  );
});

test("English tweet text allows punctuation, emoji, and URLs", () => {
  assert.equal(
    isEnglishOnlyTweetText(
      "I’m sharing a useful skill 📌 https://github.com/owner/repo",
    ),
    true,
  );
});

test("tweet text with non-English letters is rejected", () => {
  assert.equal(
    isEnglishOnlyTweetText(
      "A useful skill with 中文 text https://github.com/owner/repo",
    ),
    false,
  );
  assert.equal(
    isEnglishOnlyTweetText(
      "A useful skill with فارسی text https://github.com/owner/repo",
    ),
    false,
  );
  assert.equal(
    isEnglishOnlyTweetText(
      "A useful skill with café text https://github.com/owner/repo",
    ),
    false,
  );
});
