import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { saveTheme, storedTheme, themeStorageKey } from "../src/app/unified/theme-preference";

test("the theme stays usable when accessing localStorage itself is blocked", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new DOMException("Storage access blocked", "SecurityError"); },
  });
  try {
    assert.equal(storedTheme(), "light");
    assert.doesNotThrow(() => saveTheme("dark"));
    assert.doesNotThrow(() => saveTheme("dark", { setItem: () => { throw new Error("Storage full"); } }));
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("the app reads and saves the theme the landing page shares", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
  assert.equal(storedTheme(storage), "light");
  saveTheme("dark", storage);
  assert.equal(values.get(themeStorageKey), "dark");
  assert.equal(storedTheme(storage), "dark");
  values.set(themeStorageKey, "purple");
  assert.equal(storedTheme(storage), "light");
  assert.equal(storedTheme({ getItem: () => { throw new Error("blocked"); } }), "light");
  assert.equal(storedTheme(undefined), "light");
  // The landing page uses the same key on load, on toggle and on links into the library.
  for (const file of ["../../site/home/theme.js", "../../site/home/home.js"]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), new RegExp(`'${themeStorageKey}'`));
  }
});

test("reading the theme preserves legacy preferences without writing a new choice", () => {
  const values = new Map([["omgskills-home-theme", "dark"]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  assert.equal(storedTheme(storage), "dark");
  assert.equal(values.has(themeStorageKey), false);
  values.set(themeStorageKey, "light");
  assert.equal(storedTheme(storage), "light");
});

test("without a saved choice the app uses the system theme without persisting it", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
  let dark = true;
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      assert.equal(query, "(prefers-color-scheme: dark)");
      return { matches: dark };
    },
  });
  try {
    const storage = { getItem: () => null };
    assert.equal(storedTheme(storage), "dark");
    assert.equal(storedTheme({ getItem: () => { throw new Error("blocked"); } }), "dark");
    dark = false;
    assert.equal(storedTheme(storage), "light");
  } finally {
    if (previous) Object.defineProperty(globalThis, "matchMedia", previous);
    else Reflect.deleteProperty(globalThis, "matchMedia");
  }
});

test("theme persistence is an explicit toggle action, never a mount effect", () => {
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /useEffect\(\(\) => saveTheme\(theme\)/);
  assert.match(app, /function toggleTheme\(\)\s*\{[^}]*saveTheme\(next\);[^}]*setTheme\(next\);/);
  assert.match(app, /onClick=\{toggleTheme\}/);
  assert.match(app, /onSelect=\{toggleTheme\}/);
});
