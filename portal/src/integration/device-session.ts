import type { PortalApi } from "../portal-api";
import { isAccessError } from "../api-error";

export type Device = {
  id: string;
  deviceName: string;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: "active" | "revoked" | "expired" | "inactive";
};
export type DeviceSnapshot = {
  devices: Device[] | null;
  loading: boolean;
  revoking: string | null;
  error: string;
  notice: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function parseDevices(value: unknown): Device[] {
  const devices = (value as { devices?: unknown } | null)?.devices;
  if (!Array.isArray(devices) || devices.some((d) => !d || typeof d.id !== "string" || !uuid.test(d.id) ||
    typeof d.deviceName !== "string" || !d.deviceName.trim() ||
    !["active", "revoked", "expired", "inactive"].includes(d.status) ||
    !date(d.createdAt) || !date(d.expiresAt) ||
    !(d.lastUsedAt === null || date(d.lastUsedAt)) || !(d.revokedAt === null || date(d.revokedAt))) ||
    new Set(devices.map((d) => d.id)).size !== devices.length) throw new Error("Invalid device response.");
  return devices;
}

// Memory-only and scoped to the mounted account/page; device failures do not block skills reads.
export function createDeviceSession(api: PortalApi, changed: (value: DeviceSnapshot) => void, denied: () => void) {
  let active = true;
  let request: { controller: AbortController; promise: Promise<void> } | undefined;
  let snapshot: DeviceSnapshot = { devices: null, loading: false, revoking: null, error: "", notice: "" };
  const emit = (value: Partial<DeviceSnapshot>) => {
    if (active) { snapshot = { ...snapshot, ...value }; changed(snapshot); }
  };
  const failAccess = (error: unknown) => {
    if (!isAccessError(error)) return false;
    emit({ devices: null, error: "Account access is unavailable. Sign in again or refresh your account." });
    denied();
    return true;
  };
  function refresh(): Promise<void> {
    if (!active) return Promise.resolve();
    if (request) return request.promise;
    const controller = new AbortController();
    emit({ loading: true, error: "" });
    const promise = api("/api/portal/devices", { signal: controller.signal, cache: "no-store", redirect: "error" })
      .then((result) => { if (active) emit({ devices: parseDevices(result) }); })
      .catch((error) => {
        if (active && !failAccess(error)) emit({ error: snapshot.devices
          ? "Could not refresh devices. Showing the last loaded list."
          : "Could not load devices. Try again." });
      }).finally(() => { if (request?.controller === controller) request = undefined; emit({ loading: false }); });
    request = { controller, promise };
    return promise;
  }
  function revoke(id: string): Promise<void> {
    if (!active || request || snapshot.error || !snapshot.devices?.some((d) => d.id === id && d.status !== "revoked")) {
      return Promise.reject(new Error("Refresh devices before revoking this connection."));
    }
    const controller = new AbortController();
    emit({ revoking: id, notice: "", error: "" });
    const promise = (async () => {
      let confirmed = false;
      try {
        const result = await api<{ deviceId: string; revoked: boolean }>(`/api/portal/devices/${encodeURIComponent(id)}`,
          { method: "DELETE", signal: controller.signal, cache: "no-store", redirect: "error" });
        if (!active) return;
        if (result?.deviceId !== id || result.revoked !== true) throw new Error("Invalid revocation response.");
        confirmed = true;
        emit({ devices: snapshot.devices!.map((d) => d.id === id ? { ...d, status: "revoked" } : d), notice: "Connection revoked." });
        const resultList = await api("/api/portal/devices", { signal: controller.signal, cache: "no-store", redirect: "error" });
        if (active) emit({ devices: parseDevices(resultList) });
      } catch (error) {
        if (active && !failAccess(error)) emit({ error: confirmed
          ? "Connection revoked, but the list could not refresh. Refresh devices to continue."
          : "Could not confirm revocation. Refresh devices before trying again." });
      }
    })().finally(() => {
      if (request?.controller === controller) request = undefined;
      emit({ revoking: null });
    });
    request = { controller, promise };
    return promise;
  }
  return { getSnapshot: () => snapshot, refresh, revoke,
    dispose() { active = false; request?.controller.abort(); request = undefined; } };
}
