import { useCallback, useEffect, useRef, useState } from "react";
import {
  SignInButton,
  SignUpButton,
  useAuth,
  useUser,
  useClerk,
} from "@clerk/clerk-react";
import { RefreshCw } from "lucide-react";
import { PortalApp } from "../app/PortalApp";
import { Action, IconAction } from "../app/ui";
import type { PortalActions, PortalSet } from "../app/model";
import { SetControls } from "../integration/SetControls";
import { DevicesPanel } from "../integration/DevicesPanel";
import { PrivateSourcesPanel } from "../integration/PrivateSourcesPanel";
import type { SetCommand, EmailCommand } from "../integration/set-data";
import { SetAccessControls } from "../integration/SetAccessControls";
import { setLink } from "../app/set-link";
import { useMembershipControls } from "../integration/useMembershipControls";
import type { MembershipCommand } from "../integration/membership-data";
import { groupSyncedSkills } from "../synced-skill-grouping";
import { ReadOnlySetDetail } from "../integration/ReadOnlySetDetail";
import { ProfileDialog } from "../integration/ProfileDialog";
import { usePortalApi, type PortalApi } from "../portal-api";
import { emptyAccount, type AccountIdentity } from "../integration/data";
import { accountCacheKey, createAccountSession, type AccountSnapshot } from "../integration/account-session";
import "../styles.css";
import "../app/redesign.css";

type PortalOptions = { base: string; local: boolean; installEnabled: boolean };

function localStorageForAccount() {
  try { return window.sessionStorage; } catch { return undefined; }
}

export function PortalAccount({ identity, cacheKey, base, local, installEnabled, api, onSignOut, onSettings, readOnlyReview = false }: PortalOptions & {
  identity: AccountIdentity; cacheKey: string; api: PortalApi; onSignOut: () => Promise<void>; onSettings: () => void;
  readOnlyReview?: boolean;
}) {
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
      storage: readOnlyReview ? undefined : localStorageForAccount(), changed: setSnapshot,
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
  }, [cacheKey, recovery, identity.name, identity.email, readOnlyReview]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    sessionRef.current?.dispose();
    setProfileOpen(false);
    membership.dismiss();
    setSnapshot({ data: null, refreshing: false, error: "", accessDenied: false, revision: 0, profileSaving: false, profileError: "", setSaving: false });
    try { await onSignOut(); }
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
    notify("This action is not connected yet.");
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
    notify(local ? "Profile saved locally." : "Profile saved.");
  }
  async function saveSet(command: SetCommand) {
    const session = sessionRef.current;
    if (!session) throw new Error("Account is not ready.");
    const result = await session.saveSet(command);
    if (sessionRef.current !== session) throw new DOMException("Account changed", "AbortError");
    return result;
  }
  async function saveMembership(command: MembershipCommand) {
    const session = sessionRef.current;
    if (!session) throw new Error("Account is not ready.");
    const result = await session.saveMembership(command);
    if (sessionRef.current !== session) throw new DOMException("Account changed", "AbortError");
    return result;
  }
  async function saveEmail(command: EmailCommand) {
    const origin = location.pathname;
    const result = await saveSet(command);
    if (location.pathname === origin) notify(result.refreshed
      ? command.kind === "add-email" ? "Email access added. No email sent." : "Saved email removed."
      : "Saved. Refresh to confirm the latest access records.");
    return result;
  }
  const membership = useMembershipControls({ data,
    busy: snapshot.setSaving || snapshot.profileSaving,
    blocked: snapshot.refreshing || signingOut || Boolean(snapshot.error) || !snapshot.data,
    save: saveMembership, refresh: () => { void sessionRef.current?.refresh(); }, notify });
  return (
    <>
    <PortalApp
      data={data}
      actions={actions}
      state={signingOut ? "loading" : snapshot.data ? "ready" : snapshot.error ? "error" : "loading"}
      base={base}
      readOnly
      detailSet={detailSet}
      membership={readOnlyReview ? undefined : membership.controls}
      devicesPanel={<DevicesPanel api={api} local={local} readOnly={readOnlyReview} denied={() => sessionRef.current?.invalidateAccess()} />}
      privateSourcesPanel={readOnlyReview ? undefined : <PrivateSourcesPanel api={api} local={local} denied={() => sessionRef.current?.invalidateAccess()} />}
      onNavigate={membership.dismiss}
      setControls={readOnlyReview ? undefined : (page, id, navigate) => <SetControls key={`${page}:${id ?? ""}`} page={page} local={local} installEnabled={installEnabled}
        set={detailSet?.id === id ? detailSet : null}
        link={detailSet && detailSet.id === id ? setLink(detailSet, data.profile, location.origin, base, local) : undefined}
        blocked={snapshot.refreshing || snapshot.profileSaving || signingOut || Boolean(snapshot.error)}
        saving={snapshot.setSaving} save={saveSet} navigate={navigate} notify={notify} />}
      accountControls={{ settings: onSettings, settingsDisabled: readOnlyReview, signOut: () => { void signOut(); }, busy: signingOut }}
      profileControls={{ edit: () => setProfileOpen(true),
        publish: (published) => { void saveProfile({ published }).catch(() => {}); },
        busy: readOnlyReview || snapshot.profileSaving || snapshot.setSaving || snapshot.refreshing || signingOut || Boolean(snapshot.error),
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
        (readOnlyReview || local || snapshot.error || membership.error || snapshot.accessDenied) && <div className="portal-design rd-preview-bar" role="status">
          {readOnlyReview && <span>Production review · read-only</span>}
          {local && <span>Local integration · changes stay local</span>}
          {snapshot.error && <span role="alert">{snapshot.error}</span>}
          {membership.error && <span role="alert">{membership.error}</span>}
          {snapshot.accessDenied && <Action onClick={() => { void signOut(); }} disabled={signingOut}>Sign out</Action>}
        </div>
      }
      renderDetail={(id, edit) => (
        <ReadOnlySetDetail
          key={`${id}:${snapshot.revision}`}
          groupId={id}
          api={api}
          actions={actions}
          hasSummary={data.sets.some((set) => set.id === id)}
          loaded={loaded}
          membership={readOnlyReview ? undefined : membership.controls}
          edit={!readOnlyReview && edit}
          sets={data.sets}
          skills={groupSyncedSkills(data.skills)}
          renderAccess={readOnlyReview ? undefined : (set) => <SetAccessControls set={set} busy={snapshot.setSaving || snapshot.profileSaving}
            blocked={snapshot.refreshing || signingOut || Boolean(snapshot.error)} save={saveEmail} />}
        />
      )}
    />
    {!readOnlyReview && snapshot.data && !snapshot.accessDenied && membership.dialog}
    {!readOnlyReview && profileOpen && snapshot.data && !snapshot.accessDenied && <ProfileDialog
      handle={data.profile.handle} saving={snapshot.profileSaving} blocked={Boolean(snapshot.error)}
      error={snapshot.profileError} close={() => setProfileOpen(false)}
      save={(handle) => saveProfile({ handle })} />}
    </>
  );
}

