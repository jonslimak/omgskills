export const collectionOriginPolicy: "collection-origin-v1";
export const collectionLikePublishers: readonly string[];
export function isCollectionLike(record: { provenance_type?: unknown; publisher_repo?: unknown }): boolean;
export function collectionLikeIds(records: readonly { id: string; provenance_type?: unknown; publisher_repo?: unknown }[]): string[];
