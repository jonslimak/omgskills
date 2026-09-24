import type { PortalApi } from "../portal-api";
import type { Visibility } from "../app/model";
import { createGroup, deleteGroup, updateGroup, updateGroupModeration, addGroupAllowedEmail, removeGroupAllowedEmail } from "../groups/api";
import { loadSetData } from "./data";
import { PortalApiError } from "../api-error";

export type EmailCommand =
  | { kind: "add-email"; id: string; email: string }
  | { kind: "remove-email"; id: string; emailId: string };

export type SetCommand =
  | { kind: "create"; name: string }
  | { kind: "update"; id: string; changes: { name?: string; description?: string; visibility?: Visibility } }
  | { kind: "moderate"; id: string; hidden: boolean }
  | { kind: "delete"; id: string }
  | EmailCommand;

export async function saveSetData(api: PortalApi, command: SetCommand, signal: AbortSignal) {
  const scoped: PortalApi = (path, init) => api(path, { ...init, signal, redirect: "error", cache: "no-store" });
  if (command.kind === "add-email" || command.kind === "remove-email") {
    const set = await loadSetData(scoped, command.id);
    if (signal.aborted) throw new DOMException("Account changed", "AbortError");
    if (set.role !== "owner") throw new PortalApiError("Only the owner can edit access.", 403);
    if (set.isFavorites) throw new PortalApiError("Favorites is public and does not use email access.", 409);
    if (!set.allowedEmails) throw new PortalApiError("Access records are unavailable. Refresh this set.", 409);
    if (command.kind === "add-email") {
      if (set.visibility !== "restricted" || set.hidden) throw new PortalApiError("Use an active Invite-only set to add access.", 409);
      const email = command.email.trim().toLowerCase();
      if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PortalApiError("Enter a valid email address.", 400);
      if (set.allowedEmails.some((entry) => entry.email.toLowerCase() === email)) throw new PortalApiError("This email already has access.", 409);
      const result = await addGroupAllowedEmail(scoped, command.id, email) as { email?: unknown };
      if (result?.email !== email) throw new Error("Unexpected access response.");
      // The endpoint returns the email, not its record ID. Reload before enabling removal.
      return { groupId: command.id, fields: {} };
    }
    const records = set.allowedEmails.filter((entry) => entry.id !== command.emailId);
    if (records.length !== set.allowedEmails.length) {
      const result = await removeGroupAllowedEmail(scoped, command.id, command.emailId) as { emailId?: unknown };
      if (result?.emailId !== command.emailId) throw new Error("Unexpected access response.");
    }
    return { groupId: command.id, fields: { allowedEmails: records, emails: records.map((entry) => entry.email) } };
  }
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
