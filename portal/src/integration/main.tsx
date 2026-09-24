import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  SignInButton,
  useAuth,
  useUser,
  useClerk,
} from "@clerk/clerk-react";
import { RefreshCw } from "lucide-react";
import { PortalApp } from "../app/PortalApp";
import { Action, IconAction } from "../app/ui";
import type { PortalActions, PortalSet } from "../app/model";
import { SetControls } from "./SetControls";
import type { SetCommand } from "./set-data";
import { ReadOnlySetDetail } from "./ReadOnlySetDetail";
import { ProfileDialog } from "./ProfileDialog";
import { usePortalApi } from "../portal-api";
import { emptyAccount, type AccountIdentity } from "./data";
import { integrationConfigurationError } from "./gate";
import { accountCacheKey, createAccountSession, type AccountSnapshot } from "./account-session";
import "../styles.css";
import "../app/redesign.css";

const base = "/app/integration/";
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const configurationError = integrationConfigurationError({
  ready: import.meta.env.VITE_PORTAL_INTEGRATION_READY === true,
  publishableKey,
  webEnabled: import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED,
});

function localStorageForAccount() {
  try { return window.sessionStorage; } catch { return undefined; }
}

function Account({ identity, cacheKey, sessionId }: { identity: AccountIdentity; cacheKey: string; sessionId: string }) {
  const api = usePortalApi();
  const clerk = useClerk();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [snapshot, setSnapshot] = useState<AccountSnapshot>({ data: null, refreshing: true, error: "", accessDenied: false, revision: 0, profileSaving: false, profileError: "", setSaving: false });
  const [detail, setDetail] = useState<{ set: PortalSet | null; revision: number } | null>(null);
  const loaded = useCallback((set: PortalSet | null) => setDetail({ set, revision: snapshot.revision }), [snapshot.revision]);
  const detailSet = detail?.revision === snapshot.revision ? detail.set : null;
  const sessionRef = useRef<ReturnType<typeof createAccountSession> | null>(null);
  const [recovery, setRecovery] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notice, notify] = useState("");

  useEffect(() => {
    const session = createAccountSession({
      api: (path, init) => apiRef.current(path, init), identity, cacheKey,
      storage: localStorageForAccount(), changed: setSnapshot,
    });
    sessionRef.current = session;
    setSnapshot(session.getSnapshot());
    void session.refresh();
    const onActive = () => { if (!document.hidden) void session.refresh(true); };
    window.addEventListener("focus", onActive);
    document.addEventListener("visibilitychange", onActive);
    return () => {
      session.dispose(false);
      if (sessionRef.current === session) sessionRef.current = null;
      window.removeEventListener("focus", onActive);
      document.removeEventListener("visibilitychange", onActive);
    };
  }, [cacheKey, recovery, identity.name, identity.email]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    sessionRef.current?.dispose();
    setProfileOpen(false);
    setSnapshot({ data: null, refreshing: false, error: "", accessDenied: false, revision: 0, profileSaving: false, profileError: "", setSaving: false });
    try { await clerk.signOut({ sessionId, redirectUrl: base }); }
    catch {
      setSigningOut(false);
      notify("Could not sign out. Please try again.");
      setRecovery((value) => value + 1);
    }
  }

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => notify(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const unavailable = () =>
    notify("Membership and device changes are not enabled yet.");
  const actions: PortalActions = {
    updateSet: unavailable,
    createSet: unavailable,
    deleteSet: unavailable,
    membership: unavailable,
    revoke: unavailable,
    updateProfile: unavailable,
    retry: () => { void sessionRef.current?.refresh(); },
  };
  const data = snapshot.data ?? emptyAccount(identity);
  async function saveProfile(changes: { handle?: string; published?: boolean }) {
    const session = sessionRef.current;
    if (!session) throw new Error("Account is not ready.");
    await session.saveProfile(changes);
    if (sessionRef.current !== session) return;
    setProfileOpen(false);
    notify("Profile saved locally.");
  }
  async function saveSet(command: SetCommand) {
    const session = sessionRef.current;
    if (!session) throw new Error("Account is not ready.");
    const result = await session.saveSet(command);
    if (sessionRef.current !== session) throw new DOMException("Account changed", "AbortError");
    return result;
  }
  return (
    <>
    <PortalApp
      data={data}
      actions={actions}
      state={signingOut ? "loading" : snapshot.data ? "ready" : snapshot.error ? "error" : "loading"}
      base={base}
      readOnly
      detailSet={detailSet}
      setControls={(page, id, navigate) => <SetControls key={`${page}:${id ?? ""}`} page={page}
        set={detailSet?.id === id ? detailSet : null}
        blocked={snapshot.refreshing || snapshot.profileSaving || signingOut || Boolean(snapshot.error)}
        saving={snapshot.setSaving} save={saveSet} navigate={navigate} notify={notify} />}
      accountControls={{ settings: () => clerk.openUserProfile(), signOut: () => { void signOut(); }, busy: signingOut }}
      profileControls={{ edit: () => setProfileOpen(true),
        publish: (published) => { void saveProfile({ published }).catch(() => {}); },
        busy: snapshot.profileSaving || snapshot.setSaving || snapshot.refreshing || signingOut || Boolean(snapshot.error),
        error: snapshot.profileError,
        copy: () => {
          if (data.profile.publicUrl) void navigator.clipboard.writeText(data.profile.publicUrl)
            .then(() => notify("Profile link copied."), () => notify("Could not copy the link."));
        },
      }}
      refreshControl={<IconAction label="Refresh account" disabled={snapshot.refreshing || snapshot.profileSaving || snapshot.setSaving || signingOut}
        onClick={() => { void sessionRef.current?.refresh(); }}>
        <RefreshCw className={snapshot.refreshing ? "rd-spin" : undefined} />
      </IconAction>}
      notice={notice}
      notify={notify}
      previewBar={
        <div className="rd-preview-bar" role="status">
          <span>Local integration · changes stay local</span>
          {snapshot.error && <span role="alert">{snapshot.error}</span>}
          {snapshot.accessDenied && <Action onClick={() => { void signOut(); }} disabled={signingOut}>Sign out</Action>}
        </div>
      }
      renderDetail={(id) => (
        <ReadOnlySetDetail
          key={`${id}:${snapshot.revision}`}
          groupId={id}
          api={api}
          actions={actions}
          hasSummary={data.sets.some((set) => set.id === id)}
          loaded={loaded}
        />
      )}
    />
    {profileOpen && snapshot.data && !snapshot.accessDenied && <ProfileDialog
      handle={data.profile.handle} saving={snapshot.profileSaving} blocked={Boolean(snapshot.error)}
      error={snapshot.profileError} close={() => setProfileOpen(false)}
      save={(handle) => saveProfile({ handle })} />}
    </>
  );
}

