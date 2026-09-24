import type { PortalApi } from "../portal-api";
import type { Visibility } from "../app/model";
import { createGroup, deleteGroup, updateGroup, updateGroupModeration } from "../groups/api";

export type SetCommand =
  | { kind: "create"; name: string }
  | { kind: "update"; id: string; changes: { name?: string; description?: string; visibility?: Visibility } }
  | { kind: "moderate"; id: string; hidden: boolean }
  | { kind: "delete"; id: string };

export async function saveSetData(api: PortalApi, command: SetCommand, signal: AbortSignal) {
  const scoped: PortalApi = (path, init) => api(path, { ...init, signal, redirect: "error", cache: "no-store" });
  const result = await (command.kind === "create" ? createGroup(scoped, command.name)
    : command.kind === "update" ? updateGroup(scoped, command.id, command.changes)
    : command.kind === "moderate" ? updateGroupModeration(scoped, command.id, command.hidden)
    : deleteGroup(scoped, command.id)) as Record<string, unknown>;
  if (!result || typeof result.groupId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(result.groupId)
    || (command.kind !== "create" && result.groupId !== command.id)
    || (command.kind === "delete" && result.deleted !== true)
    || (command.kind === "moderate" && result.disabled !== command.hidden)
    || (command.kind === "update" && (typeof result.name !== "string" || (result.description !== null && typeof result.description !== "string")
      || !["private", "public", "restricted"].includes(String(result.visibility))))) {
    throw new Error("Unexpected set response.");
  }
  return { groupId: result.groupId, fields: command.kind === "update" ? {
    name: result.name as string, description: (result.description ?? "") as string, visibility: result.visibility as Visibility,
  } : {} };
}
