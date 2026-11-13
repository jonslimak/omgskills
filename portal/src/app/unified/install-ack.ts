import { PortalApiError } from "../../api-error";
import type { PortalApi } from "../../portal-api";
import type { CatalogInstallAgent } from "./public-install";

/**
 * Install ack: a Mac app that received the website's install request tells the server, and the pop-over polls for it.
 * Older Mac apps never ack, so no answer leaves the pop-over exactly as it was.
 */
export type InstallAckRequest = { catalogId: string; agent: CatalogInstallAgent; since: string };
export type InstallAckCheck = (request: InstallAckRequest, signal: AbortSignal) => Promise<boolean>;

export const INSTALL_ACK_POLL_MS = 1500;
export const INSTALL_ACK_POLL_FOR_MS = 2 * 60 * 1000;
/** The ack time is the server's clock; this much earlier keeps a slightly fast browser clock from missing it. */
export const INSTALL_ACK_CLOCK_SLACK_MS = 30 * 1000;

export function installAckPath({ catalogId, agent, since }: InstallAckRequest) {
  return `/api/portal/install-ack?${new URLSearchParams({ catalogId, agent, since })}`;
}

export function checkInstallAck(api: PortalApi): InstallAckCheck {
  return async (request, signal) => {
    const body = await api<{ acked?: unknown }>(installAckPath(request), { signal, cache: "no-store" });
    return body?.acked === true;
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
 * Asks every 1.5s for up to 2 minutes, one request at a time, until the app acks. Returns stop.
 * Failures are silent: a network or server error tries again; a refused request (signed out, not deployed) stops.
 */
export function pollInstallAck({ check, catalogId, agent, onAck, timers = browserTimers }: {
  check: InstallAckCheck; catalogId: string; agent: CatalogInstallAgent; onAck: () => void; timers?: Timers;
}): () => void {
  const startedAt = timers.now();
  const since = new Date(startedAt - INSTALL_ACK_CLOCK_SLACK_MS).toISOString();
  const controller = new AbortController();
  let timer: unknown = null;
  const stop = () => { controller.abort(); if (timer !== null) timers.clearTimeout(timer); timer = null; };
  const schedule = () => {
    if (controller.signal.aborted || timers.now() - startedAt >= INSTALL_ACK_POLL_FOR_MS) return;
    timer = timers.setTimeout(() => { timer = null; void ask(); }, INSTALL_ACK_POLL_MS);
  };
  const ask = async () => {
    try {
      const acked = await check({ catalogId, agent, since }, controller.signal);
      if (controller.signal.aborted) return;
      if (acked) { stop(); onAck(); return; }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof PortalApiError && error.status >= 400 && error.status < 500 && error.status !== 429) return;
    }
    schedule();
  };
  schedule();
  return stop;
}
