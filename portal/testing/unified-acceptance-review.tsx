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

// Browser-only presentation fixture. No Clerk, backend, or account writes.
const base = "/app/testing/unified-acceptance/";
if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname) || !location.pathname.startsWith(base)) {
  throw new Error("This fixture only runs on the local review route.");
}
const params = new URLSearchParams(location.search);
const scenario = (params.get("scenario") || "populated") as Scenario;
const catalog = makeCatalog();
const publicClient = new PublicCatalogClient();
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
  { id: "saved-pdf", kind: "catalog", catalogSkillId: "example/skills:pdf", name: "example/skills:pdf", description: "", githubUrl: null },
] } : set);
sample.profile = { name: "Sample Reviewer", email: "reviewer@example.test", handle: "reviewer", published: false };
sample.sets = sample.sets.map(set => ({ ...set, ownerName: "Sample Owner",
  allowedEmails: set.role === "owner" ? set.emails.map((_, index) => ({ id: `email-${index}`, email: `sample-${index}@example.test` })) : undefined }));
const rejectWrite = async (): Promise<never> => { throw new Error("This review does not write data."); };

function Review() {
  const [signedIn, setSignedIn] = useState(params.get("signedOut") !== "1");
  const [recovered, setRecovered] = useState(false);
  const [requested, setRequested] = useState(() => entryNavigation(location.pathname, location.search, base));
  const nav = accountNavigation(requested, signedIn);
  const remote = usePublicCatalog(publicClient, publicNavigation(nav), publicReview);
  const data = signedIn ? sample : emptyAccount({ name: "Visitor", email: "" });
  const navigate = (next: Navigation, replace = false) => {
    const safe = accountNavigation(next, signedIn);
    const search = new URLSearchParams(navigationSearch(safe));
    if (!publicReview) search.set("catalog", "0");
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
  const shownCatalog = { ...baseCatalog, skills: [...baseCatalog.skills, ...setCatalog.skills.map(skill => ({ ...skill, avatar: undefined }))] };
  const management = useManagement({ data, mine: skillDisplays(data, shownCatalog).mine, busy: false, blocked: false,
    scope: `${nav.view}:${nav.id}:${nav.query}:${signedIn}`, saveSet: rejectWrite, saveMembership: rejectWrite,
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
