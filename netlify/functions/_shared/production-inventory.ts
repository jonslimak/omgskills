import productionFeatures from "../../../config/production-features.json" with { type: "json" };

export type ProductionInventoryFeatures = {
  skillGroupsWebEnabled?: unknown;
  portalUnifiedEnabled?: unknown;
  connectedInventoryReadEnabled?: unknown;
  connectedInventorySyncEnabled?: unknown;
};

// Reading retained inventory is independent of allowing new connections/reports.
export function requireProductionInventory(
  req: Request, env: Record<string, string | undefined>, deployContext: string | undefined,
  siteId: string | undefined, operation: "read" | "sync",
  features: ProductionInventoryFeatures = productionFeatures,
) {
  const url = new URL(req.url);
  // CONTEXT may be absent at runtime; the runtime deployContext must still be production.
  if (features.skillGroupsWebEnabled !== true || features.portalUnifiedEnabled !== true
    || features.connectedInventoryReadEnabled !== true
    || (operation === "sync" && features.connectedInventorySyncEnabled !== true)
    || url.origin !== "https://omgskills.com"
    || siteId !== "dfdb618d-b748-4c4f-a535-646dc5db449f"
    || (env.CONTEXT !== undefined && env.CONTEXT !== "production") || deployContext !== "production"
    || !/^sk_live_[A-Za-z0-9]+$/.test(env.CLERK_SECRET_KEY ?? "")
    || [env.OMGSKILLS_CONNECTED_INVENTORY_TEST, env.OMGSKILLS_INVENTORY_RECONCILIATION_TEST,
      env.OMGSKILLS_CONNECTED_CANDIDATE].some(value => value !== undefined && value !== "0")) {
    throw new Response("Connected inventory is not enabled for this environment", { status: 503 });
  }
}
