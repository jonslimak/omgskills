import { developmentInstallLink } from "../../app/unified/public-install";
import { initialNavigation, navigationSearch, type Navigation, type SkillDisplay } from "../../app/unified/model";
import fixtureData from "./f2-sources.json";

export const f2Sources = fixtureData.sources;
export const f2Cases = f2Sources.flatMap(source => [
  { key: `${source.key}-latest`, label: `${source.label}: Latest`, source, commit: undefined as string | undefined },
  ...(source.previousCommit ? [{ key: `${source.key}-a`, label: `${source.label}: A`, source, commit: source.previousCommit }] : []),
  { key: `${source.key}-recorded`, label: `${source.label}: ${source.previousCommit ? "B" : "Recorded"}`,
    source, commit: source.observedCommit },
]);

export function readF2CaseKey(search: string): string {
  const keys = new URLSearchParams(search).getAll("f2case");
  return keys.length === 1 && f2Cases.some(item => item.key === keys[0]) ? keys[0] : "";
}

export function f2NavigationSearch(nav: Navigation, caseKey: string): string {
  const params = new URLSearchParams(navigationSearch(nav));
  if (f2Cases.some(item => item.key === caseKey)) params.set("f2case", caseKey);
  return params.size ? `?${params}` : "";
}

export function f2CaseNavigation(caseKey: string): Navigation | null {
  const item = f2Cases.find(item => item.key === caseKey);
  return item ? { ...initialNavigation, view: "discover", selected: `catalog:${item.source.id}` } : null;
}

export function f2InstallAction(skill: SkillDisplay, caseKey: string): { href: string | null; reason: string } {
  const item = f2Cases.find(item => item.key === caseKey);
  if (!item) return { href: null, reason: "Choose an F2 test case." };
  if (skill.catalogId !== item.source.id) return { href: null, reason: "This skill does not match the selected test case." };
  if (skill.hasPinnedInstall) return { href: null, reason: "This catalog skill is now pinned. Stop and recheck the test fixture." };
  const href = developmentInstallLink(skill, item.commit);
  if (!href) return { href: null, reason: "Complete, valid catalog source details are required." };
  const request = new URL(href);
  if (request.searchParams.get("repo") !== item.source.repository || skill.skillMDPath !== item.source.path) {
    return { href: null, reason: "The catalog source changed. Stop and recheck the test fixture." };
  }
  return { href, reason: "" };
}
