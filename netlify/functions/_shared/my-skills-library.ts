// My skills, built on the server for one user: the same list and count the web builds in the browser
// (portal/src/app/unified/model.ts and cloud-save/cloud-save.ts), plus what an agent may read of each skill.
// Agents reach it through the library MCP; nothing here returns skill contents.
import {
  groupSyncedSkills,
  hasCatalogId,
  type GroupedSyncedSkill,
  type SyncedSkill,
} from "../../../portal/src/synced-skill-grouping.js";
import type { CloudSaveState } from "./cloud-save.js";

export type LibraryCloudStatus = "saved" | "deleted" | "review" | "confirmed" | "excluded" | "library" | "set"
  | "waiting" | "off" | "links" | "too_large" | "unreadable" | "failed";

/** Where an agent's read of a skill comes from: the account's saved copy, or the public library version. */
export type LibraryReadSource = "saved" | "public";

export type LibrarySkill = {
  /** Stable within the account: `lib:<catalog id>` for library skills, `key:<folder key>` for your own. */
  id: string;
  name: string;
  description: string;
  author: string;
  catalogId: string | null;
  githubUrl: string | null;
  origin: "personal" | "library" | "set";
  /** On one of your Macs now. */
  installed: boolean;
  /** The saved copy's folder key, when the account keeps one. */
  savedKey: string | null;
  status: LibraryCloudStatus | null;
  available: boolean;
  source: LibraryReadSource | null;
  /** Why it can't be read, when it can't. */
  reason: string | null;
};

export type MySkillsLibrary = {
  skills: LibrarySkill[];
  /** The web's My skills count. */
  count: number;
  notInstalledCount: number;
};

export type CatalogDetails = { name?: string; description?: string; author?: string; githubUrl?: string | null };

export type MySkillsInputs = {
  inventory: SyncedSkill[];
  /** Null when cloud save couldn't be read; the web then counts it as empty. */
  cloud: CloudSaveState | null;
  /** Added library skills, by catalog ID. */
  additions: string[];
  /** Library details by catalog ID, for names and authors; missing entries fall back to the ID. */
  catalog?: Map<string, CatalogDetails>;
  now?: number;
};

const LEGACY_COPY_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/** The folder key cloud save uses: NFC and lower case, untrimmed (same as the web and the Mac). */
export function cloudSkillKey(name: string) {
  return name.normalize("NFC").toLowerCase();
}

function isLive(copy: SyncedSkill, now: number) {
  if (copy.isCurrent === false) return false;
  if (copy.deviceId != null) return true;
  const seen = Date.parse(copy.lastSeenAt);
  return !Number.isFinite(seen) || now - seen < LEGACY_COPY_STALE_MS;
}

function catalogOwner(id: string | null | undefined) {
  const owner = id?.split("/")[0] ?? "";
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(owner) && id!.includes("/") ? owner : "";
}

function keysOf(copies: SyncedSkill[]) {
  return [...new Set(copies.map(copy => cloudSkillKey(copy.installationFolder || copy.name)))];
}

type CloudRow = { key: string; name: string; status: LibraryCloudStatus; savedAt: string | null; confirmedSecret: boolean;
  onMac: boolean; origin: "library" | "set" | null };

const statusOrder: Record<LibraryCloudStatus, number> = {
  review: 0, confirmed: 1, saved: 2, deleted: 3, failed: 4, links: 5, too_large: 6, unreadable: 7, waiting: 8, off: 9,
  library: 10, set: 10, excluded: 11,
};

const attention = new Set<LibraryCloudStatus>(["review", "failed", "links", "too_large", "unreadable"]);

