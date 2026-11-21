import { Container, getRandom } from "@cloudflare/containers";
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

const INSTANCES = 2;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, {
      signingKey: env.SCAN_SIGNING_KEY,
      async readStoredFile(key) {
        const object = await env.CLOUD_FILES.get(key);
        return object ? new Uint8Array(await object.arrayBuffer()) : null;
      },
      async container(path, init) {
        const stub = await getRandom(env.SCANNER, INSTANCES);
        return stub.fetch(new Request(`http://scanner${path}`, { method: init?.method ?? "GET", body: init?.body }));
      }
    });
  }
};
