import { InstallIntentStore, InstallSetupSession } from "../../portal/src/app/unified/install-intent";
import { PublicCatalogClient } from "../../portal/src/app/unified/public-catalog";
import { f2Cases, f2InstallAction } from "../../portal/src/preview/unified/f2-install";
import type { SkillDisplay } from "../../portal/src/app/unified/model";

declare const DOWNLOAD_SHA256: string;
const origin = "https://omgskills-setup-test-f3b.netlify.app";
const cases = [
  { key: "writing-guidelines-recorded", title: "Writing Guidelines" },
  { key: "humanizer-a", title: "Humanizer A" },
  { key: "humanizer-recorded", title: "Humanizer B" },
].map(item => {
  const fixture = f2Cases.find(fixture => fixture.key === item.key)!;
  return { ...fixture, title: item.title,
    route: `/app/preview/unified/?view=discover&skill=${encodeURIComponent(`catalog:${fixture.source.id}`)}&f2case=${fixture.key}` };
});
const status = document.querySelector<HTMLElement>("#status")!;
const actions = document.querySelector<HTMLElement>("#actions")!;
const setup = document.querySelector<HTMLElement>("#setup")!;

async function start() {
  if (location.origin !== origin || location.pathname !== "/app/preview/unified/" || location.hash) {
    throw new Error("Use the exact approved test page.");
  }
  const testCase = location.search
    ? cases.find(item => location.search === new URL(item.route, origin).search) : cases[0];
  if (!testCase) {
    throw new Error("This URL does not match the recorded test request.");
  }
  const { route } = testCase;
  history.replaceState(null, "", route);
  document.title = `${testCase.title} | OMGSkills Setup Test`;
  document.querySelector<HTMLElement>("#title")!.textContent = testCase.title;
  document.querySelector<HTMLElement>("#repository")!.textContent = testCase.source.repository;
  document.querySelector<HTMLElement>("#version")!.textContent = testCase.commit!;
  const avatar = document.querySelector<HTMLImageElement>("#avatar")!;
  avatar.src = `https://github.com/${testCase.source.repository.split("/")[0]}.png?size=80`;
  avatar.hidden = false;
  for (const item of cases) {
    const link = document.createElement("a");
    link.textContent = item.title;
    link.href = item.route;
    if (item.key === testCase.key) link.setAttribute("aria-current", "page");
    document.querySelector<HTMLElement>("#cases")!.append(link);
  }
  async function refresh(id: string, signal: AbortSignal): Promise<SkillDisplay | null> {
    if (id !== testCase!.source.id) throw new Error("This page supports only the selected test request.");
    const result = await new PublicCatalogClient().skill(id, signal);
    return result ? { ...result, key: `catalog:${result.id}`, catalogId: result.id } : null;
  }
  // Keep the original setup intent, and scope the two update fixtures independently.
  const store = new InstallIntentStore(() => {
    const storage = sessionStorage;
    const scoped = (key: string) => testCase.key === "writing-guidelines-recorded" ? key : `${key}.${testCase.key}`;
    return { getItem: key => storage.getItem(scoped(key)), setItem: (key, value) => storage.setItem(scoped(key), value),
      removeItem: key => storage.removeItem(scoped(key)) };
  }, "setup-test");
  const session = new InstallSetupSession({ client: "setup-test", catalogId: testCase.source.id,
    commit: testCase.commit, returnRoute: route, store, refresh,
    action: skill => f2InstallAction(skill, testCase.key, "setup-test"),
    open: href => location.assign(href),
  });
  const skill = await refresh(testCase.source.id, new AbortController().signal);
  if (!skill) throw new Error("The test skill is unavailable. Stop this test.");
  const action = f2InstallAction(skill, testCase.key, "setup-test");
  if (!action.href) throw new Error(action.reason);
  function button(label: string, run: () => void, disabled = false, secondary = false) {
    const element = document.createElement("button");
    element.textContent = label;
    element.type = "button";
    element.disabled = disabled;
    if (secondary) element.className = "secondary";
    element.onclick = run;
    actions.append(element);
  }
  function render() {
    const state = session.getSnapshot();
    actions.replaceChildren();
    const busy = state.phase === "checking";
    if (state.phase === "idle" || state.phase === "ready") {
      button("Open in OMGSkills Setup Test", () => session.open(skill!));
    } else {
      button(busy ? "Checking details..." : "Try opening again", () => void session.retry(), busy || state.restartRequired);
    }
    if (state.phase !== "setup") button("Set up OMGSkills Setup Test", () => session.showSetup(skill!), busy || state.restartRequired, true);
    if (state.phase !== "idle") button("Cancel setup", () => session.reset(), false, true);
    status.textContent = state.message || "The app will ask for approval before installing.";
    setup.hidden = state.phase !== "setup";
    document.querySelector<HTMLElement>("#storage")!.hidden = store.persistent;
  }
  document.querySelector<HTMLElement>("#checksum")!.textContent = DOWNLOAD_SHA256;
  session.subscribe(render);
  addEventListener("pagehide", () => session.abort());
  render();
}

void start().catch(error => { actions.replaceChildren(); setup.hidden = true; status.textContent = String(error.message ?? error); });
