// Shared with the omgskills.com landing page (site/home/theme.js and home.js), so the
// library opens in the theme the visitor was just looking at.
export const themeStorageKey = "omgskills-theme";
export type Theme = "light" | "dark";

export function storedTheme(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Theme {
  try {
    const value = storage?.getItem(themeStorageKey);
    return value === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function saveTheme(theme: Theme, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try { storage?.setItem(themeStorageKey, theme); } catch { /* The theme still works for this visit. */ }
}
