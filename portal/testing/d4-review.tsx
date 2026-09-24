import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PortalApp } from "../src/app/PortalApp";
import { makeFixtures, type Scenario } from "../src/preview/fixtures";
import { DevicesPanel } from "../src/integration/DevicesPanel";
import { PrivateSourcesPanel } from "../src/integration/PrivateSourcesPanel";
import { ReadOnlySetDetail } from "../src/integration/ReadOnlySetDetail";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import type { PortalActions } from "../src/app/model";
import "../src/styles.css";
import "../src/app/redesign.css";

// Only served by the separate loopback test runner. No Clerk or real API transport.
if (!import.meta.env.DEV || location.hostname !== "127.0.0.1") throw new Error("Local D4 fixture only");
const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") as Scenario | null;
const data = makeFixtures(scenario ?? "populated");
const noOp = () => {};
const actions: PortalActions = { updateSet: noOp, createSet: noOp, deleteSet: noOp, membership: noOp, revoke: noOp, updateProfile: noOp };
const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
  if (params.has("slow")) await new Promise((resolve) => setTimeout(resolve, 600));
  if (path === "/api/portal/devices" && !init?.method) return { devices: [] } as T;
  if (path === "/api/portal/private-sources" && !init?.method) return { installations: [], sources: [] } as T;
  if (["/api/portal/sync-pairing-code", "/api/portal/sync-token"].includes(path) && init?.method === "POST") {
    return { pairingCode: `pair_${"x".repeat(43)}`, token: "x".repeat(43), expiresAt: new Date(Date.now() + 600000).toISOString() } as T;
  }
  if (path.startsWith("/api/portal/groups/") && !init?.method) {
    const group = data.sets.find((set) => set.id === path.split("/").at(-1));
    if (!group) throw new PortalApiError("Group not found", 404);
    return { group: { ...group, allowedEmails: group.emails.map((email, i) => ({ id: `email-${i}`, email })) }, accessRole: group.role,
      items: group.items.filter((item) => item.kind !== "private-release").map((item, position) => ({ ...item, position })) } as T;
  }
  throw new Error(`Unexpected fixture request: ${init?.method ?? "GET"} ${path}`);
};

function Review() {
  const [notice, notify] = useState("");
  return <PortalApp data={data} actions={actions} state={scenario === "loading" || scenario === "error" ? scenario : "ready"}
    base="/app/testing/d4/" readOnly previewBar="D4 isolated browser fixtures" notice={notice} notify={notify}
    devicesPanel={<DevicesPanel api={api} denied={noOp} />}
    privateSourcesPanel={<PrivateSourcesPanel api={api} denied={noOp} />}
    renderDetail={(id) => <ReadOnlySetDetail key={id} groupId={id} api={api} actions={actions} hasSummary={data.sets.some((set) => set.id === id)} />} />;
}
createRoot(document.getElementById("root")!).render(<Review />);
