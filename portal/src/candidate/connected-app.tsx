import { useEffect, useRef, useState } from "react";
import { ClerkProvider, useAuth, useClerk } from "@clerk/clerk-react";
import { ConnectPage } from "../ConnectPage";
import { LoadingScreen } from "../app/LoadingScreen";
import { CatalogInstallIntentStore } from "../app/unified/catalog-install-intent";
import { CatalogInstallSetup } from "../app/unified/CatalogInstallSetup";
import { UnifiedSession, type UnifiedSessionComposition } from "../integration/unified/Session";
import { connectedCandidateBrowserApi, connectedCandidateConsent, connectedCandidateNavigation,
  connectedCandidateReturnUrl, requireConnectedCandidateBrowser } from "./connected-policy";

export type ConnectedCandidateInput = Parameters<typeof requireConnectedCandidateBrowser>[0];
export const connectedAccountViews = ["all", "agents", "devices", "profile"] as const;

function Unavailable() {
  return <main><h1>Connected candidate unavailable</h1><p>Use the approved test page and configuration.</p></main>;
}

export function ConnectionSignIn({ href, signIn }: { href: string; signIn: (returnUrl: string) => void }) {
  return <main className="shell auth-shell connect-shell"><section className="connect-panel">
    <h1>Connect this Mac</h1><p>Sign in to review this connection request.</p>
    <button type="button" onClick={() => {
      const returnUrl = connectedCandidateReturnUrl(href);
      if (returnUrl && window.location.href === href) signIn(returnUrl);
    }}>Sign in</button>
  </section></main>;
}

export function ConnectedConsent({ href }: { href: string }) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const clerk = useClerk();
  const requestKey = `${isLoaded}:${isSignedIn}:${userId}:${sessionId}:${href}`;
  const current = useRef(requestKey);
  current.current = requestKey;
  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <ConnectionSignIn href={href} signIn={returnUrl => { void clerk.openSignIn({ forceRedirectUrl: returnUrl }); }} />;
  return <ConnectPage key={requestKey} pendingHash={new URL(href).hash}
    isCurrent={() => current.current === requestKey && window.location.href === href}
    policy={connectedCandidateConsent} adaptApi={connectedCandidateBrowserApi} />;
}

export function ConnectedAccount() {
  const [store] = useState(() => new CatalogInstallIntentStore(() => window.sessionStorage, "candidate"));
  const composition: UnifiedSessionComposition = {
    readOnly: true, adaptApi: connectedCandidateBrowserApi, navigation: connectedCandidateNavigation,
    returnUrl: connectedCandidateReturnUrl, supportedAccountViews: connectedAccountViews,
    clearInstallIntent: next => {
      const pending = store.read().intent;
      if (pending && next.selected && next.selected !== `catalog:${pending.catalogId}`) store.clear();
    },
    publicInstallAction: (skill, detailReady) => <CatalogInstallSetup key={skill.key} skill={skill} detailReady={detailReady}
      store={store} returnRoute={`/app/?view=discover&skill=${encodeURIComponent(skill.key)}`} />,
  };
  return <UnifiedSession base="/app/" local={false} connectedInventory inventoryReconciliation composition={composition} />;
}

// The invalid branch must run before Clerk or any account hooks are mounted.
export function ConnectedCandidateApp({ configuration }: { configuration: ConnectedCandidateInput }) {
  const [href, setHref] = useState(() => window.location.href);
  useEffect(() => {
    const changed = () => setHref(window.location.href);
    window.addEventListener("hashchange", changed);
    window.addEventListener("popstate", changed);
    return () => {
      window.removeEventListener("hashchange", changed);
      window.removeEventListener("popstate", changed);
    };
  }, []);
  let validated: ReturnType<typeof requireConnectedCandidateBrowser>;
  try { validated = requireConnectedCandidateBrowser(configuration, href); }
  catch { return <Unavailable />; }
  return <ClerkProvider publishableKey={validated.publishableKey}>
    {validated.route === "connect" ? <ConnectedConsent key={validated.returnUrl} href={validated.returnUrl} /> : <ConnectedAccount />}
  </ClerkProvider>;
}
