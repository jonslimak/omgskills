import type { AssetReference, SearchDescriptor } from "../mcp/src/search-catalog-format.mjs";

type Manifest = { skills: AssetReference; searchCatalog?: AssetReference; generatedAt?: string };
export const searchAssetPattern: RegExp;
export function validateSearchCatalog(dataDir: string, manifest: Manifest, options?: { fullRecords?: boolean }):
  { descriptor: SearchDescriptor; paths: string[] } | null;
export function buildSearchCatalog(dataDir: string, source: AssetReference, options?: { generatedAt?: string; previous?: AssetReference }): AssetReference;
export function prepareSearchCatalog(dataDir: string, manifest: Manifest, previous?: Partial<Manifest>, enabled?: boolean): void;
export function retainedSearchAssets(dataDir: string, filenames: string[], now?: number): Set<string>;
