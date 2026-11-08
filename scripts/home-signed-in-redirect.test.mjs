import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const script = html.match(/<script>\s*\/\/ Signed in[\s\S]*?<\/script>/)?.[0].replace(/<\/?script>/g, "");

function visit({ cookie = "", referrer = "" } = {}) {
  let went = null;
  const location = { origin: "https://omgskills.com", replace: (url) => { went = url; } };
  vm.runInNewContext(script, { document: { cookie, referrer }, location, URL });
  return went;
}

test("the home page sends signed-in visitors to My skills before anything renders", () => {
  assert.ok(script, "redirect script is in site/index.html");
  assert.ok(html.indexOf(script) < html.indexOf("<title>"), "it runs first in <head>");
  assert.equal(visit({ cookie: "a=1; __client_uat=1731000000" }), "/app/?view=all");
  assert.equal(visit({ cookie: "__client_uat_Xy12=1731000000; b=2" }), "/app/?view=all");
  assert.equal(visit({ cookie: "__client_uat=1731000000", referrer: "https://www.google.com/" }), "/app/?view=all");
});

test("signed-out visitors and links from inside the site stay on the home page", () => {
  assert.equal(visit(), null);
  assert.equal(visit({ cookie: "__client_uat=0" }), null);
  assert.equal(visit({ cookie: "x__client_uat=5" }), null);
  assert.equal(visit({ cookie: "__client_uat=1731000000", referrer: "https://omgskills.com/guide/" }), null);
});

test("signed in, the logo on every site page opens My skills; signed out, it stays a link home", async () => {
  const { execFileSync } = await import("node:child_process");
  const logoScript = await readFile(new URL("../site/signed-in-logo.js", import.meta.url), "utf8");
  const pages = execFileSync("git", ["ls-files", "site/*.html", "site/**/*.html"], { encoding: "utf8" }).trim().split("\n");
  for (const page of pages) {
    const text = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    const logos = (text.match(/class="(brand|eyes|site-footer-brand-logo)"[^>]*href="\/"/g) ?? []).length;
    assert.equal(text.includes('<script src="/signed-in-logo.js"></script>'), logos > 0, page);
  }
  const run = (cookie) => {
    const links = ["brand", "eyes", "site-footer-brand-logo", "other"].map((name) => ({ name, href: "/", setAttribute(key, value) { this[key] = value; } }));
    const document = { cookie, querySelectorAll: (selector) => links.filter((link) => selector.includes(`a.${link.name}[href="/"]`)) };
    vm.runInNewContext(logoScript, { document });
    return links.map((link) => link.href);
  };
  assert.deepEqual(run("__client_uat=1731000000"), ["/app/?view=all", "/app/?view=all", "/app/?view=all", "/"]);
  assert.deepEqual(run("__client_uat=0"), ["/", "/", "/", "/"]);
  assert.deepEqual(run(""), ["/", "/", "/", "/"]);
});
