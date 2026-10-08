import { useRef } from "react";
import { ProfilePanel } from "../src/integration/unified/ProfilePanel";
import { DevicesPanel } from "../src/integration/DevicesPanel";
import { useAccount } from "../src/integration/unified/useAccount";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import "../src/app/redesign.css";

// In-memory responses only: these checks cannot write to a real account.
export function AccountDialogReview({ theme }: { theme: string }) {
  const attempts = useRef(0);
  const handle = useRef("reviewer");
  const api: PortalApi = async <T,>(path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      attempts.current++;
      await new Promise(resolve => setTimeout(resolve, 150));
      if (attempts.current === 1) throw new PortalApiError("Simulated server failure", 500);
      handle.current = JSON.parse(String(init.body)).handle;
    } else if (init?.method && init.method !== "GET") {
      throw new Error("Connection writes are disabled in this fixture.");
    }
    if (path.endsWith("profile")) return { profile: { handle: handle.current, profilePublished: false, publicUrl: null } } as T;
    if (path.endsWith("synced-skills")) return { skills: [] } as T;
    if (path.endsWith("devices")) return { devices: [{ id: "d1000000-0000-4000-8000-000000000001",
      deviceName: "Sample Mac", status: "active", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null,
      revokedAt: null, expiresAt: "2027-01-01T00:00:00Z" }, {
      id: "d1000000-0000-4000-8000-000000000002", deviceName: "Previous Sample Mac", status: "revoked",
      createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, revokedAt: "2026-02-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z" }] } as T;
    return { groups: [] } as T;
  };
  const account = useAccount(api, { name: "Sample Reviewer", email: "reviewer@example.test" }, true, "dialog-review");
  const { snapshot } = account;
  if (!snapshot.data) return <p>Loading sample account...</p>;
  return <>
    <button onClick={account.refresh} disabled={snapshot.refreshing}>Refresh sample account</button>
    <ProfilePanel profile={snapshot.data.profile} theme={theme}
      busy={snapshot.profileSaving || snapshot.setSaving || snapshot.refreshing}
      blocked={!!snapshot.error || !snapshot.data || snapshot.accessDenied}
      error={snapshot.profileError || snapshot.error} save={account.saveProfile} settings={() => {}} />
    <div className="portal-design ua-connected-panel"><DevicesPanel api={api} denied={() => {}} theme={theme} /></div>
  </>;
}
