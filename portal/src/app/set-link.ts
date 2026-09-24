import type { PortalData, PortalSet } from "./model";
import { publicGroupUrl } from "../groups/model";

export type SetLink = { url: string; description: string; copied: string };
export function setLink(set: PortalSet, profile: PortalData["profile"], origin: string, base: string, local: boolean): SetLink {
  const detail = new URL(`${base}groups/${encodeURIComponent(set.id)}`, origin).href;
  const description = set.hidden || set.visibility === "private" ? "Only the owner can open this set. Copying its link does not grant access."
    : set.visibility === "restricted" ? "Sign in with an allowed email to view this set. Copying its link does not grant access."
    : "Sign in to view this set in the portal.";
  if (local) return { url: detail, description: `Local test link. ${description}`, copied: "Local set link copied." };
  const validSegment = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value) && value.length <= 80;
  if (set.role === "owner" && !set.hidden && set.visibility === "public" && profile.published &&
    validSegment(profile.handle) && set.slug && validSegment(set.slug)) {
    const publicOrigin = new URL(origin).hostname === "app.omgskills.com" ? "https://omgskills.com" : origin;
    return { url: publicGroupUrl(profile.handle.toLowerCase(), set.slug.toLowerCase(), publicOrigin),
      description: "Anyone with this link can view this public set.", copied: "Public set link copied." };
  }
  return { url: detail, description, copied: "Portal set link copied." };
}

export async function copySetLink(link: SetLink, writeText: (text: string) => Promise<void>) {
  try { await writeText(link.url); return link.copied; }
  catch { throw new Error("Could not copy the link. Please try again."); }
}
