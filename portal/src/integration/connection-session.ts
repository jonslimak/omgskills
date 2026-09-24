import type { PortalApi } from "../portal-api";
import { isAccessError, PortalApiError } from "../api-error";

export type ConnectionMode = "pairing" | "legacy";
export type ConnectionSnapshot = {
  mode: ConnectionMode; secret: string; expiresAt: string; generating: boolean;
  copying: boolean; error: string; notice: string;
};
const empty = (mode: ConnectionMode): ConnectionSnapshot => ({ mode, secret: "", expiresAt: "",
  generating: false, copying: false, error: "", notice: "" });

export function createConnectionSession(api: PortalApi, changed: (value: ConnectionSnapshot) => void,
  denied: () => void, now = Date.now) {
  let active = true;
  let generation = 0;
  let controller: AbortController | undefined;
  let snapshot = empty("pairing");
  const emit = (value: Partial<ConnectionSnapshot>) => {
    if (active) { snapshot = { ...snapshot, ...value }; changed(snapshot); }
  };
  function expire() {
    if (snapshot.secret && Date.parse(snapshot.expiresAt) <= now()) {
      generation++;
      emit({ secret: "", expiresAt: "", copying: false, notice: "Expired. Generate a new code to continue." });
    }
  }
  function select(mode: ConnectionMode) {
    generation++; controller?.abort(); controller = undefined;
    emit(empty(mode));
  }
  async function generate() {
    expire();
    if (!active || snapshot.generating || snapshot.secret) return;
    const version = ++generation;
    const mode = snapshot.mode;
    controller = new AbortController();
    emit({ generating: true, error: "", notice: "" });
    try {
      const result = await api<Record<string, unknown>>(mode === "pairing" ? "/api/portal/sync-pairing-code" : "/api/portal/sync-token",
        { method: "POST", body: "{}", signal: controller.signal, cache: "no-store", redirect: "error" });
      if (!active || version !== generation) return;
      const secret = result?.[mode === "pairing" ? "pairingCode" : "token"];
      const expiresAt = result?.expiresAt;
      const pattern = mode === "pairing" ? /^pair_[A-Za-z0-9_-]{43}$/ : /^[A-Za-z0-9_-]{43}$/;
      if (typeof secret !== "string" || !pattern.test(secret) || typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now()) throw new Error("Invalid connection response");
      emit({ secret, expiresAt });
    } catch (error) {
      if (!active || version !== generation) return;
      if (isAccessError(error)) { emit(empty(mode)); denied(); }
      else emit({ error: error instanceof PortalApiError && error.status === 429
        ? "Too many requests. Wait before generating another code."
        : "Could not confirm code generation. A code may have been issued. Try again only when needed." });
    } finally {
      if (active && version === generation) { controller = undefined; emit({ generating: false }); }
    }
  }
  async function copy(write: (secret: string) => Promise<void>) {
    expire();
    if (!active || !snapshot.secret || snapshot.copying) return;
    const version = generation;
    emit({ copying: true, error: "", notice: "" });
    try {
      await write(snapshot.secret);
      expire();
      if (active && generation === version) emit({ notice: "Copied." });
    } catch {
      if (active && generation === version) emit({ error: "Could not copy. Try again." });
    } finally { if (active && generation === version) emit({ copying: false }); }
  }
  return { getSnapshot: () => snapshot, generate, copy, select, expire,
    dispose() { active = false; generation++; controller?.abort(); controller = undefined; snapshot = empty("pairing"); } };
}
