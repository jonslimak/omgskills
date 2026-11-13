import { PortalApiError } from "../../api-error";
import type { PortalApi } from "../../portal-api";
import type { CatalogInstallAgent } from "./public-install";

/**
 * Install ack: a Mac app that received the website's install request tells the server, and the pop-over polls for it.
 * Older Mac apps never ack, so no answer leaves the pop-over exactly as it was.
 */
export type InstallAckRequest = { catalogId: string; agent: CatalogInstallAgent; since?: string };
/** acked, and the server's own time (the next since comes from it, never from the browser's clock). */
export type InstallAckAnswer = { acked: boolean; now: string };
export type InstallAckCheck = (request: InstallAckRequest, signal: AbortSignal) => Promise<InstallAckAnswer>;

export const INSTALL_ACK_POLL_MS = 2000;
export const INSTALL_ACK_POLL_FOR_MS = 2 * 60 * 1000;
/** Acks from just before the first answer still count: the app can be quick. */
export const INSTALL_ACK_SERVER_MARGIN_MS = 2000;

export function installAckPath({ catalogId, agent, since }: InstallAckRequest) {
  return `/api/portal/install-ack?${new URLSearchParams({ catalogId, agent, ...(since ? { since } : {}) })}`;
}

export function checkInstallAck(api: PortalApi): InstallAckCheck {
  return async (request, signal) => {
    const body = await api<{ acked?: unknown; now?: unknown } | null>(installAckPath(request), { signal, cache: "no-store" });
    if (typeof body?.now !== "string" || !Number.isFinite(Date.parse(body.now))) throw new Error("Install ack has no server time");
    return { acked: body.acked === true, now: body.now };
  };
}

/** What the pop-over says while the app is opening. */
export function openingStatus(acked: boolean, slow: boolean) {
  return acked ? "Approve it in omgskills."
    : slow ? "Didn't open? Open omgskills from Applications, then try again." : "Opening omgskills...";
}

type Timers = { now(): number; setTimeout(run: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
const browserTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/**
 * Asks right away for the server's time (no since), then every 2s for up to 2 minutes whether the app acked since
 * then (less a 2s margin). One request at a time; returns stop.
 * Failures are silent: a network or server error tries again; a refused request (signed out, not deployed) stops.
 */
export function pollInstallAck({ check, catalogId, agent, onAck, timers = browserTimers }: {
  check: InstallAckCheck; catalogId: string; agent: CatalogInstallAgent; onAck: () => void; timers?: Timers;
}): () => void {
  const startedAt = timers.now();
  const controller = new AbortController();
  let since: string | undefined;
  let timer: unknown = null;
  const stop = () => { controller.abort(); if (timer !== null) timers.clearTimeout(timer); timer = null; };
  const schedule = () => {
    if (controller.signal.aborted || timers.now() - startedAt >= INSTALL_ACK_POLL_FOR_MS) return;
    timer = timers.setTimeout(() => { timer = null; void ask(); }, INSTALL_ACK_POLL_MS);
  };
  const ask = async () => {
    try {
      const answer = await check({ catalogId, agent, since }, controller.signal);
      if (controller.signal.aborted) return;
      if (since && answer.acked) { stop(); onAck(); return; }
      since ??= new Date(Date.parse(answer.now) - INSTALL_ACK_SERVER_MARGIN_MS).toISOString();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof PortalApiError && error.status >= 400 && error.status < 500 && error.status !== 429) return;
    }
    schedule();
  };
  void ask();
  return stop;
}
