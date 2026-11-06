import { useEffect, useMemo, useState } from "react";
import type { PortalSet, LoadState } from "../model";
import type { CatalogSummary } from "./model";
import type { PublicCatalogClient } from "./public-catalog";
import { loadSetCatalog, setCatalogIds } from "./set-catalog";

type Result = { key: string; skills: CatalogSummary[]; state: LoadState; note: string };

export function useSetCatalog(client: PublicCatalogClient, set: PortalSet | null) {
  const ids = JSON.stringify(setCatalogIds(set));
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([set?.id, ids, attempt]);
  const [result, setResult] = useState<Result>({ key: "", skills: [], state: "ready", note: "" });
  useEffect(() => {
    if (ids === "[]") return;
    const controller = new AbortController();
    void loadSetCatalog(client, JSON.parse(ids), controller.signal).then(({ skills, missing }) => {
      if (!controller.signal.aborted) setResult({ key, skills, state: "ready",
        note: missing ? "Some skills are no longer in the catalog. Showing their saved details." : "" });
    }, () => {
      if (!controller.signal.aborted) setResult({ key, skills: [], state: "error",
        note: "Could not load catalog details. Your saved skills are still available." });
    });
    return () => controller.abort();
  }, [client, key, ids]);
  const current = ids === "[]" ? { skills: [], state: "ready" as const, note: "" }
    : result.key === key ? result : { skills: [], state: "loading" as const, note: "" };
  return { ...current, retry: () => setAttempt(value => value + 1) };
}

/**
 * Library details for skills added to My skills, so their rows show names without the server waiting on the catalog.
 * Details already loaded stay while a new add or remove fetches only the skills not loaded yet.
 */
export function useAddedCatalog(client: PublicCatalogClient, ids: string[]) {
  const [loaded, setLoaded] = useState<Map<string, CatalogSummary>>(() => new Map());
  const missing = JSON.stringify(ids.filter(id => !loaded.has(id)));
  useEffect(() => {
    if (missing === "[]") return;
    const controller = new AbortController();
    // Rows still show by ID if the library can't be reached.
    void loadSetCatalog(client, JSON.parse(missing), controller.signal).then(({ skills }) => {
      if (controller.signal.aborted) return;
      setLoaded(old => { const next = new Map(old); for (const skill of skills) next.set(skill.id, skill); return next; });
    }, () => {});
    return () => controller.abort();
  }, [client, missing]);
  return useMemo(() => ids.flatMap(id => loaded.get(id) ?? []), [ids, loaded]);
}
