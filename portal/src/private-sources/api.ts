import type { PortalApi } from "@/portal-api";
import type { PrivateSkillSource, PrivateSourceView } from "@/private-sources/types";

export function loadPrivateSources(api: PortalApi): Promise<PrivateSourceView> {
  return api<PrivateSourceView>("/api/portal/private-sources");
}

export async function registerPrivateSource(
  api: PortalApi,
  input: { installationId: string; repositoryId: string; root: string }
): Promise<PrivateSkillSource> {
  const result = await api<{ source: PrivateSkillSource }>("/api/portal/private-sources", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return result.source;
}
