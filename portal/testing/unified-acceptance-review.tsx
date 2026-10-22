import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { UnifiedApp } from "../src/app/unified/UnifiedApp";
import { initialNavigation, navigationSearch, skillDisplays, type Navigation } from "../src/app/unified/model";
import { makeCatalog, makeFixtures, type Scenario } from "../src/preview/unified/fixtures";
import { accountNavigation, publicNavigation } from "../src/integration/unified/policy";
import { entryNavigation } from "../src/integration/unified/entry-navigation";
import { useManagement } from "../src/integration/unified/useManagement";
import { emptyAccount } from "../src/integration/data";
import { PublicCatalogClient } from "../src/app/unified/public-catalog";
import { usePublicCatalog, usePublicCatalogPreload } from "../src/app/unified/use-public-catalog";
import { AccountDialogReview } from "./account-dialog-review";
import { useSetCatalog } from "../src/app/unified/use-set-catalog";
import { LoadingScreen } from "../src/app/LoadingScreen";
import { publicPagingFixture } from "./public-paging-fixture";
import { changeMembership } from "../src/preview/state";
import { emptyMembershipResult, type MembershipCommand } from "../src/integration/membership-data";

// Browser-only presentation fixture. No Clerk, backend, or account writes.
const base = "/app/testing/unified-acceptance/";
if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname) || !location.pathname.startsWith(base)) {
  throw new Error("This fixture only runs on the local review route.");
}
const params = new URLSearchParams(location.search);
const favoritesReview = ["1", "error", "uncertain"].includes(params.get("favoritesReview") || "");
const scenario = (params.get("scenario") || "populated") as Scenario;
const catalog = makeCatalog();
const localCollectionCovers = import.meta.glob<string>("../../site/images/collections/*.webp", {
  eager: true, query: "?url", import: "default",
});
const pagingReview = params.get("paging") === "1";
const publicClient = new PublicCatalogClient(pagingReview ? publicPagingFixture(catalog, params.get("pageFailure")) : undefined, undefined, undefined, pagingReview);
const publicReview = params.get("catalog") !== "0";
const sample = makeFixtures(scenario);
const setCatalogReview = params.get("setCatalog");
let failCatalog = setCatalogReview === "error";
const setClient = new PublicCatalogClient(async (path, init) => {
  await Promise.resolve();
  init?.signal?.throwIfAborted();
  const request = JSON.parse(String(init?.body));
  if (path !== "/mcp" || request.params.name !== "get_skills") throw new Error("Unexpected fixture request");
  if (failCatalog) { failCatalog = false; return new Response("", { status: 503 }); }
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { structuredContent: {
    skills: setCatalogReview === "missing" ? [] : request.params.arguments.ids.map((id: string) => ({
      id, name: "pdf", description: "Read and create PDF documents.", author_handle: "example",
      github_url: "https://github.com/example/skills", tags: [],
    })),
  } } }), { headers: { "content-type": "application/json" } });
});
if (setCatalogReview) sample.sets = sample.sets.map(set => set.isFavorites ? { ...set, items: [
  { id: "saved-pdf", kind: "catalog", syncedSkillId: null, catalogSkillId: "example/skills:pdf", name: "example/skills:pdf", description: "", githubUrl: null },
] } : set);
sample.profile = { name: "Sample Reviewer", email: "reviewer@example.test", handle: "reviewer", published: false };
sample.sets = sample.sets.map(set => ({ ...set, ownerName: "Sample Owner",
  allowedEmails: set.role === "owner" ? set.emails.map((_, index) => ({ id: `email-${index}`, email: `sample-${index}@example.test` })) : undefined }));
const rejectWrite = async (): Promise<never> => { throw new Error("This review does not write data."); };