/** One row per folder key, as the web's cloudSkillRows. */
function cloudRows(state: CloudSaveState, installed: SyncedSkill[]): Map<string, CloudRow> {
  const names = new Map<string, string>();
  const fromLibrary = new Set<string>();
  const fromCatalog = new Set<string>();
  for (const skill of installed) {
    if (skill.isCurrent === false) continue;
    const key = cloudSkillKey(skill.installationFolder || skill.name);
    if (!key) continue;
    if (!names.has(key)) names.set(key, skill.name);
    if (skill.catalogSkillId || skill.installedFromSet) fromLibrary.add(key);
    if (skill.catalogSkillId) fromCatalog.add(key);
  }
  const saved = new Map(state.skills.map(skill => [skill.key, skill]));
  const reviews = new Map(state.needsReview.map(review => [review.key, review]));
  const excluded = new Set(state.settings.excludedSkillKeys);
  const keys = [...new Set([...names.keys(), ...saved.keys(), ...reviews.keys()])];
  const nameCounts = new Map<string, number>();
  for (const key of keys) {
    const name = names.get(key) ?? key;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const label = (key: string) => {
    const name = names.get(key) ?? key;
    return (nameCounts.get(name) ?? 0) > 1 && cloudSkillKey(name) !== key ? `${name} (folder ${key})` : name;
  };
  return new Map(keys.map((key): [string, CloudRow] => {
    const copy = saved.get(key);
    const review = reviews.get(key);
    const found: LibraryCloudStatus = excluded.has(key) ? "excluded"
      : review ? (review.confirmed ? "confirmed" : "review")
      : copy ? (copy.deletedLocallyAt ? "deleted" : fromLibrary.has(key) ? "library" : "saved")
      : !state.settings.enabled ? "off"
      : state.skipped[key] === "library" ? "waiting"
      : state.skipped[key] ?? "waiting";
    const status = found === "library" && fromLibrary.has(key) && !fromCatalog.has(key) ? "set" : found;
    return [key, {
      key, name: label(key), status, savedAt: copy?.currentVersion.savedAt ?? null,
      confirmedSecret: !!copy?.currentVersion.labels?.includes("confirmed_secret"),
      onMac: names.has(key), origin: fromCatalog.has(key) ? "library" : fromLibrary.has(key) ? "set" : null,
    }];
  }));
}

/** The status a skill with copies in several folders shows: the one that needs attention first. */
function pickRow(rows: Map<string, CloudRow>, keys: string[]): CloudRow | null {
  let best: CloudRow | null = null;
  const rank = (row: CloudRow) => (attention.has(row.status) ? 0 : 100) + statusOrder[row.status];
  for (const key of keys) {
    const row = rows.get(key);
    if (row && (!best || rank(row) < rank(best))) best = row;
  }
  return best;
}

const reasons: Partial<Record<LibraryCloudStatus, string>> = {
  review: "A file may contain a key or password; review it on the web.",
  confirmed: "A file contains a key or password, so it is never shared with agents.",
  failed: "It couldn't be synced.",
  links: "It contains links outside the skill, so it couldn't be synced.",
  too_large: "It's too large to sync.",
  unreadable: "It couldn't be read on your Mac.",
};

/**
 * What an agent may read. Locked skills (anything needing attention, or a saved key or password) never are.
 * Your saved copy comes first; a library skill without one reads its public version. A personal skill with no
 * saved copy is only on your Mac.
 */
function access(row: CloudRow | null, catalogId: string | null, saved: boolean):
  Pick<LibrarySkill, "available" | "source" | "reason"> {
  if (row && (attention.has(row.status) || row.status === "confirmed" || row.confirmedSecret)) {
    return { available: false, source: null, reason: reasons[row.confirmedSecret ? "confirmed" : row.status] ?? "It needs a look on the web." };
  }
  if (saved && row?.status !== "excluded") return { available: true, source: "saved", reason: null };
  if (catalogId) return { available: true, source: "public", reason: null };
  if (row?.status === "excluded") return { available: false, source: null, reason: "It's left out of sync, so it's only on your Mac." };
  return { available: false, source: null, reason: "It's only on your Mac (not synced)." };
}

function originOf(catalogId: string | null, copies: SyncedSkill[]): LibrarySkill["origin"] {
  if (catalogId) return "library";
  return copies.some(copy => copy.installedFromSet) ? "set" : "personal";
}

export function buildMySkills(input: MySkillsInputs): MySkillsLibrary {
  const now = input.now ?? Date.now();
  const catalog = input.catalog ?? new Map<string, CatalogDetails>();
  const grouped = groupSyncedSkills(input.inventory, { groupInstallations: true });
  // Skills some Mac has now, with only their live copies (the web's liveMine).
  const mine = grouped.map(skill => ({ skill, live: skill.sourceSkills.filter(copy => isLive(copy, now)) }))
    .filter(entry => entry.live.length > 0);
  const rows = input.cloud ? cloudRows(input.cloud, input.inventory) : new Map<string, CloudRow>();

  const installedSkills: LibrarySkill[] = mine.map(({ skill, live }) => {
    const catalogId = skill.catalogSkillId || null;
    const keys = keysOf(live);
    const row = pickRow(rows, keys);
    const savedKey = keys.find(key => rows.get(key)?.savedAt) ?? null;
    const details = catalogId ? catalog.get(catalogId) : undefined;
    return {
      id: catalogId ? `lib:${catalogId}` : `key:${keys[0]}`,
      name: skill.name,
      description: skill.description || "",
      author: details?.author || catalogOwner(catalogId),
      catalogId,
      githubUrl: skill.githubUrl,
      origin: originOf(catalogId, live),
      installed: true,
      savedKey,
      status: row?.status ?? null,
      ...access(row, catalogId, !!savedKey),
    };
  });

  // Saved copies no Mac has now; details from the last copy a Mac reported, unless that skill is still installed.
  const listed = new Set(mine.flatMap(({ live }) => keysOf(live)));
  const notInstalled: LibrarySkill[] = [...rows.values()].filter(row => row.savedAt && !listed.has(row.key)).map(row => {
    const last = grouped.find(skill => keysOf(skill.sourceSkills).includes(row.key));
    const stillInstalled = last && mine.some(entry => entry.skill.id === last.id);
    const from = last && !stillInstalled ? last : null;
    const catalogId = from?.catalogSkillId || null;
    return {
      id: catalogId ? `lib:${catalogId}` : `key:${row.key}`,
      name: from?.name ?? row.name,
      description: from?.description || "",
      author: from ? (catalogId ? catalog.get(catalogId)?.author || catalogOwner(catalogId) : "") : "",
      catalogId,
      githubUrl: from?.githubUrl ?? null,
      origin: from ? originOf(catalogId, from.sourceSkills) : "personal",
      installed: false,
      savedKey: row.key,
      status: row.status,
      ...access(row, catalogId, true),
    };
  });

  // Library skills added to My skills that no Mac has; once installed, the installed skill stands for them.
  const seen = new Set<string>();
  const added: LibrarySkill[] = input.additions.filter(id => !seen.has(id) && seen.add(id)
    && !mine.some(({ skill, live }) => skill.catalogSkillId === id
      || hasCatalogId({ ...skill, sourceSkills: live } as GroupedSyncedSkill, id)))
    .map(id => {
      const details = catalog.get(id);
      return {
        id: `lib:${id}`,
        name: details?.name || id.split(":").at(-1) || id,
        description: details?.description ?? "",
        author: details?.author || (id.split("/")[0] ?? ""),
        catalogId: id,
        githubUrl: details?.githubUrl ?? null,
        origin: "library",
        installed: false,
        savedKey: null,
        status: null,
        available: true,
        source: "public",
        reason: null,
      };
    });

  const notInstalledAll = [...notInstalled,
    ...added.filter(skill => !notInstalled.some(other => other.catalogId === skill.catalogId))];
  const skills = [...installedSkills, ...notInstalledAll];
  // Two skills can share a library ID (different names, same catalog skill); each keeps an ID of its own.
  const ids = new Set<string>();
  for (const skill of skills) {
    if (ids.has(skill.id)) skill.id = `${skill.id}#${skill.savedKey ?? cloudSkillKey(skill.name)}`;
    ids.add(skill.id);
  }
  return { skills, count: skills.length, notInstalledCount: notInstalledAll.length };
}

export type MySkillsLoadDependencies = {
  readInventory: (userId: string) => Promise<SyncedSkill[]>;
  readCloud: (userId: string) => Promise<CloudSaveState>;
  readAdditions: (userId: string) => Promise<string[]>;
  /** Library details for these IDs; may return fewer, or throw (then names fall back to IDs). */
  catalogDetails?: (ids: string[]) => Promise<Map<string, CatalogDetails>>;
  now?: () => number;
};

/**
 * Loads one user's My skills. Inventory and additions must load; cloud save and library details are best effort,
 * like the web, and what failed is listed in `partial` so a caller can say so.
 */
export async function loadMySkills(userId: string, deps: MySkillsLoadDependencies):
  Promise<MySkillsLibrary & { partial: ("cloud" | "catalog")[] }> {
  const partial: ("cloud" | "catalog")[] = [];
  const [inventory, cloud, additions] = await Promise.all([
    deps.readInventory(userId),
    deps.readCloud(userId).catch(() => { partial.push("cloud"); return null; }),
    deps.readAdditions(userId),
  ]);
  const ids = [...new Set([...inventory.map(skill => skill.catalogSkillId).filter((id): id is string => !!id), ...additions])];
  let catalog = new Map<string, CatalogDetails>();
  if (deps.catalogDetails && ids.length) {
    try { catalog = await deps.catalogDetails(ids); } catch { partial.push("catalog"); }
  }
  return { ...buildMySkills({ inventory, cloud, additions, catalog, now: deps.now?.() }), partial };
}
