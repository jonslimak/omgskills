import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { UnifiedApp } from "../app/unified/UnifiedApp";
import { navigationSearch, type Navigation } from "../app/unified/model";
import { PublicCatalogClient } from "../app/unified/public-catalog";
import { usePublicCatalog } from "../app/unified/use-public-catalog";
import { CatalogInstallIntentStore } from "../app/unified/catalog-install-intent";
import { CatalogInstallSetup } from "../app/unified/CatalogInstallSetup";
import { emptyAccount } from "../integration/data";
import { accountNavigation } from "../integration/unified/policy";
import { entryNavigation } from "../integration/unified/entry-navigation";
import { candidatePageAllowed } from "./policy";
import "../app/redesign.css";

const client = new PublicCatalogClient();
const data = emptyAccount({ name: "Visitor", email: "" });
const noAccount = () => {};

function CandidateApp() {
  const [store] = useState(() => new CatalogInstallIntentStore(() => sessionStorage, "candidate"));
  const readNavigation = () => accountNavigation(entryNavigation(location.pathname, location.search, "/app/"), false);
  const [nav, setNav] = useState(readNavigation);
  const publicData = usePublicCatalog(client, nav, true);
  const select = (next: Navigation) => {
    const safe = accountNavigation(next, false);
    const pending = store.read().intent;
    if (pending && safe.selected && safe.selected !== `catalog:${pending.catalogId}`) store.clear();
    setNav(safe);
    return safe;
  };
  const navigate = (next: Navigation, replace = false) => {
    history[replace ? "replaceState" : "pushState"]({}, "", `/app/${navigationSearch(select(next))}`);
  };
  useEffect(() => {
    const pop = () => select(readNavigation());
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, [store]);
  return <UnifiedApp data={data} catalog={publicData.catalog} publicStatus={publicData.status}
    nav={nav} navigate={navigate} signedIn={false} readOnlyAccount state="ready" retry={publicData.status.retry}
    onSignIn={noAccount} onSession={noAccount} onFavorite={noAccount} onCreateSet={noAccount} onMembership={noAccount} onVisibility={noAccount}
    previewBar={<div className="ua-preview"><span>OMGSkills Candidate · Disposable Mac VM only</span></div>}
    publicInstallAction={(skill, detailReady) => <CatalogInstallSetup key={skill.key} skill={skill}
      detailReady={detailReady} store={store} returnRoute={`/app/?view=discover&skill=${encodeURIComponent(skill.key)}`} />} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode>
  {candidatePageAllowed(location.origin, location.pathname, location.hash) ? <CandidateApp />
    : <main><h1>Candidate test unavailable</h1><p>Use the approved private test page.</p></main>}
</StrictMode>);
