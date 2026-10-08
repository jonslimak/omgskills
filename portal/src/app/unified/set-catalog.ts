import type { PortalSet } from "../model";
import type { CatalogSummary } from "./model";
import { LIST_LIMIT, type PublicCatalogClient } from "./public-catalog";

export function setCatalogIds(set: PortalSet | null): string[] {
  // Never send private names, source links, synced IDs or set IDs to discovery.
  return [...new Set(set?.items.flatMap(item => item.kind === "catalog" && item.catalogSkillId ? [item.catalogSkillId] : []) ?? [])];
}

export async function loadSetCatalog(client: Pick<PublicCatalogClient, "collection">, ids: string[], signal: AbortSignal) {
  const skills: CatalogSummary[] = [];
  let missing = 0;
  for (let offset = 0; offset < ids.length; offset += LIST_LIMIT) {
    signal.throwIfAborted();
    const result = await client.collection(ids.slice(offset, offset + LIST_LIMIT), signal);
    signal.throwIfAborted();
    skills.push(...result.skills);
    missing += result.missing;
  }
  return { skills, missing };
}
