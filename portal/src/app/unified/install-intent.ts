import type { SkillDisplay } from "./model";
import { developmentInstallLink } from "./public-install";

export const INSTALL_INTENT_KEY = "omgskills.preview.install-intent.v1";
export const INSTALL_INTENT_TTL = 24 * 60 * 60 * 1000;
export type InstallIntent = {
  version: 1; catalogId: string; repository: string; path: string; agent: "codex";
  commit?: string; returnRoute: string; createdAt: number;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Action = { href: string | null; reason: string };
type Phase = "idle" | "setup" | "checking" | "ready" | "opening" | "blocked";
type State = { phase: Phase; message: string; intent: InstallIntent | null; restartRequired: boolean };

function intentSkill(intent: InstallIntent): SkillDisplay {
  return { key: `catalog:${intent.catalogId}`, catalogId: intent.catalogId, name: "", author: "",
    description: "", tags: [], githubUrl: `https://github.com/${intent.repository}`, skillMDPath: intent.path };
}

function validRoute(route: string, id: string) {
  if (route.length > 4096 || !route.startsWith("/app/preview/unified/?") || /[\\\p{Cc}\p{Cf}]/u.test(route)) return false;
  const url = new URL(route, "https://local.invalid");
  return url.origin === "https://local.invalid" && url.pathname === "/app/preview/unified/" && !url.hash
    && url.searchParams.getAll("skill").length === 1 && url.searchParams.get("skill") === `catalog:${id}`
    && [...url.searchParams.keys()].every(key => ["view", "id", "q", "source", "skill", "f2case"].includes(key));
}

function parseIntent(raw: string): InstallIntent | null {
  try {
    if (raw.length > 8192) return null;
    const value = JSON.parse(raw) as InstallIntent;
    if (!value || Array.isArray(value) || value.version !== 1 || value.agent !== "codex"
      || ![value.catalogId, value.repository, value.path, value.returnRoute].every(v => typeof v === "string")
      || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
      || (value.commit !== undefined && typeof value.commit !== "string")
      || Object.keys(value).some(key => !["version", "catalogId", "repository", "path", "agent", "commit", "returnRoute", "createdAt"].includes(key))
      || !validRoute(value.returnRoute, value.catalogId)) return null;
    return developmentInstallLink(intentSkill(value), value.commit) ? value : null;
  } catch { return null; }
}

export function intentFromAction(skill: SkillDisplay, action: Action, returnRoute: string, now: number): InstallIntent | null {
  if (!action.href) return null;
  try {
    const link = new URL(action.href);
    const commit = link.searchParams.get("commit") ?? undefined;
    // The existing builder remains the authority for source and URL validation.
    if (developmentInstallLink(skill, commit) !== action.href) return null;
    return parseIntent(JSON.stringify({ version: 1, catalogId: skill.catalogId,
      repository: link.searchParams.get("repo"), path: skill.skillMDPath, agent: "codex",
      ...(commit ? { commit } : {}), returnRoute, createdAt: now }));
  } catch { return null; }
}

export class InstallIntentStore {
  private memory: string | null = null;
  private storage: Storage | null;
  constructor(getStorage: () => Storage | null) {
    try { this.storage = getStorage(); this.memory = this.storage?.getItem(INSTALL_INTENT_KEY) ?? null; }
    catch { this.storage = null; }
  }
  get persistent() { return this.storage !== null; }
  read() {
    const intent = this.memory ? parseIntent(this.memory) : null;
    return { intent, invalid: this.memory !== null && !intent };
  }
  save(intent: InstallIntent) {
    this.memory = JSON.stringify(intent);
    try { this.storage?.setItem(INSTALL_INTENT_KEY, this.memory); }
    catch {
      // A failed save must not leave an older request resumable after reload.
      try { this.storage?.removeItem(INSTALL_INTENT_KEY); } catch { /* Storage may be fully unavailable. */ }
      this.storage = null;
    }
  }
  clear() {
    this.memory = null;
    try { this.storage?.removeItem(INSTALL_INTENT_KEY); } catch { this.storage = null; }
  }
}

type Options = {
  catalogId: string; commit?: string; returnRoute: string; store: InstallIntentStore;
  action: (skill: SkillDisplay) => Action;
  refresh: (id: string, signal: AbortSignal) => Promise<SkillDisplay | null>;
  open: (href: string) => void;
  now?: () => number;
};

export class InstallSetupSession {
  private state: State;
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private prepared: { href: string; skill: SkillDisplay } | null = null;
  private now: () => number;
  constructor(private options: Options) {
    this.now = options.now ?? Date.now;
    const saved = options.store.read();
    const mismatch = saved.intent && (saved.intent.catalogId !== options.catalogId || saved.intent.commit !== options.commit);
    const expired = saved.intent && !this.fresh(saved.intent);
    const invalid = saved.invalid || mismatch || expired;
    this.state = { phase: invalid ? "blocked" : saved.intent ? "setup" : "idle",
      intent: saved.intent, restartRequired: !!invalid,
      message: invalid ? "This saved request is expired or no longer matches. Cancel setup and start again."
        : saved.intent ? "Your request is saved. Check details before opening the app again." : "" };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<State>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  private fresh(intent: InstallIntent) { const age = this.now() - intent.createdAt; return age >= 0 && age < INSTALL_INTENT_TTL; }
  private matches(a: InstallIntent, b: InstallIntent) {
    return a.catalogId === b.catalogId && a.repository === b.repository && a.path === b.path && a.agent === b.agent && a.commit === b.commit;
  }
  private fail(message: string, restartRequired = false) {
    this.prepared = null;
    this.update({ phase: "blocked", message, restartRequired });
  }
  private begin(skill: SkillDisplay) {
    if (this.state.restartRequired) return null;
    const action = this.options.action(skill);
    const intent = intentFromAction(skill, action, this.options.returnRoute, this.now());
    if (!intent || intent.catalogId !== this.options.catalogId || intent.commit !== this.options.commit) {
      this.fail(action.reason || "The skill request is unavailable. Select the skill again.", true);
      return null;
    }
    this.options.store.save(intent);
    this.update({ intent });
    return intent;
  }
  showSetup(skill: SkillDisplay) {
    if (this.state.phase === "checking" || this.state.restartRequired) return;
    const intent = this.state.intent ?? this.begin(skill);
    if (!intent) return;
    this.prepared = null;
    this.update({ phase: "setup", message: "" });
  }
  open(skill: SkillDisplay) {
    if (!["idle", "ready"].includes(this.state.phase)) return;
    const intent = this.state.intent ?? this.begin(skill);
    if (!intent) return;
    if (!this.fresh(intent)) { this.fail("This request expired. Cancel setup and start again.", true); return; }
    const candidate = this.prepared?.skill ?? skill;
    const action = this.options.action(candidate);
    const checked = intentFromAction(candidate, action, intent.returnRoute, intent.createdAt);
    if (!checked || !this.matches(intent, checked) || (this.prepared && this.prepared.href !== action.href)) {
      this.fail("The source or version changed. Cancel setup and select the skill again.", true);
      return;
    }
    this.prepared = null;
    // Save before handing control to the browser. No inferred launch/install result.
    this.options.store.save(intent);
    this.update({ phase: "opening", message: "Opening requested. Check OMGSkills F1 Test for the result." });
    try { this.options.open(action.href!); }
    catch { this.update({ message: "Opening could not be confirmed. Try opening again or set up the app." }); }
  }
  async retry() {
    const intent = this.state.intent;
    if (!intent || this.state.restartRequired || this.state.phase === "checking") return;
    if (!this.fresh(intent)) { this.fail("This request expired. Cancel setup and start again.", true); return; }
    this.abort();
    const request = new AbortController();
    this.request = request;
    this.prepared = null;
    this.update({ phase: "checking", message: "Checking current skill details..." });
    try {
      const skill = await this.options.refresh(intent.catalogId, request.signal);
      if (request.signal.aborted || this.request !== request) return;
      if (!this.fresh(intent)) { this.fail("This request expired. Cancel setup and start again.", true); return; }
      if (!skill) { this.fail("This skill is no longer available. Cancel setup and select another skill.", true); return; }
      const action = this.options.action(skill);
      const candidate = intentFromAction(skill, action, intent.returnRoute, intent.createdAt);
      if (!candidate || !this.matches(intent, candidate)) {
        this.fail(action.reason || "The source or version changed. Cancel setup and select the skill again.", true);
        return;
      }
      this.prepared = { href: action.href!, skill };
      this.update({ phase: "ready", message: "Details checked. Open OMGSkills F1 Test to review this request." });
    } catch (error) {
      if (!request.signal.aborted && this.request === request) {
        this.fail(error instanceof Error ? error.message : "Could not check skill details. Try again.");
      }
    } finally { if (this.request === request) this.request = null; }
  }
  abort() { this.request?.abort(); this.request = null; this.prepared = null; }
  reset() {
    this.abort();
    this.options.store.clear();
    this.update({ phase: "idle", intent: null, restartRequired: false, message: "Web setup cancelled. Any open request in the Mac app is unchanged." });
  }
}
