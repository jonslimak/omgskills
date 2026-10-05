import { useEffect, useState } from "react";
import { useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { RefreshCw } from "lucide-react";
import { UnifiedApp } from "../../app/unified/UnifiedApp";
import { navigationSearch, parseNavigation, type Navigation } from "../../app/unified/model";
import { PublicCatalogClient } from "../../app/unified/public-catalog";
import { usePublicCatalog } from "../../app/unified/use-public-catalog";
import { usePortalApi } from "../../portal-api";
import { emptyAccount, type AccountIdentity } from "../data";
import { useAccount } from "./useAccount";
import { accountNavigation, publicNavigation, unifiedBase } from "./policy";

const publicClient = new PublicCatalogClient();
const rejectEdit = () => { throw new Error("Account editing is disabled in this read-only integration."); };

function AccountView({ identity, signedIn, accountKey }: { identity: AccountIdentity; signedIn: boolean; accountKey: string }) {
  const api = usePortalApi();
  const clerk = useClerk();
  const account = useAccount(api, identity, signedIn, accountKey);
  const [leaving, setLeaving] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [requested, setRequested] = useState(() => parseNavigation(location.search));
  const available = signedIn && !leaving;
  const nav = accountNavigation(requested, available);
  const publicData = usePublicCatalog(publicClient, publicNavigation(nav), true);
  const navigate = (next: Navigation, replace = false) => {
    const safe = accountNavigation(next, available);
    history[replace ? "replaceState" : "pushState"]({}, "", `${unifiedBase}${navigationSearch(safe)}`);
    setRequested(safe);
  };
  const search = navigationSearch(nav);
  useEffect(() => {
    history.replaceState({}, "", `${unifiedBase}${search}`);
  }, [search]);
  useEffect(() => {
    const pop = () => setRequested(parseNavigation(location.search));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  async function signOut() {
    if (leaving) return;
    setLeaving(true);
    setSessionError("");
    account.clear();
    const next = accountNavigation(nav, false);
    history.replaceState({}, "", `${unifiedBase}${navigationSearch(next)}`);
    setRequested(next);
    try { await clerk.signOut({ redirectUrl: `${unifiedBase}${navigationSearch(next)}` }); }
    catch { setLeaving(false); setSessionError("Could not sign out. Try again."); account.recover(); }
  }
  const { snapshot } = account;
  const data = available && snapshot.data ? snapshot.data : emptyAccount(available ? identity : { name: "Visitor", email: "" });
  return <UnifiedApp
    key={available ? accountKey : "public"}
    data={data} catalog={publicData.catalog} publicStatus={publicData.status}
    nav={nav} navigate={navigate} signedIn={available}
    readOnlyAccount
    onSignIn={() => { void clerk.openSignIn({ forceRedirectUrl: `${location.origin}${unifiedBase}${navigationSearch(nav)}` }); }}
    onSession={next => { if (!next) void signOut(); }}
    onFavorite={rejectEdit} onCreateSet={rejectEdit} onMembership={rejectEdit} onVisibility={rejectEdit}
    state={!available || snapshot.data ? "ready" : snapshot.error ? "error" : "loading"}
    retry={account.refresh}
    previewBar={<div className="ua-preview">
      <span>Local test · read-only account</span>
      <div>
        {(sessionError || (available && snapshot.error)) && <span role="alert">{sessionError || snapshot.error}</span>}
        {available && <button type="button" className="ua-icon" title="Refresh account" aria-label="Refresh account" disabled={snapshot.refreshing || leaving} onClick={account.refresh}><RefreshCw /></button>}
      </div>
    </div>}
  />;
}

export function UnifiedSession() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  if (!isLoaded || (isSignedIn && !userLoaded)) return <p role="status">Loading account...</p>;
  const key = isSignedIn ? `${userId}:${sessionId}` : "signed-out";
  return <AccountView key={key} accountKey={key} signedIn={!!isSignedIn}
    identity={{ name: user?.fullName || user?.primaryEmailAddress?.emailAddress || "Your account", email: user?.primaryEmailAddress?.emailAddress || "" }} />;
}
