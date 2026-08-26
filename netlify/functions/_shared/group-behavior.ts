import { optionalString, requireString } from "./validation.js";

export const groupVisibilities = ["public", "restricted", "private"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GroupVisibility = (typeof groupVisibilities)[number];

export type GroupMutationFacts = {
  isFavorites: boolean;
  visibility: GroupVisibility;
};

export type GroupPatch = {
  hasName: boolean;
  name: string | null;
  hasDescription: boolean;
  description: string | null;
  hasVisibility: boolean;
  visibility: GroupVisibility | null;
};

export function parseGroupVisibility(value: unknown, field = "visibility"): GroupVisibility {
  if (!groupVisibilities.includes(value as GroupVisibility)) {
    throw new Response(`${field} is invalid`, { status: 400 });
  }
  return value as GroupVisibility;
}

export function parseGroupPatch(
  body: Record<string, unknown>,
  group: GroupMutationFacts
): GroupPatch {
  const hasName = Object.hasOwn(body, "name");
  const hasDescription = Object.hasOwn(body, "description");
  const hasVisibility = Object.hasOwn(body, "visibility");
  if (!hasName && !hasDescription && !hasVisibility) {
    throw new Response("No group changes provided", { status: 400 });
  }
  if (group.isFavorites && (hasName || hasVisibility)) {
    throw new Response("Favorites name and visibility are protected", { status: 409 });
  }

  return {
    hasName,
    name: hasName ? requireString(body.name, "name", 120) : null,
    hasDescription,
    description: hasDescription ? optionalString(body.description, 1000) : null,
    hasVisibility,
    visibility: hasVisibility ? parseGroupVisibility(body.visibility) : null,
  };
}

export function assertGroupCanBeDeleted(group: GroupMutationFacts) {
  if (group.isFavorites) {
    throw new Response("Favorites cannot be deleted", { status: 409 });
  }
}

export function requireGroupItemId(value: unknown): string {
  const itemId = requireString(value, "itemId", 80);
  if (!uuidPattern.test(itemId)) {
    throw new Response("itemId is invalid", { status: 400 });
  }
  return itemId;
}

export function validateCompleteItemOrder(currentIds: string[], requestedIds: unknown): string[] {
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => typeof id !== "string")) {
    throw new Response("itemIds must be an array of strings", { status: 400 });
  }
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new Response("itemIds contains duplicates", { status: 400 });
  }
  if (
    currentIds.length !== requestedIds.length ||
    currentIds.some((id) => !requestedIds.includes(id))
  ) {
    throw new Response("itemIds must contain every current group item exactly once", { status: 400 });
  }
  return requestedIds;
}
