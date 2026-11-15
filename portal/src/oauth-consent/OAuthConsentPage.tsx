import { useEffect } from "react";
import { useAuth, useClerk, useOAuthConsent } from "@clerk/react";
import { Button } from "../components/ui/button";

/** What the page needs from the address Clerk sends people to. */
export function consentRequest(search: string) {
  const params = new URLSearchParams(search);
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  // Everything Clerk sent is posted back, except what this form sets.
  const forward = [...params.entries()].filter(([key]) => key !== "consented" && key !== "organization_id");
  return { clientId, redirectUri, scope: params.get("scope") ?? undefined, forward };
}

/** Where Allow sends you: Clerk's checked domain, else the redirect's host or scheme; never throws. */
export function consentDestination(redirectDomain: string | null | undefined, redirectUri: string) {
  if (redirectDomain) return redirectDomain;
  try {
    const url = new URL(redirectUri);
    return url.hostname || url.protocol.replace(/:$/, "");
  } catch { return ""; }
}

/** A loopback address (a local agent's callback); everything else is said up front. */
export function isLocalDestination(destination: string) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(destination);
}

/** An agent's name without a stray empty or overlong value. */
export function agentName(name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed && trimmed.length <= 60 ? trimmed : "Your agent";
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="shell auth-shell connect-shell">
    <section className="connect-panel">
      <span className="connect-logo" role="img" aria-label="omgskills">👀</span>
      {children}
    </section>
  </main>;
}

export type ConsentData = { oauthApplicationName?: string | null; redirectDomain?: string | null;
  scopes: { scope: string; description?: string | null }[] };
export type ConsentView = { state: "invalid" | "loading" | "error" } | { state: "ready"; data: ConsentData; action: string };

/** The page itself, without Clerk: what an agent asks for, and Allow / Cancel. */
export function OAuthConsentContent({ request, view }: { request: ReturnType<typeof consentRequest>; view: ConsentView }) {
  if (view.state !== "ready") {
    return <Shell><h1>Connect agent</h1>{view.state === "loading" ? <p className="status">Loading...</p>
      : <p role="alert" className="connect-error">{view.state === "invalid" ? "This sign-in request is invalid."
        : "This sign-in request couldn't load."} Start again from your agent.</p>}</Shell>;
  }
  const { data, action } = view;
  const name = agentName(data.oauthApplicationName);
  const destination = consentDestination(data.redirectDomain, request.redirectUri);
  return <Shell>
    <h1>Connect {name}</h1>
    <p className="connect-lead">{name} can read your My skills.</p>
    {/* Agents name themselves, so where Allow goes is shown up front unless it's this computer. */}
    {destination && !isLocalDestination(destination) && <p className="status">Allow returns you to <strong>{destination}</strong>.</p>}
    <details className="connect-details">
      <summary>Show details</summary>
      <p>Read only. Nothing on your Mac changes.{destination ? ` You'll go back to ${destination}.` : ""}</p>
      <ul className="connect-permission" aria-label="Access">
        {data.scopes.map(scope => <li key={scope.scope}>{scope.description || scope.scope}</li>)}
      </ul>
    </details>
    <form method="POST" action={action}>
      {request.forward.map(([key, value], index) => <input key={`${key}:${index}`} type="hidden" name={key} value={value} />)}
      <div className="actions">
        <Button type="submit" name="consented" value="true">Allow</Button>
        <Button type="submit" name="consented" value="false" variant="outline">Cancel</Button>
      </div>
    </form>
  </Shell>;
}

/**
 * omgskills' own OAuth consent page (Clerk "OAuth consent" path): an agent such as Codex asks to read My skills.
 * Signed out: Clerk's sign-in, then back here.
 */
export function OAuthConsentPage({ search = window.location.search }: { search?: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const request = consentRequest(search);
  useEffect(() => {
    if (isLoaded && !isSignedIn) void clerk.redirectToSignIn({ signInForceRedirectUrl: window.location.href });
  }, [isLoaded, isSignedIn, clerk]);
  const { data, isLoading, error } = useOAuthConsent({
    oauthClientId: isSignedIn ? request.clientId : "", scope: request.scope, redirectUri: request.redirectUri || undefined });
  const view: ConsentView = !request.clientId || !request.redirectUri ? { state: "invalid" }
    : !isLoaded || !isSignedIn || isLoading ? { state: "loading" }
    : error || !data ? { state: "error" }
    : { state: "ready", data, action: clerk.oauthApplication.buildConsentActionUrl({ clientId: request.clientId }) };
  return <OAuthConsentContent request={request} view={view} />;
}
