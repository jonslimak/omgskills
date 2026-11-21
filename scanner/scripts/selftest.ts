// After a deploy: asks the live scanner, with a signed request, whether its container can reach
// the internet, and which scanners it runs. Fails the deploy if the internet is reachable.
import { signRequest } from "../src/signature.js";

const url = process.env.SCAN_WORKER_URL?.replace(/\/+$/, "");
const key = process.env.SCAN_SIGNING_KEY;
if (!url || !key) throw new Error("SCAN_WORKER_URL and SCAN_SIGNING_KEY are required");

async function get(path: string): Promise<unknown> {
  // The first call may start a container; give it time.
  for (let attempt = 1; ; attempt += 1) {
    const headers = await signRequest(key!, "GET", path, new Uint8Array());
    const response = await fetch(`${url}${path}`, { headers, signal: AbortSignal.timeout(60_000) });
    if (response.ok) return response.json();
    if (attempt >= 5) throw new Error(`${path} answered ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

const { internet } = await get("/selftest") as { internet: boolean };
if (internet !== false) throw new Error("The scanner container can reach the internet; it must not.");
const { scanners } = await get("/scanners") as { scanners: { scanner: string; version: string }[] };
if (!Array.isArray(scanners) || scanners.length === 0) throw new Error("The scanner lists no scanners.");
console.log(`No internet in the container. Scanners: ${scanners.map((s) => `${s.scanner} ${s.version}`).join(", ")}`);
