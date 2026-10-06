import { useEffect, useState } from "react";
import { useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { RefreshCw } from "lucide-react";
import { UnifiedApp } from "../../app/unified/UnifiedApp";
import { navigationSearch, skillDisplays, type Navigation } from "../../app/unified/model";
import { PublicCatalogClient } from "../../app/unified/public-catalog";
import { usePublicCatalog } from "../../app/unified/use-public-catalog";
import { usePortalApi } from "../../portal-api";
import { emptyAccount, type AccountIdentity } from "../data";
import { useAccount } from "./useAccount";
import { accountNavigation, publicNavigation, unifiedBase } from "./policy";
import { useSetDetail } from "./useSetDetail";
import { useManagement } from "./useManagement";
import { DevicesPanel } from "../DevicesPanel";
import { PrivateSourcesPanel } from "../PrivateSourcesPanel";
import { ProfilePanel } from "./ProfilePanel";
import { entryNavigation } from "./entry-navigation";
import "../../app/redesign.css";

const publicClient = new PublicCatalogClient();
const rejectEdit = () => { throw new Error("Account editing is disabled in this read-only integration."); };

function AccountView({ identity, signedIn, accountKey, base, local }: { identity: AccountIdentity; signedIn: boolean; accountKey: string; base: string; local: boolean }) {
  const api = usePortalApi();
  const clerk = useClerk();
  const account = useAccount(api, identity, signedIn, accountKey);
  const [leaving, setLeaving] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [requested, setRequested] = useState(() => entryNavigation(location.pathname, location.search, base));
  const available = signedIn && !leaving;
  const nav = accountNavigation(requested, available);
  const publicData = usePublicCatalog(publicClient, publicNavigation(nav), true);
  const navigate = (next: Navigation, replace = false) => {
    const safe = accountNavigation(next, available);
    history[replace ? "replaceState" : "pushState"]({}, "", `${base}${navigationSearch(safe)}`);
    setRequested(safe);
  };
  const search = navigationSearch(nav);
  useEffect(() => {
    if (available || requested.view === "discover") history.replaceState({}, "", `${base}${search}`);
  }, [search, available, base, requested.view]);
  useEffect(() => {
    const pop = () => setRequested(entryNavigation(location.pathname, location.search, base));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [base]);
  async function signOut() {
    if (leaving) return;
    setLeaving(true);
    setSessionError("");
    account.clear();
    const next = accountNavigation(nav, false);
    history.replaceState({}, "", `${base}${navigationSearch(next)}`);
    setRequested(next);
    try { await clerk.signOut({ redirectUrl: `${base}${navigationSearch(next)}` }); }
    catch { setLeaving(false); setSessionError("Could not sign out. Try again."); account.recover(); }
  }
  const { snapshot } = account;
  const data = available && snapshot.data ? snapshot.data : emptyAccount(available ? identity : { name: "Visitor", email: "" });
  const setId = nav.view === "set" ? nav.id : nav.view === "favorites" ? data.sets.find(set => set.isFavorites && set.role === "owner")?.id ?? "" : "";
  const detail = useSetDetail(api, setId, snapshot.revision, available && !!snapshot.data && !snapshot.accessDenied);
  const management = useManagement({ data, mine: skillDisplays(data, publicData.catalog).mine,
    busy: snapshot.setSaving || snapshot.profileSaving, blocked: !available || !snapshot.data || !!snapshot.error || snapshot.accessDenied,
    scope: `${nav.view}:${nav.id}:${nav.query}`, saveSet: account.saveSet, saveMembership: account.saveMembership, detail, base, local });
  return <UnifiedApp
    key={available ? accountKey : "public"}
    data={data} catalog={publicData.catalog} publicStatus={publicData.status}
    nav={nav} navigate={navigate} signedIn={available}
    readOnlyAccount
    management={available ? management : undefined}
    onSignIn={() => { void clerk.openSignIn({ forceRedirectUrl: `${location.origin}${base}${navigationSearch(requested)}` }); }}
    onSession={next => { if (!next) void signOut(); }}
    onFavorite={rejectEdit} onCreateSet={rejectEdit} onMembership={rejectEdit} onVisibility={rejectEdit}
    state={!available || snapshot.data ? "ready" : snapshot.error ? "error" : "loading"}
    retry={account.refresh}
    accountPages={available ? (view, theme) => view === "profile" ? <ProfilePanel profile={data.profile} theme={theme}
      busy={snapshot.profileSaving || snapshot.setSaving || snapshot.refreshing || !!snapshot.error || !snapshot.data}
      error={snapshot.profileError} save={account.saveProfile} settings={() => clerk.openUserProfile()} />
      : view === "devices" ? <div className="portal-design ua-connected-panel"><DevicesPanel api={api} local={local} denied={account.invalidate} /></div>
      : view === "github" ? <div className="portal-design ua-connected-panel"><PrivateSourcesPanel api={api} local={local} denied={account.invalidate} /></div> : undefined : undefined}
    previewBar={(local || available || sessionError) && <div className="ua-preview">
      {local && <span>Local test · Unified app</span>}
      <div>
        {(sessionError || (available && snapshot.error)) && <span role="alert">{sessionError || snapshot.error}</span>}
        {available && <button type="button" className="ua-icon" title="Refresh account" aria-label="Refresh account" disabled={snapshot.refreshing || leaving} onClick={account.refresh}><RefreshCw /></button>}
      </div>
    </div>}
  />;
}

export function UnifiedSession({ base = unifiedBase, local = true }: { base?: string; local?: boolean }) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  if (!isLoaded || (isSignedIn && !userLoaded)) return <p role="status">Loading account...</p>;
  const key = isSignedIn ? `${userId}:${sessionId}` : "signed-out";
  return <AccountView key={key} accountKey={key} signedIn={!!isSignedIn} base={base} local={local}
    identity={{ name: user?.fullName || user?.primaryEmailAddress?.emailAddress || "Your account", email: user?.primaryEmailAddress?.emailAddress || "" }} />;
}
