import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { usePortalApi, type PortalApi } from "./portal-api";
import { createPairingConsent, deviceMarks, macTookApproval, MY_SKILLS_PATH, normalPairingConsent, type BrowserPairingRequest,
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
      <span className="connect-logo" role="img" aria-label="omgskills">👀</span>
      <h1>Connect Mac</h1>
      <p className="connect-lead">See this Mac's skills in omgskills and keep them in sync.</p>
      <details className="connect-details">
        <summary>Show details</summary>
        <p>This reports what is installed; it does not update skill files.</p>
        {policy.disclosure && <p>{policy.disclosure}</p>}
        <ul className="connect-permission" aria-label="Access">
          <li>Report installed-skill metadata</li>
          {request && policy.scopes(request).includes("content:read") && <li>Read private skills shared with you</li>}
          {request && policy.scopes(request).includes("content:write") && <li>Sync My skills</li>}
        </ul>
      </details>
      {snapshot.status && <p role={snapshot.phase === "invalid" || snapshot.phase === "error" ? "alert" : "status"}
        className={snapshot.phase === "invalid" ? "connect-error" : "status"}>{snapshot.status}</p>}
      {snapshot.phase === "returning" && snapshot.returnUrl && <p className="status">
        Didn't open? <a href={snapshot.returnUrl}>Open omgskills</a></p>}
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
  // On Approve, note this account's Macs first; once one takes the approval, go to My skills.
  const before = useRef<Promise<Map<string, string> | null> | null>(null);
  const approve = () => {
    const marks = callbacks.current.api<{ devices: { id: string; expiresAt: string | null }[] }>("/api/portal/devices", { cache: "no-store" })
      .then(result => Array.isArray(result?.devices) ? deviceMarks(result.devices) : null).catch(() => null);
    before.current = marks;
    void marks.then(() => session.current?.approve());
  };
  const returning = snapshot.phase === "returning";
  useEffect(() => {
    if (!returning || !before.current) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const check = async () => {
      const marks = await before.current;
      if (stopped || !marks) return;
      try {
        const result = await callbacks.current.api<{ devices: { id: string; expiresAt: string | null }[] }>("/api/portal/devices", { cache: "no-store" });
        if (stopped) return;
        if (Array.isArray(result?.devices) && macTookApproval(marks, result.devices)) {
          if (callbacks.current.isCurrent?.() !== false) window.location.assign(MY_SKILLS_PATH);
          return;
        }
      } catch { /* keep waiting; the link stays for a manual return */ }
      if (!stopped && Date.now() - started < 3 * 60_000) timer = setTimeout(check, 2_000);
    };
    timer = setTimeout(check, 1_000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [returning]);
  return <ConsentContent request={request} policy={policy} snapshot={snapshot}
    approve={approve} cancel={() => session.current?.cancel()} />;
}
