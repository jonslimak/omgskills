import { createRoot } from "react-dom/client";
import { PortalAccount } from "../src/account/PortalSession";
import { makeFixtures, type Scenario } from "../src/preview/fixtures";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";

// The browser runner serves this entry only; production bootstrap never imports it.
if (!import.meta.env.DEV || location.hostname !== "127.0.0.1") throw new Error("Local E fixture only");
const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") as Scenario | null;
const data = makeFixtures(scenario ?? "populated");
const group = (set: typeof data.sets[number]) => ({ ...set, ownerDisplayName: set.ownerName,
  itemCount: set.items.length, syncedSkillIds: set.items.flatMap((item) => item.syncedSkillId ? [item.syncedSkillId] : []),
  appDeepLink: `omgskills://group?url=${encodeURIComponent(`https://omgskills.com/u/fixture/sets/${set.id}`)}`,
  allowedEmails: set.emails.map((email, i) => ({ id: `email-${i}`, email })) });
const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
  if (scenario === "loading") await new Promise(() => {});
  if (scenario === "error") throw new PortalApiError("Fixture failure", 500);
  if (path === "/api/portal/synced-skills") return { skills: data.skills } as T;
  if (path === "/api/portal/profile") return { profile: { handle: data.profile.handle, profilePublished: data.profile.published,
    publicUrl: `https://omgskills.com/u/${data.profile.handle}` } } as T;
  if (path === "/api/portal/groups") return { groups: data.sets.filter((set) => set.role === "owner").map(group) } as T;
  if (path === "/api/portal/shared") return { groups: data.sets.filter((set) => set.role !== "owner").map(group) } as T;
  if (path === "/api/portal/devices" && !init?.method) return { devices: [] } as T;
  if (path === "/api/portal/private-sources" && !init?.method) return { installations: [], sources: [] } as T;
  if (["/api/portal/sync-pairing-code", "/api/portal/sync-token"].includes(path) && init?.method === "POST") {
    return { pairingCode: `pair_${"x".repeat(43)}`, token: "x".repeat(43), expiresAt: new Date(Date.now() + 600000).toISOString() } as T;
  }
  if (path.startsWith("/api/portal/groups/") && !init?.method) {
    if (params.has("slow")) await new Promise((resolve) => setTimeout(resolve, 600));
    const set = data.sets.find((set) => set.id === path.split("/").at(-1));
    if (!set) throw new PortalApiError("Group not found", 404);
    return { group: group(set), accessRole: set.role,
      items: set.items.filter((item) => item.kind !== "private-release").map((item, position) => ({ ...item, position })) } as T;
  }
  throw new Error(`Unexpected E fixture request: ${init?.method ?? "GET"} ${path}`);
};
createRoot(document.getElementById("root")!).render(<PortalAccount
  identity={{ name: data.profile.name, email: data.profile.email }}
  cacheKey={`e-fixture-${location.pathname}-${location.search}`} base="/app/" local={false} installEnabled={params.has("install")}
  api={api} onSettings={() => {}} onSignOut={async () => {}} />);
