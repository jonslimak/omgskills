import type { CatalogReader } from "./catalog-reader.js";
import { loadDefaultCatalogSource } from "./catalog-tracks.js";

export const catalogRefreshIntervalMs = 10 * 60_000;
const maximumRetryMs = 60 * 60_000;

export type RefreshingCatalog = {
  get: () => CatalogReader;
  refresh: () => Promise<void>;
  stop: () => void;
};

export async function createRefreshingCatalog(options: {
  fetcher?: typeof fetch;
  log?: (message: string) => void;
} = {}): Promise<RefreshingCatalog> {
  const lifetime = new AbortController();
  const fetcher = options.fetcher ?? fetch;
  const log = options.log ?? (message => console.error(`[omgskills-mcp] ${message}`));
  let { library: current, reload } = await loadDefaultCatalogSource((input, init) => fetcher(input, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, lifetime.signal]) : lifetime.signal,
  })).catch(error => { lifetime.abort(); throw error; });
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;

  function schedule(delay: number) {
    if (stopped || !reload) return;
    timer = setTimeout(() => { timer = undefined; void refresh(); }, delay);
    timer.unref?.();
  }

  function refresh(): Promise<void> {
    if (stopped || !reload) return Promise.resolve();
    if (pending) return pending;
    if (timer) { clearTimeout(timer); timer = undefined; }
    let delay = catalogRefreshIntervalMs;
    pending = reload().then(next => {
      if (stopped) return;
      const changed = next !== current;
      current = next;
      failures = 0;
      if (changed) log("Catalog refreshed.");
    }, () => {
      if (stopped) return;
      failures = Math.min(failures + 1, 4);
      delay = Math.min(catalogRefreshIntervalMs * 2 ** (failures - 1), maximumRetryMs);
      // Never print remote URLs, response bodies or credentials from fetch errors.
      log(`Catalog refresh failed; keeping previous data. Retrying in ${delay / 60_000} minutes.`);
    }).finally(() => { pending = undefined; schedule(delay); });
    return pending;
  }

  function stop() {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = undefined; }
    lifetime.abort();
  }

  schedule(catalogRefreshIntervalMs);
  return { get: () => current, refresh, stop };
}
