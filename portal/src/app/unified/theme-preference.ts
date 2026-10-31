// Shared with the omgskills.com landing page (site/home/theme.js and home.js), so the
// library opens in the theme the visitor was just looking at.
export const themeStorageKey = "omgskills-theme";
export type Theme = "light" | "dark";

export function storedTheme(storage?: Pick<Storage, "getItem">): Theme {
  try {
    const saved = storage ?? globalThis.localStorage;
    for (const key of [themeStorageKey, "omgskills-home-theme"]) {
      const value = saved?.getItem(key);
      if (value === "dark" || value === "light") return value;
    }
  } catch { /* Fall back to the system when storage is blocked. */ }
  try {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch { return "light"; }
}

export function saveTheme(theme: Theme, storage?: Pick<Storage, "setItem">) {
  try { (storage ?? globalThis.localStorage)?.setItem(themeStorageKey, theme); } catch { /* The theme still works for this visit. */ }
}
