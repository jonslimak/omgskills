import { consumeVerificationBody } from "./verification-fetch.mjs";

export function createLiveLinkVerifier({ origin, fetchLive, log = console.log }) {
  // Cache status only: callers still apply their own rules, and content checks fetch afresh.
  const statusByUrl = new Map();

  function linkStatus(urlPath) {
    const url = `${origin}${urlPath}`;
    if (!statusByUrl.has(url)) {
      statusByUrl.set(url, (async () => {
        const response = await fetchLive(url, { redirect: "manual" });
        const status = response.status;
        await consumeVerificationBody(response, url);
        return status;
      })());
    }
    return statusByUrl.get(url);
  }

  return async function verifyLinks(paths, { label, acceptStatus }) {
    const uniquePaths = [...new Set(paths)];
    const started = Date.now();
    let next = 0;
    let completed = 0;
    let failed = false;
    let failure;
    log(`[web-library] ${label}: links 0/${uniquePaths.length}`);

    async function worker() {
      while (!failed && next < uniquePaths.length) {
        const urlPath = uniquePaths[next++];
        try {
          const status = await linkStatus(urlPath);
          if (!acceptStatus(status, urlPath)) {
            throw new Error(`${label} linked to ${urlPath}, which returned ${status}`);
          }
          completed += 1;
          if (completed % 25 === 0 || completed === uniquePaths.length) {
            log(`[web-library] ${label}: links ${completed}/${uniquePaths.length} (${Date.now() - started}ms)`);
          }
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }

    // Drain active requests before rejecting; do not start more work after a failure.
    await Promise.all(Array.from({ length: Math.min(4, uniquePaths.length) }, worker));
    if (failed) throw failure;
  };
}
