import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { usePortalApi, type PortalApi } from "./portal-api";
import { createPairingConsent, normalPairingConsent, type BrowserPairingRequest,
  type PairingConsentPolicy, type PairingConsentSnapshot } from "./browser-pairing";

type ConsentSession = ReturnType<typeof createPairingConsent>;

export function ConsentContent({ request, policy, snapshot, approve, cancel }: {
  request: BrowserPairingRequest | null; policy: PairingConsentPolicy; snapshot: PairingConsentSnapshot;
  approve: () => void; cancel: () => void;
}) {
  const pending = snapshot.phase === "approving";
  const finished = ["returning", "cancelled"].includes(snapshot.phase);
  return <main className="shell auth-shell connect-shell">
    <section className="connect-panel">
      <p className="eyebrow">omgskills</p>
      <h1>Connect this Mac?</h1>
      <p>Keep your installed-skills list up to date on the web. This reports what is installed; it does not update skill files.</p>
      {policy.disclosure && <p>{policy.disclosure}</p>}
      <div className="connect-permission">
        <strong>Access</strong><span>Report installed-skill metadata</span>
        {request && policy.scopes(request).includes("content:read") && <span>Read private skills shared with you</span>}
      </div>
      {snapshot.status && <p role={snapshot.phase === "invalid" || snapshot.phase === "error" ? "alert" : "status"}
        className={snapshot.phase === "invalid" ? "connect-error" : "status"}>{snapshot.status}</p>}
      <div className="actions">
        <Button type="button" disabled={!request || pending || finished} onClick={approve}>{pending ? "Approving..." : "Approve"}</Button>
        <Button type="button" disabled={!request || finished} onClick={cancel} variant="outline">Cancel</Button>
      </div>
    </section>
  </main>;
}

export function ConnectPage({ policy = normalPairingConsent, adaptApi, pendingHash, isCurrent }: {
  policy?: PairingConsentPolicy; adaptApi?: (api: PortalApi) => PortalApi; pendingHash?: string; isCurrent?: () => boolean;
}) {
  const normalApi = usePortalApi();
  const api = adaptApi ? adaptApi(normalApi) : normalApi;
  const callbacks = useRef({ api, isCurrent });
  callbacks.current = { api, isCurrent };
  const [hash] = useState(() => pendingHash ?? window.location.hash);
  const [request] = useState(() => policy.parse(hash));
  const [snapshot, setSnapshot] = useState<PairingConsentSnapshot>(() => ({ phase: request ? "ready" : "invalid",
    status: request ? "" : "This connection request is invalid or expired." }));
  const session = useRef<ConsentSession | null>(null);
  useEffect(() => {
    const current = createPairingConsent(hash, policy, {
      api: (path, init) => callbacks.current.isCurrent?.() === false
        ? Promise.reject(new Error("This connection request changed. Review the current request.")) : callbacks.current.api(path, init),
      navigate: url => { if (callbacks.current.isCurrent?.() !== false) window.location.assign(url); }, changed: setSnapshot,
    });
    session.current = current;
    setSnapshot(current.getSnapshot());
    return () => { current.dispose(); if (session.current === current) session.current = null; };
  }, [hash, policy]);
  return <ConsentContent request={request} policy={policy} snapshot={snapshot}
    approve={() => { void session.current?.approve(); }} cancel={() => session.current?.cancel()} />;
}
