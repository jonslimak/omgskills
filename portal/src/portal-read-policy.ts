// Account/detail reads are deliberately separated from all mutation transports.
export function isPortalRead(path: string, method = "GET") {
  return method.toUpperCase() === "GET" &&
    /^\/api\/portal\/(?:synced-skills|groups|shared|profile|devices|private-sources|groups\/[a-zA-Z0-9_-]+)$/.test(path);
}
