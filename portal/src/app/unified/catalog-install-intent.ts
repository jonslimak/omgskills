import type { SkillDisplay } from "./model";
import { catalogInstallAction, catalogInstallClients, type CatalogInstallAgent, type CatalogInstallClient } from "./public-install";
import { INSTALL_INTENT_TTL, validInstallReturnRoute } from "./install-intent";

export const CATALOG_INSTALL_INTENT_KEY = "omgskills.app.catalog-install-intent.v1.f1";
export const CANDIDATE_CATALOG_INSTALL_INTENT_KEY = "omgskills.app.catalog-install-intent.v1.candidate";
export type CatalogInstallIntent = {
  version: 1; catalogId: string; agent: CatalogInstallAgent; returnRoute: string; createdAt: number;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
function parse(raw: string): CatalogInstallIntent | null {
  try {
    if (raw.length > 8192) return null;
    const value = JSON.parse(raw) as CatalogInstallIntent;
    if (!value || Array.isArray(value) || value.version !== 1 || !["claude", "codex"].includes(value.agent)
      || typeof value.catalogId !== "string" || typeof value.returnRoute !== "string"
      || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
      || Object.keys(value).some(key => !["version", "catalogId", "agent", "returnRoute", "createdAt"].includes(key))
      || !validInstallReturnRoute(value.returnRoute, value.catalogId, "normal")
      || !catalogInstallAction({ key: `catalog:${value.catalogId}`, catalogId: value.catalogId } as SkillDisplay, value.agent).href) return null;
    return value;
  } catch { return null; }
}

export class CatalogInstallIntentStore {
  private memory: string | null = null;
  private storage: Storage | null;
  private readonly key: string;
  constructor(getStorage: () => Storage | null, readonly client: CatalogInstallClient = "f1") {
    this.key = client === "candidate" ? CANDIDATE_CATALOG_INSTALL_INTENT_KEY : CATALOG_INSTALL_INTENT_KEY;
    try { this.storage = getStorage(); this.memory = this.storage?.getItem(this.key) ?? null; }
    catch { this.storage = null; }
  }
  get persistent() { return this.storage !== null; }
  read() {
    const intent = this.memory ? parse(this.memory) : null;
    return { intent, invalid: this.memory !== null && !intent };
  }
  save(intent: CatalogInstallIntent) {
    this.memory = JSON.stringify(intent);
    try { this.storage?.setItem(this.key, this.memory); }
    catch {
      try { this.storage?.removeItem(this.key); } catch { /* Storage can be unavailable. */ }
      this.storage = null;
    }
  }
  clear() {
    this.memory = null;
    try { this.storage?.removeItem(this.key); } catch { this.storage = null; }
  }
}

type State = {
  phase: "idle" | "setup" | "checking" | "ready" | "opening" | "blocked";
  intent: CatalogInstallIntent | null; message: string; restartRequired: boolean;
};
type Options = {
  catalogId: string; agent: CatalogInstallAgent; returnRoute: string; store: CatalogInstallIntentStore;
  refresh: (id: string, signal: AbortSignal) => Promise<SkillDisplay | null>;
  open: (href: string) => void; now?: () => number;
};
export class CatalogInstallSetupSession {
  private state: State;
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private readonly now: () => number;
  constructor(private options: Options) {
    this.now = options.now ?? Date.now;
    const saved = options.store.read();
    const invalid = saved.invalid || !!(saved.intent && (!this.fresh(saved.intent)
      || saved.intent.catalogId !== options.catalogId || saved.intent.agent !== options.agent));
    this.state = { phase: invalid ? "blocked" : saved.intent ? "setup" : "idle", intent: saved.intent,
      restartRequired: invalid, message: invalid ? "This saved request no longer matches. Cancel setup and start again."
        : saved.intent ? "Your request is saved. Check details before opening the app again." : "" };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<State>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  private fresh(intent: CatalogInstallIntent) { const age = this.now() - intent.createdAt; return age >= 0 && age < INSTALL_INTENT_TTL; }
  private fail(message: string, restartRequired = false) { this.update({ phase: "blocked", message, restartRequired }); }
  private begin(skill: SkillDisplay) {
    if (this.state.restartRequired || !catalogInstallAction(skill, this.options.agent, this.options.store.client).href || skill.catalogId !== this.options.catalogId) return null;
    const intent = parse(JSON.stringify({ version: 1, catalogId: skill.catalogId, agent: this.options.agent,
      returnRoute: this.options.returnRoute, createdAt: this.now() }));
    if (!intent) { this.fail("Select this skill again to start a new request.", true); return null; }
    this.options.store.save(intent);
    this.update({ intent });
    return intent;
  }
  showSetup(skill: SkillDisplay) {
    if (this.state.phase === "checking" || this.state.restartRequired) return;
    if (!(this.state.intent ?? this.begin(skill))) return;
    this.update({ phase: "setup", message: "" });
  }
  open(skill: SkillDisplay) {
    if (!["idle", "ready"].includes(this.state.phase)) return;
    const intent = this.state.intent ?? this.begin(skill);
    if (!intent) return;
    if (!this.fresh(intent)) { this.fail("This request expired. Cancel setup and start again.", true); return; }
    const action = catalogInstallAction(skill, this.options.agent, this.options.store.client);
    if (!action.href || skill.catalogId !== intent.catalogId || intent.agent !== this.options.agent) {
      this.fail("The selected skill or target changed. Start again.", true); return;
    }
    this.options.store.save(intent);
    this.update({ phase: "opening", message: `Opening requested. Check ${catalogInstallClients[this.options.store.client].name} for approval and the result.` });
    try { this.options.open(action.href); }
    catch { this.update({ message: "Opening could not be confirmed. Try opening again." }); }
  }
  async retry() {
    const intent = this.state.intent;
    if (!intent || this.state.restartRequired || this.state.phase === "checking") return;
    if (!this.fresh(intent)) { this.fail("This request expired. Cancel setup and start again.", true); return; }
    this.abort();
    const request = new AbortController();
    this.request = request;
    this.update({ phase: "checking", message: "Checking current skill details..." });
    try {
      const skill = await this.options.refresh(intent.catalogId, request.signal);
      if (request.signal.aborted || this.request !== request) return;
      if (!this.fresh(intent)) { this.fail("This request expired. Cancel setup and start again.", true); return; }
      if (!skill || skill.catalogId !== intent.catalogId || !catalogInstallAction(skill, intent.agent).href) {
        this.fail("This skill is no longer available. Cancel setup and select another skill.", true); return;
      }
      this.update({ phase: "ready", message: "Details checked. Open the app to confirm installation." });
    } catch {
      if (!request.signal.aborted && this.request === request) this.fail("Could not check skill details. Try again.");
    } finally { if (this.request === request) this.request = null; }
  }
  abort() {
    this.request?.abort(); this.request = null;
    if (this.state.phase === "checking") this.fail("Checking was interrupted. Try again.");
  }
  reset() {
    this.abort(); this.options.store.clear();
    this.update({ phase: "idle", intent: null, restartRequired: false,
      message: "Web setup canceled. Any open Mac app request is unchanged." });
  }
}
