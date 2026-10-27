// Shared with the omgskills.com landing page (site/home/theme.js and home.js), so the
// library opens in the theme the visitor was just looking at.
export const themeStorageKey = "omgskills-theme";
export type Theme = "light" | "dark";

export function storedTheme(storage?: Pick<Storage, "getItem">): Theme {
  try {
    const value = (storage ?? globalThis.localStorage)?.getItem(themeStorageKey);
    return value === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function saveTheme(theme: Theme, storage?: Pick<Storage, "setItem">) {
  try { (storage ?? globalThis.localStorage)?.setItem(themeStorageKey, theme); } catch { /* The theme still works for this visit. */ }
}
