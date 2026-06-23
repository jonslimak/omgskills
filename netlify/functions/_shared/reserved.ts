export const reservedHandlesAndSlugs = new Set([
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

export function isReservedHandleOrSlug(value: string): boolean {
  return reservedHandlesAndSlugs.has(value.trim().toLowerCase());
}
