export const candidateOrigin = "https://omgskills-setup-test-f3b.netlify.app";

// This entry point is built separately; no environment flag enables it in the normal portal.
export function candidatePageAllowed(origin: string, pathname: string, hash: string) {
  return origin === candidateOrigin && pathname === "/app/" && hash === "";
}
