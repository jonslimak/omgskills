import { useEffect, useRef, useState } from "react";
import type { PortalApi } from "../../portal-api";
import type { PortalSet, LoadState } from "../../app/model";
import { startSetRead } from "../read-session";

export function useSetDetail(api: PortalApi, id: string, revision: number, enabled: boolean) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [attempt, setAttempt] = useState(0);
  const key = `${id}:${revision}:${attempt}:${enabled}`;
  const [result, setResult] = useState<{ key: string; id: string; set: PortalSet | null; state: LoadState; error: string }>({ key: "", id: "", set: null, state: "loading", error: "" });
  useEffect(() => {
    if (!enabled || !id) return;
    return startSetRead((path, init) => apiRef.current(path, init), id,
      set => setResult({ key, id, set: { ...set, membershipSkillIds: set.role === "owner" && !set.items.some(item => item.kind === "synced" && !item.syncedSkillId)
        ? set.items.flatMap(item => item.syncedSkillId ? [item.syncedSkillId] : []) : undefined }, state: "ready", error: "" }),
      error => setResult({ key, id, set: null, state: "error", error: error instanceof Error ? error.message : "Could not load this set." }));
  }, [id, key, enabled]);
  // A reload of the same Set (an account refresh, a save) keeps the loaded one on screen until the new answer lands.
  const current = enabled && id && result.key === key ? result
    : enabled && id && result.id === id && result.set ? { set: result.set, state: "ready" as const, error: "", refreshing: true }
    : { set: null, state: id && enabled ? "loading" as const : "ready" as const, error: "" };
  return { ...current, retry: () => setAttempt(value => value + 1) };
}