function Review() {
  const [signedIn, setSignedIn] = useState(params.get("signedOut") !== "1");
  const [reviewData, setReviewData] = useState(sample);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [requested, setRequested] = useState(() => entryNavigation(location.pathname, location.search, base));
  const nav = accountNavigation(requested, signedIn);
  const remote = usePublicCatalog(publicClient, publicNavigation(nav), publicReview);
  const data = signedIn ? reviewData : emptyAccount({ name: "Visitor", email: "" });
  const navigate = (next: Navigation, replace = false) => {
    const safe = accountNavigation(next, signedIn);
    const search = new URLSearchParams(navigationSearch(safe));
    if (!publicReview) search.set("catalog", "0");
    if (pagingReview) search.set("paging", "1");
    if (favoritesReview) search.set("favoritesReview", params.get("favoritesReview")!);
    history[replace ? "replaceState" : "pushState"]({}, "", base + (search.size ? `?${search}` : ""));
    setRequested(safe);
  };
  useEffect(() => {
    const pop = () => setRequested(entryNavigation(location.pathname, location.search, base));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const detail = { set: data.sets.find(set => nav.view === "favorites" ? set.isFavorites : set.id === nav.id) ?? null,
    state: "ready" as const, error: "", retry: () => {} };
  const setCatalog = useSetCatalog(setClient, setCatalogReview ? detail.set : null);
  const baseCatalog = publicReview ? remote.catalog : catalog;
  const shownCatalog = { ...baseCatalog,
    collections: baseCatalog.collections.map(collection => ({ ...collection,
      imageUrl: collection.imageUrl ? localCollectionCovers[`../../site/images/collections/${collection.id}.webp`] ?? collection.imageUrl : undefined,
    })),
    skills: [...baseCatalog.skills.map(skill => pagingReview ? { ...skill, avatar: catalog.creators[0]?.avatar } : skill), ...setCatalog.skills.map(skill => ({ ...skill, avatar: undefined }))] };
  async function saveReviewFavorite(command: MembershipCommand) {
    if (!favoritesReview) return rejectWrite();
    if (!signedIn || !(command.kind === "favorites" || command.kind === "remove-favorite" || (command.kind === "catalog" && command.favorite))) return rejectWrite();
    const favorites = data.sets.find(set => set.isFavorites && set.role === "owner");
    if (!favorites) return rejectWrite();
    setSavingFavorite(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (params.get("favoritesReview") === "error") throw new Error("Sample save failed. Your real account is unchanged.");
      if (params.get("favoritesReview") === "uncertain") return { ...emptyMembershipResult(), uncertain: true };
      setReviewData(current => ({ ...current, sets: current.sets.map(set => {
        if (set.id !== favorites.id) return set;
        let items = set.items;
        if (command.kind === "favorites") items = changeMembership(set, command.skills, command.add).items;
        else if (command.kind === "catalog" && !items.some(item => item.catalogSkillId === command.catalogId)) items = [...items, {
          id: `sample-${command.catalogId}`, kind: "catalog", syncedSkillId: null, catalogSkillId: command.catalogId,
          name: shownCatalog.skills.find(skill => skill.id === command.catalogId)?.name || command.catalogId, description: "", githubUrl: null,
        }];
        else if (command.kind === "remove-favorite") {
          const installed = skillDisplays(current, shownCatalog).mine.find(skill => skill.installed?.id === command.skillId)?.installed;
          if (installed) items = changeMembership(set, [installed], false).items;
          items = items.filter(item => !(command.catalogId && item.catalogSkillId === command.catalogId));
        }
        return { ...set, items, itemCount: items.length };
      }) }));
      return { ...emptyMembershipResult(), groupId: favorites.id, added: command.kind === "remove-favorite" ? 0 : 1, removed: command.kind === "remove-favorite" ? 1 : 0 };
    } finally { setSavingFavorite(false); }
  }
  const management = useManagement({ data, mine: skillDisplays(data, shownCatalog).mine, busy: savingFavorite, blocked: false,
    scope: `${nav.view}:${nav.id}:${nav.query}:${signedIn}`, saveSet: rejectWrite, saveMembership: saveReviewFavorite,
    detail: { ...detail, catalog: setCatalogReview ? setCatalog : undefined }, base, local: true });
  return <UnifiedApp key={String(signedIn)} data={data} catalog={shownCatalog} publicStatus={publicReview ? remote.status : undefined} nav={nav} navigate={navigate}
    signedIn={signedIn} onSession={next => { setSignedIn(next); setRequested({ ...initialNavigation, view: "discover" }); }}
    onSignIn={() => setSignedIn(true)} readOnlyAccount management={signedIn ? management : undefined}
    accountPages={params.get("accountDialogs") === "1" ? (_view, theme) => <AccountDialogReview theme={theme} /> : undefined}
    onFavorite={rejectWrite} onCreateSet={rejectWrite} onMembership={rejectWrite} onVisibility={rejectWrite}
    state={!recovered && (scenario === "loading" || scenario === "error") ? scenario : "ready"}
    retry={() => setRecovered(true)} previewBar={null} />;
}

function ReviewRoot() {
  const [entry] = useState(() => publicReview ? accountNavigation(entryNavigation(location.pathname, location.search, base), false) : initialNavigation);
  usePublicCatalogPreload(publicClient, entry);
  const delay = Math.min(5000, Math.max(0, Number(params.get("authDelay")) || 0));
  const [ready, setReady] = useState(!delay);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return ready ? <Review /> : <LoadingScreen />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><ReviewRoot /></StrictMode>);