export function PortalSession({ publishableKey, base, local, installEnabled }: PortalOptions & { publishableKey: string }) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { user } = useUser();
  const api = usePortalApi();
  const clerk = useClerk();
  const cacheEnvironment = local ? base === "/app/integration/" ? "integration" : "local-app" : "app";
  const cacheKey = isSignedIn && userId && sessionId ? accountCacheKey(publishableKey, userId, sessionId, cacheEnvironment) : null;
  const previousKey = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoaded) return;
    if (previousKey.current && previousKey.current !== cacheKey) {
      try { localStorageForAccount()?.removeItem(previousKey.current); } catch { /* Best effort. */ }
    }
    previousKey.current = cacheKey;
  }, [cacheKey, isLoaded]);
  if (!isLoaded || (isSignedIn && !user))
    return <PortalEntry local={local} title="Loading account..." />;
  if (!isSignedIn || !user || !userId || !cacheKey || !sessionId)
    return (
      <PortalEntry local={local} title={local ? "Sign in to the test portal" : "Sign in to omgskills"}>
        <SignInButton mode="modal" forceRedirectUrl={window.location.href}>
          <Action variant="default">Sign in</Action>
        </SignInButton>
        {!local && <SignUpButton mode="modal" forceRedirectUrl={window.location.href}>
          <Action>Create account</Action>
        </SignUpButton>}
      </PortalEntry>
    );
  return (
    <PortalAccount
      key={`${local}:${base}:${userId}:${sessionId}`}
      base={base}
      local={local}
      installEnabled={!local && installEnabled}
      cacheKey={cacheKey}
      api={api}
      onSignOut={() => clerk.signOut({ sessionId, redirectUrl: base })}
      onSettings={() => { clerk.openUserProfile(); }}
      identity={{
        name:
          user.fullName || user.primaryEmailAddress?.emailAddress || "Account",
        email: user.primaryEmailAddress?.emailAddress || "",
      }}
    />
  );
}

export function PortalEntry({
  title,
  children,
  local,
}: {
  title: string;
  children?: React.ReactNode;
  local: boolean;
}) {
  return (
    <main className="portal-design rd-integration-entry">
      <p className="rd-muted">{local ? "Local integration" : "omgskills"}</p>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
