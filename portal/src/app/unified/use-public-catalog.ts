import { useEffect, useMemo, useState } from "react";
import { isDiscovery, type CatalogSummary, type Navigation } from "./model";
import type { LoadState } from "../model";
import { emptyCatalog, loadPublicView, publicScope, PublicCatalogClient } from "./public-catalog";

export type PublicStatus = {
  list: LoadState; error?: string; note?: string;
  metadata?: LoadState; metadataError?: string;
  detail: LoadState; detailError?: string;
  retry: () => void; retryDetail: () => void;
};
const message = (error: unknown) => error instanceof Error ? error.message : "The catalog could not be loaded. Try again.";

// Start public reads before authentication resolves; the mounted view shares these requests.
export function usePublicCatalogPreload(client: PublicCatalogClient, nav: Navigation) {
  const request = useMemo(() => ({ ...nav, selected: "", source: "all" }), [nav.view, nav.id, nav.query]);
  useEffect(() => {
    if (!isDiscovery(request.view)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void loadPublicView(client, request, controller.signal).catch(() => {});
    }, request.query.trim() ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [client, request]);
}

export function usePublicCatalog(client: PublicCatalogClient, nav: Navigation, enabled: boolean) {
  const request = useMemo<Navigation>(() => ({ view: nav.view, id: nav.id, query: nav.query, selected: "", source: "all" }), [nav.view, nav.id, nav.query]);
  const scope = publicScope(request);
  const active = enabled && (isDiscovery(nav.view) || !!nav.query.trim());
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [view, setView] = useState({ scope: "", catalog: emptyCatalog(), state: "loading" as LoadState, metadata: "loading" as LoadState, metadataError: "", error: "", note: "" });
  const [detail, setDetail] = useState({ key: "", skill: null as CatalogSummary | null, state: "loading" as LoadState, error: "" });
  const selectedId = enabled && nav.selected.startsWith("catalog:") ? nav.selected.slice(8) : "";

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const cached = client.cachedView(request);
    setView(previous => previous.scope === scope ? {
      ...previous, state: previous.state === "ready" ? "ready" : "loading", metadata: previous.metadata === "ready" ? "ready" : "loading", error: "", metadataError: "",
    } : { scope, catalog: cached?.catalog ?? emptyCatalog(), state: cached ? "ready" : "loading", metadata: cached ? "ready" : "loading", metadataError: "", error: "", note: cached?.note ?? "" });
    const timer = setTimeout(() => {
      loadPublicView(client, request, controller.signal, update => {
        if (controller.signal.aborted) return;
        setView(previous => {
          if (update.state === "error") return update.section === "metadata"
            ? { ...previous, metadata: previous.metadata === "ready" ? "ready" : "error", metadataError: message(update.error) }
            : { ...previous, state: previous.state === "ready" ? "ready" : "error", error: message(update.error) };
          if (update.section === "metadata") return { ...previous, metadata: "ready", metadataError: "", catalog: {
            ...previous.catalog, collections: update.catalog.collections, creators: update.catalog.creators, categories: update.catalog.categories,
          } };
          return { ...previous, state: "ready", error: "", catalog: { ...previous.catalog,
            skills: update.skills, resultIds: update.skills.map(skill => skill.id),
            trendingIds: !request.query.trim() && ["top", "discover"].includes(request.view) ? update.skills.map(skill => skill.id) : [],
          } };
        });
      }).then(({ catalog, note }) => {
        if (!controller.signal.aborted) setView({ scope, catalog, note, state: "ready", metadata: "ready", metadataError: "", error: "" });
      }).catch((error) => {
        // Section errors were already reported. Only handle failures before a list started here.
        if (!controller.signal.aborted) setView(previous => previous.state === "loading"
          ? { ...previous, state: "error", error: message(error) } : previous);
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
  const cached = active ? client.cachedView(request) : undefined;
  const current = view.scope === scope ? view : cached ? { ...cached, state: "ready" as const, metadata: "ready" as const, metadataError: "", error: "" } : { catalog: emptyCatalog(), state: "loading" as const, metadata: "loading" as const, metadataError: "", error: "", note: "" };
  const catalog = { ...current.catalog, skills: [...current.catalog.skills.filter((skill) => skill.id !== currentDetail?.skill?.id), ...(currentDetail?.skill ? [currentDetail.skill] : [])] };
  const status: PublicStatus = {
    list: active ? current.state : "ready",
    metadata: active ? current.metadata : "ready", metadataError: current.metadataError,
    error: current.error, note: current.note,
    detail: currentDetail?.state ?? "loading", detailError: currentDetail?.error,
    retry: () => setRevision((value) => value + 1),
    retryDetail: () => setDetailRevision((value) => value + 1),
  };
  return { catalog, status };
}
