import { useEffect, useState, type ComponentProps } from "react";
import { useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { RefreshCw } from "lucide-react";
import { UnifiedApp } from "../../app/unified/UnifiedApp";
import { initialNavigation, isDiscovery, navigationLocation, navigationSearch, skillDisplays, type Navigation } from "../../app/unified/model";
import { PublicCatalogClient } from "../../app/unified/public-catalog";
import { usePublicCatalog, usePublicCatalogPreload } from "../../app/unified/use-public-catalog";
import { usePortalApi, type PortalApi } from "../../portal-api";
import { emptyAccount, type AccountIdentity } from "../data";
import { useAccount } from "./useAccount";
import { accountNavigation, publicNavigation, unifiedBase } from "./policy";
import { useSetDetail } from "./useSetDetail";
import { useSetCatalog } from "../../app/unified/use-set-catalog";
import { useManagement } from "./useManagement";
import { DevicesPanel } from "../DevicesPanel";
import { PrivateSourcesPanel } from "../PrivateSourcesPanel";
import { ProfilePanel } from "./ProfilePanel";
import { entryNavigation, staticPageAddress, unknownAppAddress } from "./entry-navigation";
import { renderPublicFirst } from "./public-first";
import { announceAppReady } from "../../takeover";
import { createPageMetadata, pageTitle } from "../../app/unified/page-metadata";
import "../../app/redesign.css";
import { LoadingScreen } from "../../app/LoadingScreen";
import { normalInstallAction, normalInstallClient, catalogInstallTestEnabled } from "../../app/unified/public-install";
import { InstallIntentStore } from "../../app/unified/install-intent";
import { PublicInstallSetup } from "../../app/unified/PublicInstallSetup";
import { setupTestDistribution } from "../../app/unified/setup-test-distribution";
import { CatalogInstallIntentStore } from "../../app/unified/catalog-install-intent";
import { CatalogInstallSetup } from "../../app/unified/CatalogInstallSetup";
import { needsAnalyticsDocumentReload, startPublicAnalytics } from "../../app/unified/analytics";
import { isFeatureEnabled } from "../../feature-flags";

const publicClient = new PublicCatalogClient(undefined, undefined, undefined, import.meta.env.VITE_CATALOG_SEARCH_ENABLED === "1");
publicClient.warm();
const installClient = import.meta.env.DEV ? normalInstallClient(import.meta.env.DEV,
  import.meta.env.VITE_NEWMAC_WEB_INSTALL_TEST, location.hostname, import.meta.env.VITE_NEWMAC_CATALOG_INSTALL_TEST) : null;
const catalogInstallEnabled = import.meta.env.DEV ? catalogInstallTestEnabled(import.meta.env.DEV,
  import.meta.env.VITE_NEWMAC_CATALOG_INSTALL_TEST, location.hostname, import.meta.env.VITE_NEWMAC_WEB_INSTALL_TEST) : false;
const rejectEdit = () => { throw new Error("Account editing is disabled in this read-only integration."); };

export type UnifiedSessionComposition = {
  readOnly: boolean;
  adaptApi: (api: PortalApi) => PortalApi;
  navigation: typeof accountNavigation;
  returnUrl: (href: string) => string | null;
  supportedAccountViews: ComponentProps<typeof UnifiedApp>["supportedAccountViews"];
  publicInstallAction: ComponentProps<typeof UnifiedApp>["publicInstallAction"];
  clearInstallIntent: (next: Navigation) => void;
};

function AccountView({ identity, signedIn, accountKey, base, local, connectedInventory, inventoryReconciliation, productionInstall, composition, cleanPaths , takeover }: { identity: AccountIdentity; signedIn: boolean; accountKey: string; base: string; local: boolean; connectedInventory: boolean; inventoryReconciliation: boolean; productionInstall: boolean; composition?: UnifiedSessionComposition; cleanPaths: boolean ; takeover: boolean }) {
  const normalApi = usePortalApi();
  const api = composition ? composition.adaptApi(normalApi) : normalApi;
  const clerk = useClerk();
  const account = useAccount(api, identity, signedIn, accountKey, connectedInventory, inventoryReconciliation, composition?.readOnly);
  const navigation = composition?.navigation ?? accountNavigation;
  const [leaving, setLeaving] = useState(false);
  const [sessionError, setSessionError] = useState("");
  // A broken address falls back to Discover with a short note; the address is then corrected.
  const [unknownEntry] = useState(() => unknownAppAddress(location.pathname, base));
  const [requested, setRequested] = useState(() => unknownEntry
    ? { ...initialNavigation, view: "discover" as const } : entryNavigation(location.pathname, location.search, base));
  const [installStore] = useState(() => !composition && installClient && base === "/app/"
    ? new InstallIntentStore(() => window.sessionStorage, installClient, "normal") : null);
  const [catalogStore] = useState(() => !composition && (catalogInstallEnabled || productionInstall) && base === "/app/"
    ? new CatalogInstallIntentStore(() => window.sessionStorage, productionInstall ? "production" : "f1") : null);
  const clearOtherIntent = (next: Navigation) => {
    composition?.clearInstallIntent(next);
    const pending = installStore?.read().intent;
    if (pending && next.selected && next.selected !== `catalog:${pending.catalogId}`) installStore?.clear();
    const catalogPending = catalogStore?.read().intent;
    if (catalogPending && next.selected && next.selected !== `catalog:${catalogPending.catalogId}`) catalogStore?.clear();
  };
  // Install test flows validate ?view= return routes, so they keep that form.
  const address = (next: Navigation) => `${base}${navigationLocation(next,
    cleanPaths && !installStore && (!catalogStore || catalogStore.client === "production"))}`;
  const available = signedIn && !leaving;
  const nav = navigation(requested, available);
  const publicData = usePublicCatalog(publicClient, publicNavigation(nav), true);
  // On a static library page, swap the app in once its first public view has rendered.
  const listState = publicData.status.list;
  useEffect(() => { if (takeover && listState === "ready") announceAppReady(); }, [takeover, listState]);
  const navigate = (next: Navigation, replace = false) => {
    const safe = navigation(next, available);
    clearOtherIntent(safe);
    const href = address(safe);
    if (needsAnalyticsDocumentReload(href)) {
      window.location[replace ? "replace" : "assign"](href);
      return;
    }
    // Keep the full view in history so Back restores the list behind a skill address.
    history[replace ? "replaceState" : "pushState"]({ nav: safe }, "", href);
    setRequested(safe);
  };
  const current = address(nav);
  useEffect(() => {
    if (!(available || isDiscovery(requested.view))) return;
    // A taken-over static page keeps its own address while it shows that view.
    const here = location.pathname + location.search;
    const keep = staticPageAddress(location.pathname, base)
      && navigationLocation(entryNavigation(location.pathname, location.search, base), true) === navigationLocation(nav, true);
    if (needsAnalyticsDocumentReload(keep ? here : current)) {
      window.location.replace(keep ? here : current);
      return;
    }
    history.replaceState({ nav }, "", keep ? here : current);
  }, [current, available, base, requested.view]);
  useEffect(() => { startPublicAnalytics(); }, [current]);
  useEffect(() => {
    const pop = () => {
      if (needsAnalyticsDocumentReload(location.href)) {
        window.location.reload();
        return;
      }
      const saved = (history.state as { nav?: Navigation } | null)?.nav;
      const next = saved && (address(saved) === location.pathname + location.search || staticPageAddress(location.pathname, base))
        ? saved : entryNavigation(location.pathname, location.search, base);
      clearOtherIntent(next);
      setRequested(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [base, installStore, catalogStore]);
  async function signOut() {
    if (leaving) return;
    setLeaving(true);
    setSessionError("");
    account.clear();
    const next = navigation(nav, false);
    // Clerk's redirect below crosses the privacy boundary after sign-out succeeds.
    if (!needsAnalyticsDocumentReload(address(next))) history.replaceState({ nav: next }, "", address(next));
    setRequested(next);
    // Sign-in and sign-out returns keep the ?view= form; the page rewrites it on arrival.
    try { await clerk.signOut({ redirectUrl: `${base}${navigationSearch(next)}` }); }
    catch { setLeaving(false); setSessionError("Could not sign out. Try again."); account.recover(); }
  }
  const { snapshot } = account;
  const data = available && snapshot.data ? snapshot.data : emptyAccount(available ? identity : { name: "Visitor", email: "" });
  const setId = nav.view === "set" ? nav.id : nav.view === "favorites" ? data.sets.find(set => set.isFavorites && set.role === "owner")?.id ?? "" : "";
  const detail = useSetDetail(api, setId, snapshot.revision, available && !!snapshot.data && !snapshot.accessDenied);
  const setCatalog = useSetCatalog(publicClient, detail.set);
  const catalog = { ...publicData.catalog, skills: [...publicData.catalog.skills, ...setCatalog.skills] };
  // Keep the tab title (and, on a taken-over page, its search tags) in step with the view.
  const [syncMetadata] = useState(() => cleanPaths ? createPageMetadata(document, takeover) : null);
  const title = pageTitle(nav, catalog);
  useEffect(() => { syncMetadata?.(location.pathname + location.search, title); }, [syncMetadata, current, title]);
  const management = useManagement({ data, mine: skillDisplays(data, publicData.catalog).mine,
    busy: snapshot.setSaving || snapshot.profileSaving, blocked: !!composition?.readOnly || !available || !snapshot.data || !!snapshot.error || snapshot.accessDenied,
    scope: `${nav.view}:${nav.id}:${nav.query}`, saveSet: account.saveSet, saveMembership: account.saveMembership,
    detail: { ...detail, catalog: setCatalog }, base, local,
    // Follows skillGroupsAuthEnabled, like the companion's own Set gate.
    installEnabled: isFeatureEnabled(import.meta.env.VITE_SKILLGROUPS_MAC_ENABLED) });
  return <UnifiedApp
    key={available ? accountKey : "public"}
    data={data} catalog={catalog} publicStatus={publicData.status}
    nav={nav} navigate={navigate} signedIn={available}
    publicInstallAction={composition?.publicInstallAction ?? (installClient && installStore ? (skill, detailReady) => <PublicInstallSetup
      key={skill.key} skill={skill} detailReady={detailReady} client={installClient} store={installStore}
      returnRoute={`/app/?view=discover&skill=${encodeURIComponent(skill.key)}`}
      action={normalInstallAction} distribution={setupTestDistribution} />
      : catalogStore ? (skill, detailReady) => <CatalogInstallSetup key={skill.key}
        skill={skill} detailReady={detailReady} store={catalogStore}
        returnRoute={`/app/?view=discover&skill=${encodeURIComponent(skill.key)}`} /> : undefined)}
    onInstallCancel={() => catalogStore?.clear()}
    readOnlyAccount
    initialNotice={unknownEntry ? "That page wasn't found, so here's Discover." : ""}
    supportedAccountViews={composition?.supportedAccountViews}
    management={available && !composition?.readOnly ? management : undefined}
    onSignIn={() => {
      const href = `${location.origin}${base}${navigationSearch(requested)}`;
      const returnUrl = composition ? composition.returnUrl(href) : href;
      if (returnUrl) void clerk.openSignIn({ forceRedirectUrl: returnUrl });
    }}
    onSession={next => { if (!next) void signOut(); }}
    onFavorite={rejectEdit} onCreateSet={rejectEdit} onMembership={rejectEdit} onVisibility={rejectEdit}
    state={!available || snapshot.data ? "ready" : snapshot.error ? "error" : "loading"}
    retry={account.refresh}
    accountPages={available && !snapshot.accessDenied ? (view, theme) => view === "profile" && !composition?.readOnly ? <ProfilePanel profile={data.profile} theme={theme}
      busy={snapshot.profileSaving || snapshot.setSaving || snapshot.refreshing}
      blocked={!!snapshot.error || !snapshot.data || snapshot.accessDenied}
      error={snapshot.profileError || snapshot.error} save={account.saveProfile} settings={() => clerk.openUserProfile()} />
      : view === "devices" ? <div className="portal-design ua-connected-panel"><DevicesPanel key={accountKey} sessionKey={accountKey} api={api} local={local} readOnly={composition?.readOnly} browserConnection={productionInstall} denied={account.invalidate} theme={theme} inventoryDevices={connectedInventory ? data.devices : undefined} /></div>
      : view === "github" && !composition?.readOnly ? <div className="portal-design ua-connected-panel"><PrivateSourcesPanel api={api} local={local} denied={account.invalidate} /></div> : undefined : undefined}
    previewBar={(local || sessionError || (available && (snapshot.error || composition?.readOnly))) && <div className="ua-preview">
      {local && <span>Local test · Unified app</span>}
      <div>
        {(sessionError || (available && snapshot.error)) && <span role="alert">{sessionError || snapshot.error}</span>}
        {available && <button type="button" className="ua-icon" title="Refresh account" aria-label="Refresh account" disabled={snapshot.refreshing || leaving} onClick={account.refresh}><RefreshCw /></button>}
      </div>
    </div>}
  />;
}

export function UnifiedSession({ base = unifiedBase, local = true, connectedInventory = false, inventoryReconciliation = false, productionInstall = false, composition, cleanPaths = false, publicFirst = false, takeover = false }: { base?: string; local?: boolean; connectedInventory?: boolean; inventoryReconciliation?: boolean; productionInstall?: boolean; composition?: UnifiedSessionComposition; cleanPaths?: boolean; publicFirst?: boolean; takeover?: boolean }) {
  const [entry] = useState(() => unknownAppAddress(location.pathname, base)
    ? { ...initialNavigation, view: "discover" as const } : entryNavigation(location.pathname, location.search, base));
  const [publicEntry] = useState(() => accountNavigation(entry, false));
  const [showPublicFirst] = useState(() => renderPublicFirst(publicFirst && !composition, entry, () => document.cookie));
  usePublicCatalogPreload(publicClient, publicEntry);
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const loading = !isLoaded || (isSignedIn && !userLoaded);
  if (loading && !(showPublicFirst && !isSignedIn)) return <LoadingScreen />;
  // While sign-in loads, the public view uses the same "signed-out" key, so it stays
  // mounted if the visitor is signed out and remounts only if a session appears.
  const key = !loading && isSignedIn ? `${userId}:${sessionId}` : "signed-out";
  return <AccountView key={key} accountKey={key} signedIn={!loading && !!isSignedIn} base={base} local={local} connectedInventory={connectedInventory} inventoryReconciliation={inventoryReconciliation} productionInstall={productionInstall} composition={composition} cleanPaths={cleanPaths && !composition} takeover={takeover && !composition}
    identity={{ name: user?.fullName || user?.primaryEmailAddress?.emailAddress || "Your account", email: user?.primaryEmailAddress?.emailAddress || "" }} />;
}
