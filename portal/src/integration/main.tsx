import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  SignInButton,
  useAuth,
  useUser,
} from "@clerk/clerk-react";
import { PortalApp } from "../app/PortalApp";
import { Action } from "../app/ui";
import type { LoadState, PortalActions } from "../app/model";
import { ReadOnlySetDetail } from "./ReadOnlySetDetail";
import { usePortalApi } from "../portal-api";
import { emptyAccount, type AccountIdentity } from "./data";
import { integrationConfigurationError } from "./gate";
import { startAccountRead } from "./read-session";
import "../styles.css";
import "../app/redesign.css";

const base = "/app/integration/";
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const configurationError = integrationConfigurationError({
  ready: import.meta.env.VITE_PORTAL_INTEGRATION_READY === true,
  publishableKey,
  webEnabled: import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED,
});

function Account({ identity }: { identity: AccountIdentity }) {
  const api = usePortalApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [data, setData] = useState(() => emptyAccount(identity));
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [notice, notify] = useState("");

  useEffect(() => {
    setState("loading");
    setError("");
    return startAccountRead(
      apiRef.current,
      identity,
      (next) => {
        setData(next);
        setState("ready");
      },
      () => {
        setData(emptyAccount(identity));
        setError(
          "Could not load the account. Check your test session and backend, then retry.",
        );
        setState("error");
      },
    );
  }, [attempt, identity.name, identity.email]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => notify(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const unavailable = () =>
    notify("Changes are not enabled in this read-only view.");
  const actions: PortalActions = {
    updateSet: unavailable,
    createSet: unavailable,
    deleteSet: unavailable,
    membership: unavailable,
    revoke: unavailable,
    updateProfile: unavailable,
    retry: () => setAttempt((value) => value + 1),
  };
  return (
    <PortalApp
      data={data}
      actions={actions}
      state={state}
      base={base}
      readOnly
      notice={notice}
      notify={notify}
      previewBar={
        <div className="rd-preview-bar" role="status">
          <span>Local integration · test account · read-only</span>
          {error && <span>{error}</span>}
        </div>
      }
      renderDetail={(id) => (
        <ReadOnlySetDetail
          key={id}
          groupId={id}
          api={api}
          actions={actions}
          hasSummary={data.sets.some((set) => set.id === id)}
        />
      )}
    />
  );
}

function Session() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { user } = useUser();
  if (!isLoaded || (isSignedIn && !user))
    return <Entry title="Loading account..." />;
  if (!isSignedIn || !user || !userId)
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
