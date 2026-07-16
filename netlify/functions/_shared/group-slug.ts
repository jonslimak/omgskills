import { isReservedGroupSlug } from "./reserved.js";
import { slugify } from "./validation.js";

export function resolveCreateGroupSlug(
  name: string,
  requestedSlug: unknown,
  isFavorites: boolean
): string {
  const slug = isFavorites
    ? "favorites"
    : slugify(typeof requestedSlug === "string" ? requestedSlug : name);
  if (!isFavorites && isReservedGroupSlug(slug)) {
    throw new Response("Group slug is reserved", { status: 400 });
  }
  return slug;
}
