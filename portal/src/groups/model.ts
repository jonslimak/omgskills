import type { GroupVisibility } from "@/groups/types";

export function publicSiteOrigin() {
  if (window.location.hostname === "app.omgskills.com") {
    return "https://omgskills.com";
  }

  return window.location.origin;
}

export function publicGroupUrl(handle: string, slug: string) {
  return `${publicSiteOrigin()}/u/${handle}/sets/${slug}`;
}

export const groupVisibilityOptions: Array<{ value: GroupVisibility; label: string }> = [
  { value: "public", label: "Public" },
  { value: "restricted", label: "Invite only" },
  { value: "private", label: "Only me" },
];

export function groupVisibilityLabel(visibility: GroupVisibility | undefined) {
  return groupVisibilityOptions.find((option) => option.value === visibility)?.label ?? "Only me";
}
