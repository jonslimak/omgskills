import { useEffect, useMemo, useRef, useState } from "react";
import { isDiscovery, type CatalogSummary, type Navigation } from "./model";
import type { LoadState } from "../model";
import { emptyCatalog, loadPublicView, publicScope, PublicCatalogClient } from "./public-catalog";
import { appendPublicPage, publicPageRequest, requiresPageRestart, type PublicPageInfo } from "./public-paging";

export type PublicStatus = {
  list: LoadState; error?: string; note?: string;
  metadata?: LoadState; metadataError?: string;
  detail: LoadState; detailError?: string; detailMissing?: boolean;
  retry: () => void; retryDetail: () => void;
  page?: PublicPageInfo; loaded?: number; moreState?: LoadState; moreError?: string;
  restartPages?: boolean; loadMore?: () => void;
};
const message = (error: unknown) => error instanceof Error ? error.message : "The catalog could not be loaded. Try again.";

// Start public reads before authentication resolves; the mounted view shares these requests.
export function usePublicCatalogPreload(client: PublicCatalogClient, nav: Navigation) {
  const request = useMemo(() => ({ ...nav, selected: "", source: "all" }), [nav.view, nav.id, nav.query, nav.sort]);
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
  const request = useMemo<Navigation>(() => ({ view: nav.view, id: nav.id, query: nav.query, selected: "", source: "all", ...(nav.sort ? { sort: nav.sort } : {}) }), [nav.view, nav.id, nav.query, nav.sort]);
  const scope = publicScope(request);
  const active = enabled && (isDiscovery(nav.view) || !!nav.query.trim());
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [view, setView] = useState<{ scope: string; catalog: ReturnType<typeof emptyCatalog>; state: LoadState; metadata: LoadState; metadataError: string; error: string; note: string; page?: PublicPageInfo }>(
    { scope: "", catalog: emptyCatalog(), state: "loading", metadata: "loading", metadataError: "", error: "", note: "" });
  const [more, setMore] = useState({ scope: "", state: "ready" as LoadState, error: "", restart: false });
  const appendRequest = useRef<{ scope: string; controller: AbortController } | null>(null);
  const seenCursors = useRef(new Set<string>());
  const [detail, setDetail] = useState({ key: "", skill: null as CatalogSummary | null, state: "loading" as LoadState, error: "", missing: false });
  const selectedId = enabled && nav.selected.startsWith("catalog:") ? nav.selected.slice(8) : "";

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    appendRequest.current?.controller.abort();
    appendRequest.current = null;
    seenCursors.current = new Set();
    setMore({ scope, state: "ready", error: "", restart: false });
    const cached = client.cachedView(request);
    setView(previous => previous.scope === scope ? {
      ...previous, page: undefined, state: previous.state === "ready" ? "ready" : "loading", metadata: previous.metadata === "ready" ? "ready" : "loading", error: "", metadataError: "",
    } : { scope, catalog: cached?.catalog ?? emptyCatalog(), state: cached ? "ready" : "loading", metadata: cached ? "ready" : "loading", metadataError: "", error: "", note: cached?.note ?? "", page: cached?.page });
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
          return { ...previous, state: "ready", error: "", page: update.page, note: update.note ?? "", catalog: { ...previous.catalog,
            skills: update.skills, resultIds: update.skills.map(skill => skill.id),
            trendingIds: !request.query.trim() && ["top", "discover"].includes(request.view) ? update.skills.map(skill => skill.id) : [],
          } };
        });
      }).then(({ catalog, note, page }) => {
        if (!controller.signal.aborted) setView(previous => {
          // Metadata may finish after the user has already appended another page.
          const appended = previous.scope === scope && page && previous.page?.snapshot === page.snapshot
            && (previous.catalog.resultIds?.length ?? 0) > (catalog.resultIds?.length ?? 0);
          return { scope, catalog: appended ? { ...catalog, skills: previous.catalog.skills, resultIds: previous.catalog.resultIds, trendingIds: previous.catalog.trendingIds } : catalog,
            note, page: appended ? previous.page : page, state: "ready", metadata: "ready", metadataError: "", error: "" };
        });
      }).catch((error) => {
        // Section errors were already reported. Only handle failures before a list started here.
        if (!controller.signal.aborted) setView(previous => previous.state === "loading"
          ? { ...previous, state: "error", error: message(error) } : previous);
      });
    }, request.query.trim() ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); appendRequest.current?.controller.abort(); appendRequest.current = null; };
    // Selection/source changes must not refetch or reset the active public list.
  }, [client, request, scope, active, revision]);

  const retry = () => { client.invalidateView(request); setRevision(value => value + 1); };
  const loadMore = () => {
    if (!active || view.scope !== scope || !view.page?.hasMore || appendRequest.current || (more.scope === scope && more.restart)) return;
    const pageRequest = publicPageRequest(request), cursor = view.page.nextCursor;
    if (!pageRequest || !cursor) return;
    const pending = { scope, controller: new AbortController() };
    appendRequest.current = pending;
    setMore({ scope, state: "loading", error: "", restart: false });
    const byId = new Map(view.catalog.skills.map(skill => [skill.id, skill]));
    const previous = { page: view.page, skills: (view.catalog.resultIds ?? []).flatMap(id => byId.get(id) ?? []) };
    void client.page(pageRequest, pending.controller.signal, cursor).then(next => {
      if (pending.controller.signal.aborted || appendRequest.current !== pending) return;
      const used = new Set([...seenCursors.current, cursor]);
      const chain = appendPublicPage(previous, next, used);
      seenCursors.current = used;
      setView(current => current.scope !== scope || current.page?.snapshot !== previous.page.snapshot || current.page?.nextCursor !== cursor
        || current.catalog.resultIds?.length !== previous.skills.length ? current : { ...current, page: chain.page, catalog: { ...current.catalog,
        skills: chain.skills, resultIds: chain.skills.map(skill => skill.id),
        trendingIds: pageRequest.name === "list_trending" ? chain.skills.map(skill => skill.id) : [],
      } });
      setMore({ scope, state: "ready", error: "", restart: false });
    }).catch(error => {
      if (pending.controller.signal.aborted || appendRequest.current !== pending) return;
      const restart = requiresPageRestart(error);
      if (restart) {
        client.invalidateView(request);
        setView(current => current.scope === scope ? { ...current, page: undefined } : current);
      }
      setMore({ scope, state: "error", error: message(error), restart });
    }).finally(() => { if (appendRequest.current === pending) appendRequest.current = null; });
  };

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setDetail({ key: selectedId, skill: null, state: "loading", error: "", missing: false });
    client.skill(selectedId, controller.signal).then(async (skill) => {
      if (!skill) {
        // Not a loading failure: retrying cannot help, so the panel says so plainly.
        if (!controller.signal.aborted) setDetail({ key: selectedId, skill: null, state: "error", missing: true,
          error: "This skill isn't in the catalog. The link may be wrong, or the skill was removed." });
        return;
      }
      if (!controller.signal.aborted) setDetail({ key: selectedId, skill, state: "ready", error: "", missing: false });
      const publicUrl = await client.publicUrl(selectedId, controller.signal).catch(() => undefined);
      if (!controller.signal.aborted && publicUrl) setDetail({ key: selectedId, skill: { ...skill, publicUrl }, state: "ready", error: "", missing: false });
    }).catch((error) => {
      if (!controller.signal.aborted) setDetail({ key: selectedId, skill: null, state: "error", error: message(error), missing: false });
    });
    return () => controller.abort();
  }, [client, selectedId, detailRevision]);

  const currentDetail = detail.key === selectedId ? detail : null;
  const cached = active ? client.cachedView(request) : undefined;
  const current = view.scope === scope ? view : cached ? { ...cached, state: "ready" as const, metadata: "ready" as const, metadataError: "", error: "" } : { catalog: emptyCatalog(), state: "loading" as const, metadata: "loading" as const, metadataError: "", error: "", note: "", page: undefined };
  const catalog = { ...current.catalog, skills: [...current.catalog.skills.filter((skill) => skill.id !== currentDetail?.skill?.id), ...(currentDetail?.skill ? [currentDetail.skill] : [])] };
  const status: PublicStatus = {
    list: active ? current.state : "ready",
    metadata: active ? current.metadata : "ready", metadataError: current.metadataError,
    error: current.error, note: current.note,
    detail: currentDetail?.state ?? "loading", detailError: currentDetail?.error, detailMissing: currentDetail?.missing,
    retry,
    retryDetail: () => setDetailRevision((value) => value + 1),
    page: current.page, loaded: current.catalog.resultIds?.length ?? 0,
    moreState: more.scope === scope ? more.state : "ready", moreError: more.scope === scope ? more.error : "",
    restartPages: more.scope === scope && more.restart, loadMore: more.scope === scope && more.restart ? retry : loadMore,
  };
  return { catalog, status };
}
