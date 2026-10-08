import { useEffect, useState } from "react";
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
