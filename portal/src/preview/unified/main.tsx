import { StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RotateCcw } from "lucide-react";
import { UnifiedApp } from "../../app/unified/UnifiedApp";
import {
  initialNavigation,
  isDiscovery,
  isFavorite,
  navigationLocation,
  parseNavigation,
  parsePublicNavigationPath,
  type Navigation,
  type SkillDisplay,
} from "../../app/unified/model";
import { makeCatalog, makeFixtures, type Scenario } from "./fixtures";
import { changeMembership } from "../state";
import type { PortalSet } from "../../app/model";
import type { GroupedSyncedSkill } from "../../synced-skill-grouping";
import { PublicCatalogClient } from "../../app/unified/public-catalog";
import { usePublicCatalog } from "../../app/unified/use-public-catalog";
import { previewInstallClient } from "../../app/unified/public-install";
import { f2Cases, f2CaseNavigation, f2NavigationSearch, readF2CaseKey } from "./f2-install";
import { createPreviewCatalogStore, createPreviewInstallStore, PublicInstallSetup } from "./PublicInstallSetup";
import { CatalogInstallSetup } from "../../app/unified/CatalogInstallSetup";

const installClient = import.meta.env.DEV ? previewInstallClient(import.meta.env.DEV,
  import.meta.env.VITE_NEWMAC_F1, import.meta.env.VITE_NEWMAC_SETUP_TEST, location.hostname) : null;
const installPreviewEnabled = installClient !== null;
// The plain preview shows production's install card, as signed-in users see it.
const catalogStore = createPreviewCatalogStore();

const catalog = makeCatalog();
const publicClient = new PublicCatalogClient();
const base = "/app/preview/unified/";
// The plain sample preview mirrors production's clean public addresses; F2 install cases keep ?view=.
const readNavigation = () => (!installPreviewEnabled && location.pathname.startsWith(base)
  ? parsePublicNavigationPath(location.pathname.slice(base.length), location.search) : null) ?? parseNavigation(location.search);
function installed(skills: SkillDisplay[]): GroupedSyncedSkill[] {
  return skills.flatMap((skill) => (skill.installed ? [skill.installed] : []));
}

