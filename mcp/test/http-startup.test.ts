import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

function startup(fail: boolean) {
  // Inject server events in a child so startup, cleanup and exit status are tested offline.
  const script = `
    import { Server } from "node:http";
    globalThis.fetch = async () => { throw new Error("Network forbidden in startup test"); };
    const abort = AbortController.prototype.abort;
    AbortController.prototype.abort = function (...args) {
      process.stderr.write("catalog stopped\\n");
      return abort.apply(this, args);
    };
    Server.prototype.listen = function () {
      const callback = arguments[arguments.length - 1];
      if (typeof callback === "function") this.once("listening", callback);
      process.nextTick(() => {
        if (${fail}) this.emit("error", Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }));
        else { this.emit("listening"); this.emit("close"); }
      });
      return this;
    };
    process.argv[1] = ${JSON.stringify(fileURLToPath(new URL("../src/http.ts", import.meta.url)))};
    await import(${JSON.stringify(new URL("../src/http.ts", import.meta.url).href)});
  `;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 10_000,
    env: { ...process.env, TSX_DISABLE_CACHE: "1", OMGSKILLS_MCP_HOST: "127.0.0.1", OMGSKILLS_MCP_PORT: "3000",
      ...Object.fromEntries([ ["OMGSKILLS_SKILLS_PATH", "skills"], ["OMGSKILLS_TRENDING_PATH", "trending"],
        ["OMGSKILLS_GOLD_BASKET_PATH", "gold-basket"] ].map(([key, name]) =>
        [key, fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url))])) }
  });
}

test("HTTP startup errors stop the catalog, report the error and exit unsuccessfully", () => {
  const result = startup(true);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "", "a failed bind must not print a success banner");
  assert.match(result.stderr, /EADDRINUSE/);
  assert.equal(result.stderr.match(/catalog stopped/g)?.length, 1);
});

test("successful HTTP startup prints its address and stops the catalog on close", () => {
  const result = startup(false);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^omgskills MCP development server: http:\/\/127\.0\.0\.1:3000\/mcp\n$/);
  assert.equal(result.stderr, "catalog stopped\n");
});
