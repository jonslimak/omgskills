import { catalogReservedProfileHandles } from "./catalog-reserved-handles.js";

// These names represent protected product or system identities. Do not add
// top-level route names here solely because they exist outside /u/.
export const reservedSystemProfileHandles = new Set([
  "u",
  "g",
  "data",
  "health",
  "admin",
  "api",
  "auth",
  "sync",
  "shared",
  "profile",
  "groups",
  "skills",
  "catalog"
]);

// Group policy is independent from profile identity policy. `sets` conflicts
// with the legacy /u/:handle/:groupSlug route; `favorites` is app-owned.
export const reservedGroupSlugs = new Set([
  "u",
  "g",
  "data",
  "health",
  "admin",
  "api",
  "auth",
  "sync",
  "shared",
  "profile",
  "groups",
  "skills",
  "catalog",
  "sets",
  "favorites"
]);

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export function isReservedProfileHandle(value: string): boolean {
  const handle = normalized(value);
  return reservedSystemProfileHandles.has(handle) || catalogReservedProfileHandles.has(handle);
}

export function isReservedGroupSlug(value: string): boolean {
  return reservedGroupSlugs.has(normalized(value));
}
