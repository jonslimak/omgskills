import { useEffect, useMemo, useState } from "react";
import { isDiscovery, type CatalogSummary, type Navigation } from "./model";
import type { LoadState } from "../model";
import { emptyCatalog, loadPublicView, publicScope, PublicCatalogClient } from "./public-catalog";

export type PublicStatus = {
  list: LoadState; error?: string; note?: string;
  detail: LoadState; detailError?: string;
  retry: () => void; retryDetail: () => void;
};
const message = (error: unknown) => error instanceof Error ? error.message : "The catalog could not be loaded. Try again.";

export function usePublicCatalog(client: PublicCatalogClient, nav: Navigation, enabled: boolean) {
  const request = useMemo<Navigation>(() => ({ view: nav.view, id: nav.id, query: nav.query, selected: "", source: "all" }), [nav.view, nav.id, nav.query]);
  const scope = publicScope(request);
  const active = enabled && (isDiscovery(nav.view) || !!nav.query.trim());
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [view, setView] = useState({ scope: "", catalog: emptyCatalog(), state: "loading" as LoadState, error: "", note: "" });
  const [detail, setDetail] = useState({ key: "", skill: null as CatalogSummary | null, state: "loading" as LoadState, error: "" });
  const selectedId = enabled && nav.selected.startsWith("catalog:") ? nav.selected.slice(8) : "";

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setView((previous) => ({ ...previous, scope, state: "loading", error: "", note: "" }));
    const timer = setTimeout(() => {
      loadPublicView(client, request, controller.signal).then(({ catalog, note }) => {
        if (!controller.signal.aborted) setView({ scope, catalog, note, state: "ready", error: "" });
      }).catch((error) => {
        if (!controller.signal.aborted) setView((previous) => ({ ...previous, scope, state: "error", error: message(error) }));
      });
    }, request.query.trim() ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
    // Selection/source changes must not refetch or reset the active public list.
  }, [client, request, scope, active, revision]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setDetail({ key: selectedId, skill: null, state: "loading", error: "" });
    client.skill(selectedId, controller.signal).then(async (skill) => {
      if (!skill) throw new Error("This skill is no longer available in the catalog.");
      if (!controller.signal.aborted) setDetail({ key: selectedId, skill, state: "ready", error: "" });
      const publicUrl = await client.publicUrl(selectedId, controller.signal).catch(() => undefined);
      if (!controller.signal.aborted && publicUrl) setDetail({ key: selectedId, skill: { ...skill, publicUrl }, state: "ready", error: "" });
    }).catch((error) => {
      if (!controller.signal.aborted) setDetail({ key: selectedId, skill: null, state: "error", error: message(error) });
    });
    return () => controller.abort();
  }, [client, selectedId, detailRevision]);

  const currentDetail = detail.key === selectedId ? detail : null;
  const catalog = { ...view.catalog, skills: [...view.catalog.skills.filter((skill) => skill.id !== currentDetail?.skill?.id), ...(currentDetail?.skill ? [currentDetail.skill] : [])] };
  const status: PublicStatus = {
    list: active ? (view.scope === scope ? view.state : "loading") : "ready",
    error: view.scope === scope ? view.error : "", note: view.scope === scope ? view.note : "",
    detail: currentDetail?.state ?? "loading", detailError: currentDetail?.error,
    retry: () => setRevision((value) => value + 1),
    retryDetail: () => setDetailRevision((value) => value + 1),
  };
  return { catalog, status };
}
