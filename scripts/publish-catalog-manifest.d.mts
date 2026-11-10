export function publishCatalogManifest(options: {
  dataDir: string;
  manifest: Record<string, unknown>;
  previousManifest: Record<string, unknown>;
  prefixes: string[];
}): void;
