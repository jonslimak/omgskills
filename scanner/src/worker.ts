import { Container, getContainer } from "@cloudflare/containers";
import { handle } from "./handler.js";

/** The scanner: files in, findings out. No internet, no keys, never runs skill code. */
export class Scanner extends Container {
  defaultPort = 8080;
  sleepAfter = "2m";
  enableInternet = false;
}

type Env = {
  SCANNER: DurableObjectNamespace<Scanner>;
  CLOUD_FILES: R2Bucket;
  SCAN_SIGNING_KEY: string;
};

/**
 * One scanner, always the same one: the scanner-list call at the start of a run wakes it, so the
 * scans right after don't wait for another copy to start.
 */
const INSTANCE = "scanner";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, {
      signingKey: env.SCAN_SIGNING_KEY,
      async readStoredFile(key) {
        const object = await env.CLOUD_FILES.get(key);
        return object ? new Uint8Array(await object.arrayBuffer()) : null;
      },
      async container(path, init) {
        const stub = getContainer(env.SCANNER, INSTANCE);
        return stub.fetch(new Request(`http://scanner${path}`, { method: init?.method ?? "GET", body: init?.body }));
      }
    });
  }
};