function Session() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { user } = useUser();
  const cacheKey = isSignedIn && userId && sessionId ? accountCacheKey(publishableKey!, userId, sessionId) : null;
  const previousKey = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoaded) return;
    if (previousKey.current && previousKey.current !== cacheKey) {
      try { localStorageForAccount()?.removeItem(previousKey.current); } catch { /* Best effort. */ }
    }
    previousKey.current = cacheKey;
  }, [cacheKey, isLoaded]);
  if (!isLoaded || (isSignedIn && !user))
    return <Entry title="Loading account..." />;
  if (!isSignedIn || !user || !userId || !cacheKey || !sessionId)
    return (
      <Entry title="Sign in to the test portal">
        <SignInButton mode="modal" forceRedirectUrl={window.location.href}>
          <Action variant="default">Sign in</Action>
        </SignInButton>
      </Entry>
    );
  return (
    <Account
      key={`${userId}:${sessionId}`}
      cacheKey={cacheKey}
      sessionId={sessionId}
      identity={{
        name:
          user.fullName || user.primaryEmailAddress?.emailAddress || "Account",
        email: user.primaryEmailAddress?.emailAddress || "",
      }}
    />
  );
}

function Entry({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="portal-design rd-integration-entry">
      <p className="rd-muted">Local integration</p>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {configurationError ? (
      <Entry title="Test environment required">
        <p>{configurationError}</p>
      </Entry>
    ) : (
      <ClerkProvider publishableKey={publishableKey!}>
        <Session />
      </ClerkProvider>
    )}
  </StrictMode>,
);
