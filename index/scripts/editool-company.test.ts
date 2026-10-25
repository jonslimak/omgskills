import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("./editool.html", import.meta.url), "utf8");

test("profile type changes stage booleans and preserve the existing alias override", () => {
  const state = {
    creators: { creators: [{ handle: "NewHandle", aliases: ["OldHandle"] }] },
    collections: { authorOverrides: { OLDHANDLE: { title: "Preserved", description: "Existing description" } } },
  };
  const functions = ["overrideFor", "registryEntryFor", "setAuthorOverrideField"].map(name => {
    const source = html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
    assert.ok(source, name);
    return source;
  }).join("\n");
  const setField = runInNewContext(`${functions}\nsetAuthorOverrideField`, { state }) as (handle: string, field: string, value: string) => void;
  setField("newhandle", "isCompany", "true");
  assert.equal((state.collections.authorOverrides.OLDHANDLE as { isCompany?: boolean }).isCompany, true);
  setField("NEWHANDLE", "isCompany", "false");
  assert.equal(JSON.parse(JSON.stringify(state)).collections.authorOverrides.OLDHANDLE.isCompany, false);
  setField("NewHandle", "isCompany", "");
  assert.equal(Object.hasOwn(state.collections.authorOverrides.OLDHANDLE, "isCompany"), false);
  assert.deepEqual(state.collections.authorOverrides, { OLDHANDLE: { title: "Preserved", description: "Existing description" } });
  assert.match(html, /select data-f="isCompany"/);
});
