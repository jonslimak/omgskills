import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignInButton, useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { PortalAccount, PortalEntry } from "../account/PortalSession";
import { accountCacheKey } from "../integration/account-session";
import { usePortalApi } from "../portal-api";
import { Action } from "../app/ui";
import { isFeatureEnabled } from "../feature-flags";
import { reviewReadApi } from "./policy";
import { createReviewSetTest } from "./set-test";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const base = "/app/review/";

function ReviewAccess({ identityKey }: { identityKey: string }) {
  const api = usePortalApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const setTest = useMemo(() => {
    try { return createReviewSetTest((path, init) => apiRef.current(path, init), window.sessionStorage, identityKey); }
    catch { return null; }
  }, [identityKey]);
  const { user } = useUser();
  const clerk = useClerk();
  const { sessionId } = useAuth();
  const [state, setState] = useState<"checking" | "allowed" | "denied">("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState("checking");
    void apiRef.current<{ allowed?: boolean }>("/api/portal/review-access", {
      signal: controller.signal, cache: "no-store", redirect: "error",
    }).then((result) => {
      if (!controller.signal.aborted) setState(result?.allowed === true ? "allowed" : "denied");
    }).catch(() => { if (!controller.signal.aborted) setState("denied"); });
    return () => controller.abort();
  }, [attempt]);
  const signOut = () => clerk.signOut({ sessionId: sessionId!, redirectUrl: base });
  if (state !== "allowed" || !user) return <PortalEntry local={false}
    title={state === "checking" ? "Checking review access..." : "Review unavailable"}>
    {state === "denied" && <><Action onClick={() => setAttempt((value) => value + 1)}>Try again</Action>
      <Action onClick={() => { void signOut(); }}>Sign out</Action></>}
  </PortalEntry>;
  return <PortalAccount base={base} local={false} installEnabled={false} readOnlyReview
    reviewSetEditing={setTest?.ownsSet}
    cacheKey={identityKey} api={setTest?.api ?? reviewReadApi(api)} onSignOut={signOut} onSettings={() => {}}
    identity={{ name: user.fullName || user.primaryEmailAddress?.emailAddress || "Account",
      email: user.primaryEmailAddress?.emailAddress || "" }} />;
}

function Review() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  if (!isLoaded) return <PortalEntry local={false} title="Loading account..." />;
  if (!isSignedIn || !userId || !sessionId) return <PortalEntry local={false} title="Sign in to review omgskills">
    <SignInButton mode="modal" forceRedirectUrl={window.location.href}><Action>Sign in</Action></SignInButton>
  </PortalEntry>;
  const key = accountCacheKey(publishableKey!, userId, sessionId, "review");
  return <ReviewAccess key={key} identityKey={key} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode>
  {isFeatureEnabled(import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED) && publishableKey?.startsWith("pk_live_")
    ? <ClerkProvider publishableKey={publishableKey}><Review /></ClerkProvider>
    : <PortalEntry local={false} title="Review unavailable" />}
</StrictMode>);
