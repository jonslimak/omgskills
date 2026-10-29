import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assetHash,
  contentMatchesName,
  createR2Client,
  objectKey,
  parseListObjects,
  planPull,
  planPush,
  signRequest,
} from "./data-store.mjs";

const named = (prefix, body) => `${prefix}-${createHash("sha256").update(body).digest("hex").slice(0, 12)}.json`;

test("asset names carry their content hash", () => {
  const body = Buffer.from('{"a":1}\n');
  const name = named("skills", body);
  assert.equal(assetHash(name), name.slice(7, 19));
  assert.equal(contentMatchesName(name, body), true);
  assert.equal(contentMatchesName(name, Buffer.from("changed")), false);
  for (const other of ["manifest.json", "assets.txt", "skills-ABCDEF123456.json", "skills-abc.json", "../skills-0123456789ab.json"]) {
    assert.equal(assetHash(other), null, other);
  }
});

test("bucket keys mirror the site layout", () => {
  assert.equal(objectKey("site/data", "trending-0123456789ab.json"), "data/trending-0123456789ab.json");
  assert.equal(objectKey("site/data/v2", "skills-0123456789ab.json"), "data/v2/skills-0123456789ab.json");
  assert.equal(objectKey("site/data/crawl4", "skills-0123456789ab.json"), "data/crawl4/skills-0123456789ab.json");
});

test("push uploads only what the bucket lacks and lists every local asset", () => {
  const local = ["a-000000000001.json", "b-000000000002.json"];
  const plan = planPush("site/data/v2", local, new Set(["data/v2/a-000000000001.json", "data/a-000000000002.json"]));
  assert.deepEqual(plan, { upload: ["b-000000000002.json"], list: local });
});

test("pull downloads listed assets that are absent or do not match", () => {
  const good = Buffer.from("good");
  const goodName = named("good", good);
  const files = { [goodName]: good, [named("stale", Buffer.from("x"))]: Buffer.from("y") };
  const missing = named("missing", Buffer.from("z"));
  assert.deepEqual(planPull([goodName, ...Object.keys(files).slice(1), missing], (name) => files[name] ?? null),
    [Object.keys(files)[1], missing]);
});

test("list responses yield keys and continue only when truncated", () => {
  const page = "<ListBucketResult><Contents><Key>data/v2/a-000000000001.json</Key></Contents><Contents><Key>data/a&amp;b</Key></Contents>"
    + "<IsTruncated>true</IsTruncated><NextContinuationToken>tok</NextContinuationToken></ListBucketResult>";
  assert.deepEqual(parseListObjects(page), { keys: ["data/v2/a-000000000001.json", "data/a&b"], next: "tok" });
  assert.equal(parseListObjects("<IsTruncated>false</IsTruncated><NextContinuationToken>tok</NextContinuationToken>").next, null);
});

test("requests are signed with Signature Version 4", () => {
  // Uses the AWS documentation's example credentials; the signature itself is proven against R2 by `check`.
  const headers = signRequest({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    now: new Date("2013-05-24T00:00:00Z"),
  });
  assert.equal(headers["x-amz-date"], "20130524T000000Z");
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test("the client needs all three credentials and never sends them unsigned", async () => {
  assert.throws(() => createR2Client({ R2_ACCOUNT_ID: "acct" }), /required/);
  const seen = [];
  const client = createR2Client({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret" },
    async (url, init) => { seen.push({ url, init }); return new Response("<IsTruncated>false</IsTruncated>", { status: 200 }); });
  await client.listKeys("data/v2/");
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /^https:\/\/acct\.r2\.cloudflarestorage\.com\/omgskills-catalog-data\?/);
  assert.doesNotMatch(JSON.stringify(seen), /secret/);
  assert.match(seen[0].init.headers.authorization, /Credential=id\//);
});
