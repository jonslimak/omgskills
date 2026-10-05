import { StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RotateCcw } from "lucide-react";
import { UnifiedApp } from "../../app/unified/UnifiedApp";
import {
  initialNavigation,
  isDiscovery,
  isFavorite,
  navigationSearch,
  parseNavigation,
  type Navigation,
  type SkillDisplay,
} from "../../app/unified/model";
import { makeCatalog, makeFixtures, type Scenario } from "./fixtures";
import { changeMembership } from "../state";
import type { PortalSet } from "../../app/model";
import type { GroupedSyncedSkill } from "../../synced-skill-grouping";
import { PublicCatalogClient } from "../../app/unified/public-catalog";
import { usePublicCatalog } from "../../app/unified/use-public-catalog";

const catalog = makeCatalog();
const publicClient = new PublicCatalogClient();
const base = "/app/preview/unified/";
function installed(skills: SkillDisplay[]): GroupedSyncedSkill[] {
  return skills.flatMap((skill) => (skill.installed ? [skill.installed] : []));
}

function Preview() {
  const [scenario, setScenario] = useState<Scenario>("populated");
  const [data, setData] = useState(() => makeFixtures());
  const [signedIn, setSignedIn] = useState(true);
  const [nav, setNav] = useState(() => parseNavigation(location.search));
  const [revision, setRevision] = useState(0);
  const [signedOutNav, setSignedOutNav] = useState<Navigation | null>(null);
  const [liveCatalog, setLiveCatalog] = useState(true);
  const publicData = usePublicCatalog(publicClient, nav, liveCatalog);
  const navigate = (next: Navigation, replace = false) => {
    const safe =
      !signedIn && !isDiscovery(next.view)
        ? { ...initialNavigation, view: "discover" as const }
        : next;
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      `${base}${navigationSearch(safe)}`,
    );
    setNav(safe);
  };
  useEffect(() => {
    const pop = () => {
      const next = parseNavigation(location.search);
      if (!signedIn && !isDiscovery(next.view)) {
        const safe = { ...initialNavigation, view: "discover" as const };
        history.replaceState({}, "", `${base}${navigationSearch(safe)}`);
        setNav(safe);
      } else setNav(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [signedIn]);
  function reset(next: Scenario) {
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
      history.replaceState({}, "", `${base}${navigationSearch(publicNav)}`);
      setNav(publicNav);
    } else {
      const nextNav = isDiscovery(nav.view)
        ? nav
        : signedOutNav || initialNavigation;
      history.replaceState({}, "", `${base}${navigationSearch(nextNav)}`);
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
