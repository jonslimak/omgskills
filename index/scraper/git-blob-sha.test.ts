import assert from "node:assert/strict";
import test from "node:test";
import { gitBlobSha } from "./git-blob-sha.js";

test("matches git hash-object for a known UTF-8 fixture", () => {
  assert.equal(
    gitBlobSha(Buffer.from("hello\n", "utf8")),
    "ce013625030ba8dba906f756967f9e9ca394464a",
  );
});

test("hashes non-ASCII content as its exact UTF-8 bytes", () => {
  assert.equal(
    gitBlobSha(Buffer.from("héllo\n", "utf8")),
    "5fb50d3c93474f139362304b663fe44e9d17a26e",
  );
});

test("does not normalize line endings", () => {
  const lf = gitBlobSha(Buffer.from("hello\n", "utf8"));
  const crlf = gitBlobSha(Buffer.from("hello\r\n", "utf8"));

  assert.equal(crlf, "ef0493b275aa2080237f676d2ef6559246f56636");
  assert.notEqual(crlf, lf);
});
