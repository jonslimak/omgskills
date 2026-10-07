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

// Browser-only presentation fixture. No Clerk, backend, or account writes.
const base = "/app/testing/unified-acceptance/";
if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname) || !location.pathname.startsWith(base)) {
  throw new Error("This fixture only runs on the local review route.");
}
const params = new URLSearchParams(location.search);
const scenario = (params.get("scenario") || "populated") as Scenario;
const catalog = makeCatalog();
const publicClient = new PublicCatalogClient();
const publicReview = params.get("catalog") === "1";
const sample = makeFixtures(scenario);
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
  const shownCatalog = publicReview ? remote.catalog : catalog;
  const data = signedIn ? sample : emptyAccount({ name: "Visitor", email: "" });
  const navigate = (next: Navigation, replace = false) => {
    const safe = accountNavigation(next, signedIn);
    history[replace ? "replaceState" : "pushState"]({}, "", base + navigationSearch(safe));
    setRequested(safe);
  };
  useEffect(() => {
    const pop = () => setRequested(entryNavigation(location.pathname, location.search, base));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const detail = { set: data.sets.find(set => nav.view === "favorites" ? set.isFavorites : set.id === nav.id) ?? null,
    state: "ready" as const, error: "", retry: () => {} };
  const management = useManagement({ data, mine: skillDisplays(data, shownCatalog).mine, busy: false, blocked: false,
    scope: `${nav.view}:${nav.id}:${nav.query}:${signedIn}`, saveSet: rejectWrite, saveMembership: rejectWrite,
    detail, base, local: true });
  return <UnifiedApp key={String(signedIn)} data={data} catalog={shownCatalog} publicStatus={publicReview ? remote.status : undefined} nav={nav} navigate={navigate}
    signedIn={signedIn} onSession={next => { setSignedIn(next); setRequested({ ...initialNavigation, view: "discover" }); }}
    onSignIn={() => setSignedIn(true)} readOnlyAccount management={signedIn ? management : undefined}
    onFavorite={rejectWrite} onCreateSet={rejectWrite} onMembership={rejectWrite} onVisibility={rejectWrite}
    state={!recovered && (scenario === "loading" || scenario === "error") ? scenario : "ready"}
    retry={() => setRecovered(true)} previewBar={null} />;
}

function ReviewRoot() {
  const [entry] = useState(() => publicReview ? accountNavigation(entryNavigation(location.pathname, location.search, base), false) : initialNavigation);
  usePublicCatalogPreload(publicClient, entry);
  const delay = publicReview ? Math.min(5000, Math.max(0, Number(params.get("authDelay")) || 0)) : 0;
  const [ready, setReady] = useState(!delay);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return ready ? <Review /> : <p role="status">Loading account...</p>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><ReviewRoot /></StrictMode>);
