export type ProductionFeatures = Readonly<{
  skillGroupsWebEnabled: boolean; skillGroupsAuthEnabled: boolean;
  portalRedesignEnabled: boolean; portalUnifiedEnabled: boolean; catalogSearchEnabled: boolean;
}>;
export function validateProductionFeatures(value: unknown): ProductionFeatures;