function Preview() {
  const [installStore] = useState(() => installClient ? createPreviewInstallStore(installClient) : null);
  const [scenario, setScenario] = useState<Scenario>("populated");
  const [data, setData] = useState(() => makeFixtures());
  const [signedIn, setSignedIn] = useState(!installPreviewEnabled);
  const [f2CaseKey, setF2CaseKey] = useState(() => readF2CaseKey(location.search));
  const [nav, setNav] = useState(readNavigation);
  const [revision, setRevision] = useState(0);
  const [signedOutNav, setSignedOutNav] = useState<Navigation | null>(null);
  const [liveCatalog, setLiveCatalog] = useState(true);
  const publicData = usePublicCatalog(publicClient, nav, liveCatalog);
  const previewSearch = (next: Navigation, caseKey = f2CaseKey) =>
    installPreviewEnabled ? f2NavigationSearch(next, caseKey) : navigationLocation(next, true);
  const navigate = (next: Navigation, replace = false) => {
    if (next.selected && next.selected !== nav.selected) installStore?.clear();
    const safe =
      !signedIn && !isDiscovery(next.view)
        ? { ...initialNavigation, view: "discover" as const }
        : next;
    window.history[replace ? "replaceState" : "pushState"](
      { nav: safe },
      "",
      `${base}${previewSearch(safe)}`,
    );
    setNav(safe);
  };
  useEffect(() => {
    const pop = () => {
      const saved = (history.state as { nav?: Navigation } | null)?.nav;
      const next = saved && `${base}${previewSearch(saved)}` === location.pathname + location.search ? saved : readNavigation();
      const caseKey = readF2CaseKey(location.search);
      const pending = installStore?.read().intent;
      if (pending && next.selected && next.selected !== `catalog:${pending.catalogId}`) installStore?.clear();
      setF2CaseKey(caseKey);
      if (!signedIn && !isDiscovery(next.view)) {
        const safe = { ...initialNavigation, view: "discover" as const };
        history.replaceState({ nav: safe }, "", `${base}${installPreviewEnabled ? f2NavigationSearch(safe, caseKey) : navigationLocation(safe, true)}`);
        setNav(safe);
      } else setNav(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [signedIn, installStore]);
  function selectF2Case(caseKey: string) {
    const next = f2CaseNavigation(caseKey);
    if (!next) return;
    installStore?.clear();
    history.pushState({}, "", `${base}${previewSearch(next, caseKey)}`);
    setF2CaseKey(caseKey);
    setLiveCatalog(true);
    setNav(next);
  }
  function reset(next: Scenario) {
    installStore?.clear();
    setScenario(next);
    setData(makeFixtures(next));
    setRevision((value) => value + 1);
    navigate({ ...nav, selected: "", source: "all", query: "" }, true);
  }
  function session(next: boolean) {
    setSignedIn(next);
    if (!next) {
      setSignedOutNav(nav);
      setData(makeFixtures(scenario));
      setRevision((value) => value + 1);
      const publicNav = isDiscovery(nav.view)
        ? {
            ...nav,
            selected: nav.selected.startsWith("catalog:") ? nav.selected : "",
          }
        : { ...initialNavigation, view: "discover" as const };
      history.replaceState({}, "", `${base}${previewSearch(publicNav)}`);
      setNav(publicNav);
    } else {
      const nextNav = isDiscovery(nav.view)
        ? nav
        : signedOutNav || initialNavigation;
      history.replaceState({}, "", `${base}${previewSearch(nextNav)}`);
      setNav(nextNav);
    }
  }
  return (
    <UnifiedApp
      key={revision}
      data={data}
      catalog={
        liveCatalog ? publicData.catalog : scenario === "empty"
          ? {
              ...catalog,
              skills: [],
              collections: [],
              creators: [],
              trendingIds: [],
            }
          : catalog
      }
      publicStatus={liveCatalog ? publicData.status : undefined}
      nav={nav}
      navigate={navigate}
      signedIn={signedIn}
      publicInstallAction={installClient ? (skill, detailReady) => <PublicInstallSetup
        key={`${skill.catalogId}:${f2CaseKey}`} skill={skill} detailReady={detailReady && liveCatalog}
        caseKey={f2CaseKey} returnRoute={`${base}${previewSearch(nav)}`} store={installStore!} client={installClient} />
        : (skill, detailReady) => <CatalogInstallSetup key={skill.key} skill={skill} detailReady={detailReady && liveCatalog}
          store={catalogStore} returnRoute={`/app/?view=discover&skill=${encodeURIComponent(skill.key)}`} />}
      onInstallCancel={() => catalogStore.clear()}
      onSession={session}
      state={
        scenario === "loading" || scenario === "error" ? scenario : "ready"
      }
      retry={() => reset("populated")}
      onFavorite={(skill) => {
        if (!signedIn || !skill.installed) return;
        const add = !isFavorite(data, skill);
        setData((current) => ({
          ...current,
          sets: current.sets.map((set) =>
            set.isFavorites
              ? changeMembership(set, [skill.installed!], add)
              : set,
          ),
        }));
      }}
      onMembership={(setId, skills, add) =>
        setData((current) => ({
          ...current,
          sets: current.sets.map((set) =>
            set.id === setId && signedIn
              ? changeMembership(set, installed(skills), add)
              : set,
          ),
        }))
      }
      onVisibility={(setId, visibility) =>
        setData((current) => ({
          ...current,
          sets: current.sets.map((set) =>
            set.id === setId &&
            signedIn &&
            set.role === "owner" &&
            !set.isFavorites
              ? { ...set, visibility }
              : set,
          ),
        }))
      }
      onCreateSet={(name, skills) => {
        if (!signedIn) return;
        const set: PortalSet = {
          id: crypto.randomUUID(),
          name,
          description: "",
          visibility: "private",
          isFavorites: false,
          hidden: false,
          role: "owner",
          ownerName: data.profile.name,
          emails: [],
          items: [],
        };
        setData((current) => ({
          ...current,
          sets: [
            ...current.sets,
            changeMembership(set, installed(skills), true),
          ],
        }));
      }}
      previewBar={
        <div className="ua-preview">
          <span>{liveCatalog ? "Local preview · live Discover · sample account" : "Local preview · sample data"}</span>
          <div>
            {installPreviewEnabled && <select aria-label="F2 test case" value={f2CaseKey} onChange={event => selectF2Case(event.target.value)}>
              <option value="" disabled>F2: Choose a test case</option>
              {f2Cases.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>}
            <select
              aria-label="Catalog data"
              value={liveCatalog ? "live" : "sample"}
              onChange={(event) => {
                setLiveCatalog(event.target.value === "live");
                navigate({ ...initialNavigation, view: "discover" }, true);
              }}
            >
              <option value="live">Live catalog</option>
              <option value="sample">Sample catalog</option>
            </select>
            <label>
              <span className="ua-sr">Preview account</span>
              <select
                aria-label="Preview account"
                value={signedIn ? "in" : "out"}
                onChange={(event) => session(event.target.value === "in")}
              >
                <option value="in">Signed in</option>
                <option value="out">Signed out</option>
              </select>
            </label>
            <label>
              <span className="ua-sr">Preview scenario</span>
              <select
                aria-label="Preview scenario"
                value={scenario}
                onChange={(event) => reset(event.target.value as Scenario)}
              >
                <option value="populated">Populated</option>
                <option value="empty">Empty</option>
                <option value="loading">Loading</option>
                <option value="error">Error</option>
                <option value="long-content">Long content</option>
                <option value="connected-source">GitHub source</option>
              </select>
            </label>
            <button
              type="button"
              className="ua-icon"
              aria-label="Reset sample data"
              title="Reset sample data"
              onClick={() => reset(scenario)}
            >
              <RotateCcw />
            </button>
          </div>
        </div>
      }
    />
  );
}

// Fixture edits can reload this entry module without replacing the DOM container.
const root: Root = import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
