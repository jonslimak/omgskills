import { catalogReservedProfileHandles } from "./catalog-reserved-handles.js";

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

export function isReservedProfileHandle(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return reservedHandlesAndSlugs.has(normalized) || catalogReservedProfileHandles.has(normalized);
}
