import type { PortalApi } from "../portal-api";
import { isAccessError, PortalApiError } from "../api-error";
import { loadPrivateSources, registerPrivateRelease, registerPrivateSource } from "../private-sources/api";
import type { PrivateSkillRelease, PrivateSkillSource, PrivateSourceView } from "../private-sources/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const githubId = (value: unknown) => typeof value === "string" && /^[1-9][0-9]*$/.test(value);
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const unique = (values: string[]) => new Set(values).size === values.length;
export function validSkillRoot(value: string): boolean {
  const root = value.trim();
  return root.length > 0 && root.length <= 1000 && (root === "." ||
    (!/[\\\u0000-\u001f\u007f]/.test(root) && root.split("/").every((part) => part && part !== "." && part !== "..")));
}
export function parseSource(value: PrivateSkillSource): PrivateSkillSource {
  if (!value || typeof value.id !== "string" || !uuid.test(value.id) || !githubId(value.installationId) ||
    !githubId(value.repositoryId) || !text(value.repositorySlug) || typeof value.normalizedRoot !== "string" ||
    !validSkillRoot(value.normalizedRoot) || value.normalizedRoot !== value.normalizedRoot.trim() || !date(value.createdAt)) {
    throw new Error("Invalid private source response.");
  }
  return value;
}
export function parsePrivateSources(value: PrivateSourceView): PrivateSourceView {
  if (!value || !Array.isArray(value.sources) || !Array.isArray(value.installations)) throw new Error("Invalid private sources response.");
  value.sources.forEach(parseSource);
  for (const installation of value.installations) {
    if (!installation || !githubId(installation.installationId) || !githubId(installation.accountId) ||
      !text(installation.accountLogin) || !["User", "Organization"].includes(installation.accountType) ||
      !Array.isArray(installation.repositories) || installation.repositories.some((repo) => !repo ||
        !githubId(repo.id) || !text(repo.fullName) || !text(repo.name) || repo.isPrivate !== true || !text(repo.defaultBranch)) ||
      !unique(installation.repositories.map((repo) => repo.id))) throw new Error("Invalid installation response.");
  }
  if (!unique(value.sources.map((source) => source.id)) || !unique(value.installations.map((installation) => installation.installationId))) {
    throw new Error("Duplicate private source response.");
  }
  return value;
}
function parseRelease(value: PrivateSkillRelease, sourceId: string): PrivateSkillRelease {
  if (!value || typeof value.id !== "string" || !uuid.test(value.id) || value.sourceId !== sourceId ||
    !date(value.createdAt) || [value.commitSha, value.treeSha, value.skillMdSha].some((sha) => typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha))) {
    throw new Error("Invalid release response.");
  }
  return value;
}
export type PrivateSourceSnapshot = {
  view: PrivateSourceView | null;
  loading: boolean;
  saving: string | null;
  error: string;
  notice: string;
  releases: Record<string, PrivateSkillRelease>;
};
export const emptyPrivateSourceSnapshot: PrivateSourceSnapshot = {
  view: null, loading: false, saving: null, error: "", notice: "", releases: {},
};

// Account/page scoped, memory-only. Unknown writes require an explicit read before retry.
export function createPrivateSourceSession(api: PortalApi, changed: (state: PrivateSourceSnapshot) => void, denied: () => void) {
  let active = true;
  let state = { ...emptyPrivateSourceSnapshot };
  let request: { controller: AbortController; promise: Promise<void> } | undefined;
  const emit = (patch: Partial<PrivateSourceSnapshot>) => {
    if (active) { state = { ...state, ...patch }; changed(state); }
  };
  const access = (error: unknown) => {
    if (!isAccessError(error)) return false;
    emit({ view: null, releases: {}, notice: "", error: "Account access is unavailable. Sign in again." });
    active = false;
    denied();
    return true;
  };
  const scopedApi = (controller: AbortController): PortalApi => (path, init) => api(path, {
    ...init, signal: controller.signal, cache: "no-store", redirect: "error",
  });
  function run(saving: string | null, work: (api: PortalApi) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    emit({ loading: saving === null, saving, error: "", notice: "" });
    const promise = work(scopedApi(controller)).finally(() => {
      if (request?.controller === controller) request = undefined;
      emit({ loading: false, saving: null });
    });
    request = { controller, promise };
    return promise;
  }
  function refresh(): Promise<void> {
    if (!active) return Promise.resolve();
    if (request) return request.promise;
    return run(null, async (client) => {
      try {
        const view = parsePrivateSources(await loadPrivateSources(client));
        emit({ view, releases: Object.fromEntries(Object.entries(state.releases).filter(([id]) => view.sources.some((source) => source.id === id))) });
      } catch (error) {
        if (active && !access(error)) emit({ error: state.view
          ? "Could not refresh private sources. Showing the last loaded list."
          : "Could not load private sources. The connection may be unavailable. Try again." });
      }
    });
  }
  function register(input: { installationId: string; repositoryId: string; root: string }): Promise<void> {
    const installation = state.view?.installations.find((item) => item.installationId === input.installationId);
    if (!active || request || state.error || !installation?.repositories.some((repo) => repo.id === input.repositoryId) || !validSkillRoot(input.root)) {
      return Promise.reject(new Error("Select a permitted repository and valid skill root after refreshing."));
    }
    const expected = { ...input, root: input.root.trim() };
    return run("register", async (client) => {
      let confirmed = false;
      try {
        const source = parseSource(await registerPrivateSource(client, expected));
        if (!active) return;
        if (source.installationId !== expected.installationId || source.repositoryId !== expected.repositoryId || source.normalizedRoot !== expected.root) {
          throw new Error("Mismatched source response.");
        }
        confirmed = true;
        emit({ view: { ...state.view!, sources: [...state.view!.sources.filter((item) => item.id !== source.id), source] }, notice: "Source registered." });
        const view = parsePrivateSources(await loadPrivateSources(client));
        emit({ view });
      } catch (error) {
        if (active && !access(error)) emit({ error: confirmed
          ? "Source registered, but the list could not refresh. Refresh sources to continue."
          : error instanceof PortalApiError && error.status === 400
            ? "The skill folder is invalid or has no SKILL.md. Check the path and refresh sources."
            : "Could not confirm registration. Refresh sources before trying again." });
      }
    });
  }
  function release(sourceId: string): Promise<void> {
    if (!active || request || state.error || !state.view?.sources.some((source) => source.id === sourceId)) {
      return Promise.reject(new Error("Refresh sources before creating a snapshot."));
    }
    return run(sourceId, async (client) => {
      try {
        const result = parseRelease(await registerPrivateRelease(client, sourceId), sourceId);
        if (active) emit({ releases: { ...state.releases, [sourceId]: result }, notice: "Private snapshot ready. Unchanged content reuses its existing release." });
      } catch (error) {
        if (active && !access(error)) emit({ error: "Could not confirm the private snapshot. Refresh sources before trying again." });
      }
    });
  }
  return { refresh, register, release, getSnapshot: () => state,
    dispose() { active = false; request?.controller.abort(); request = undefined; } };
}
