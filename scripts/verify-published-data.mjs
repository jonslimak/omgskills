#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const dataRoot = process.env.OMGSKILLS_DATA_ROOT ?? join(repoRoot, "site", "data");
const dataTrackSubdir = process.env.OMGSKILLS_DATA_SUBDIR ?? "";
const dataDir = dataTrackSubdir
  ? join(dataRoot, dataTrackSubdir)
  : dataRoot;
const manifestPath = join(dataDir, "manifest.json");

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function fail(message) {
  console.error(`verify-published-data: ${message}`);
  process.exit(1);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizedSkillName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function repoFromGithubUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (url.hostname.toLowerCase() !== "github.com") return "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return "";
    return `${parts[0].toLowerCase()}/${parts[1].replace(/\.git$/i, "").toLowerCase()}`;
  } catch {
    return "";
  }
}

function skillEquivalenceGroupId(memberSkillIds) {
  const members = [...new Set(memberSkillIds)].sort();
  return `eq-${sha256Hex(Buffer.from(members.join("\n")))}`;
}

function assertAsset(name, asset) {
  if (!asset?.path || !asset?.sha256 || typeof asset.bytes !== "number") {
    fail(`${name} asset is incomplete in manifest`);
  }

  const assetPath = join(dataDir, asset.path);
  if (!existsSync(assetPath)) {
    fail(`${name} asset file is missing: ${asset.path}`);
  }

  const data = readFileSync(assetPath);
  const bytes = statSync(assetPath).size;
  const hash = sha256Hex(data);

  if (bytes !== asset.bytes) {
    fail(`${name} byte count mismatch: manifest=${asset.bytes} actual=${bytes}`);
  }
  if (hash !== asset.sha256) {
    fail(`${name} sha256 mismatch`);
  }

  return { path: assetPath, decoded: JSON.parse(data.toString("utf8")) };
}

const manifest = loadJson(manifestPath);
if (typeof manifest.version !== "number") {
  fail("manifest version missing");
}

const skills = assertAsset("skills", manifest.skills);
const trending = assertAsset("trending", manifest.trending);
const trendingLeaderboard = manifest.trendingLeaderboard
  ? assertAsset("trendingLeaderboard", manifest.trendingLeaderboard)
  : null;
const leaderboardViewData = manifest.leaderboardViewData
  ? assertAsset("leaderboardViewData", manifest.leaderboardViewData)
  : null;
const xTrending = manifest.xTrending ? assertAsset("xTrending", manifest.xTrending) : null;
const skillSignals = manifest.skillSignals ? assertAsset("skillSignals", manifest.skillSignals) : null;
const authorSignals = manifest.authorSignals ? assertAsset("authorSignals", manifest.authorSignals) : null;
const authorLeaderboards = manifest.authorLeaderboards ? assertAsset("authorLeaderboards", manifest.authorLeaderboards) : null;
const shaHistory = manifest.shaHistory ? assertAsset("shaHistory", manifest.shaHistory) : null;
const collections = manifest.collections ? assertAsset("collections", manifest.collections) : null;
const skillEquivalence = manifest.skillEquivalence
  ? assertAsset("skillEquivalence", manifest.skillEquivalence)
  : null;

if (!Array.isArray(skills.decoded)) fail("skills payload must be an array");
if (!Array.isArray(trending.decoded)) fail("trending payload must be an array");
if (trendingLeaderboard && !Array.isArray(trendingLeaderboard.decoded)) {
  fail("trendingLeaderboard payload must be an array");
}
if (leaderboardViewData && (!leaderboardViewData.decoded || Array.isArray(leaderboardViewData.decoded))) {
  fail("leaderboardViewData payload must be an object");
}
if (xTrending && !Array.isArray(xTrending.decoded)) fail("xTrending payload must be an array");
if (skillSignals && !Array.isArray(skillSignals.decoded)) fail("skillSignals payload must be an array");
if (authorSignals && !Array.isArray(authorSignals.decoded)) fail("authorSignals payload must be an array");
if (authorLeaderboards && !Array.isArray(authorLeaderboards.decoded)) fail("authorLeaderboards payload must be an array");
if (shaHistory && (!shaHistory.decoded || Array.isArray(shaHistory.decoded))) {
  fail("shaHistory payload must be an object");
}
if (collections && (!collections.decoded || Array.isArray(collections.decoded))) {
  fail("collections payload must be an object");
}
if (skillEquivalence && (!skillEquivalence.decoded || Array.isArray(skillEquivalence.decoded))) {
  fail("skillEquivalence payload must be an object");
}

const skillsById = new Map(skills.decoded.map((item) => [item?.id, item]).filter(([id]) => Boolean(id)));
const skillIds = new Set(skillsById.keys());
const authorHandles = new Set(skills.decoded.map((item) => item?.author_handle).filter(Boolean));
let staleCollectionReferenceCount = 0;
let skillEquivalenceGroupCount = 0;

if (skillEquivalence) {
  const data = skillEquivalence.decoded;
  if (data.version !== 1 || typeof data.generatedAt !== "string" || !data.generatedAt) {
    fail("skillEquivalence must include version 1 and generatedAt");
  }
  if (!Array.isArray(data.groups)) {
    fail("skillEquivalence.groups must be an array");
  }

  const claimedSkillIds = new Set();
  for (const group of data.groups) {
    if (!group || Array.isArray(group) || typeof group !== "object") {
      fail("skillEquivalence contains a non-object group");
    }
    if (!Array.isArray(group.memberSkillIds)) {
      fail(`skillEquivalence group is missing memberSkillIds: ${group.id ?? "<missing>"}`);
    }
    if (group.memberSkillIds.some((member) => typeof member !== "string" || !member)) {
      fail(`skillEquivalence group contains an invalid member ID: ${group.id ?? "<missing>"}`);
    }
    const sortedMembers = [...new Set(group.memberSkillIds)].sort();
    if (
      sortedMembers.length !== 2 ||
      sortedMembers.length !== group.memberSkillIds.length ||
      sortedMembers.some((member, index) => member !== group.memberSkillIds[index])
    ) {
      fail(`skillEquivalence v1 group must contain two sorted unique members: ${group.id ?? "<missing>"}`);
    }
    const expectedGroupId = skillEquivalenceGroupId(group.memberSkillIds);
    if (group.id !== expectedGroupId) {
      fail(`skillEquivalence group ID does not match its members: ${group.id ?? "<missing>"}`);
    }
    if (!group.memberSkillIds.includes(group.representativeSkillId)) {
      fail(`skillEquivalence representative is not a member: ${group.id}`);
    }
    if (
      !group.preferredSkillIds ||
      Array.isArray(group.preferredSkillIds) ||
      typeof group.preferredSkillIds !== "object"
    ) {
      fail(`skillEquivalence preferredSkillIds must be an object: ${group.id}`);
    }
    for (const [agent, preferredSkillId] of Object.entries(group.preferredSkillIds)) {
      if (typeof preferredSkillId !== "string" || !group.memberSkillIds.includes(preferredSkillId)) {
        fail(`skillEquivalence preferred ${agent} skill is not a member: ${group.id}`);
      }
    }
    if (group.confidence !== "high") {
      fail(`skillEquivalence group must be high confidence: ${group.id}`);
    }
    if (
      !Array.isArray(group.evidence) ||
      group.evidence.length === 0 ||
      group.evidence.some((entry) => typeof entry !== "string" || !entry)
    ) {
      fail(`skillEquivalence group has invalid evidence: ${group.id}`);
    }

    const memberSkills = group.memberSkillIds.map((memberSkillId) => skillsById.get(memberSkillId));
    if (memberSkills.some((member) => !member)) {
      fail(`skillEquivalence group contains a non-live member: ${group.id}`);
    }
    const memberRepos = memberSkills.map((member) => repoFromGithubUrl(member.github_url));
    if (memberRepos.some((repo) => !repo) || new Set(memberRepos).size !== 1) {
      fail(`skillEquivalence members must share one GitHub repository: ${group.id}`);
    }
    const memberNames = memberSkills.map((member) => normalizedSkillName(member.name));
    if (memberNames.some((name) => !name) || new Set(memberNames).size !== 1) {
      fail(`skillEquivalence members must share one normalized name: ${group.id}`);
    }
    const shas = new Set(
      memberSkills
        .map((member) => String(member.skill_md_sha ?? "").trim().toLowerCase())
        .filter(Boolean),
    );
    if (shas.size !== 2) {
      fail(`skillEquivalence members must have distinct non-empty SHAs: ${group.id}`);
    }

    for (const memberSkillId of group.memberSkillIds) {
      if (claimedSkillIds.has(memberSkillId)) {
        fail(`skillEquivalence member belongs to multiple groups: ${memberSkillId}`);
      }
      claimedSkillIds.add(memberSkillId);
    }
  }
  skillEquivalenceGroupCount = data.groups.length;
}

if (collections) {
  const data = collections.decoded;
  if (data.version !== 1 || typeof data.generatedAt !== "string" || !data.generatedAt) {
    fail("collections must include version 1 and generatedAt");
  }
  if (!Array.isArray(data.collections)) {
    fail("collections.collections must be an array");
  }

  const collectionIds = new Set();
  for (const entry of data.collections) {
    if (!entry || Array.isArray(entry) || typeof entry !== "object") {
      fail("collections contains a non-object entry");
    }
    if (typeof entry.id !== "string" || !entry.id) {
      fail("collections entry is missing id");
    }
    if (collectionIds.has(entry.id)) {
      fail(`collections contains duplicate id: ${entry.id}`);
    }
    collectionIds.add(entry.id);
    if (!["author", "topic"].includes(entry.type)) {
      fail(`collections entry has invalid type: ${entry.id}`);
    }
    if (typeof entry.title !== "string" || !entry.title || typeof entry.subtitle !== "string" || !entry.subtitle) {
      fail(`collections entry is missing title or subtitle: ${entry.id}`);
    }
    if (!Array.isArray(entry.featuredSkillIds) || entry.featuredSkillIds.some((id) => typeof id !== "string" || !id)) {
      fail(`collections entry has invalid featuredSkillIds: ${entry.id}`);
    }
    if (entry.type === "author" && (typeof entry.authorHandle !== "string" || !entry.authorHandle)) {
      fail(`author collection is missing authorHandle: ${entry.id}`);
    }
    if (entry.type === "topic" && !Array.isArray(entry.skillIds)) {
      fail(`topic collection is missing skillIds: ${entry.id}`);
    }
    if (entry.skillIds !== undefined && (!Array.isArray(entry.skillIds) || entry.skillIds.some((id) => typeof id !== "string" || !id))) {
      fail(`collections entry has invalid skillIds: ${entry.id}`);
    }

    for (const skillId of new Set([...(entry.featuredSkillIds ?? []), ...(entry.skillIds ?? [])])) {
      if (!skillIds.has(skillId)) {
        staleCollectionReferenceCount += 1;
        console.error(
          `verify-published-data: warning: ${entry.id} references ${skillId}, which is absent from the ${dataTrackSubdir || "root"} skills asset`,
        );
      }
    }
  }
}

for (const entry of trending.decoded) {
  if (!entry?.id || !skillIds.has(entry.id)) {
    fail(`trending entry missing matching skill id: ${entry?.id ?? "<missing>"}`);
  }
}

for (const entry of trendingLeaderboard?.decoded ?? []) {
  if (!entry?.id || !skillIds.has(entry.id)) {
    fail(`trendingLeaderboard entry missing matching skill id: ${entry?.id ?? "<missing>"}`);
  }
  if (!entry.name || !entry.authorHandle || typeof entry.installs !== "number") {
    fail(`trendingLeaderboard entry is missing required display fields: ${entry.id}`);
  }
}

if (leaderboardViewData) {
  const data = leaderboardViewData.decoded;
  if (!Array.isArray(data.topSkills) || data.topSkills.length !== 10) {
    fail("leaderboardViewData.topSkills must contain 10 rows");
  }
  if (!Array.isArray(data.creatorCategories) || data.creatorCategories.length !== 6) {
    fail("leaderboardViewData.creatorCategories must contain 6 categories");
  }
  if (!Array.isArray(data.allRounders)) {
    fail("leaderboardViewData.allRounders must be an array");
  }
  for (const skill of data.topSkills) {
    if (!skill?.id || !skill.name || !skill.authorHandle || typeof skill.installs !== "number") {
      fail("leaderboardViewData.topSkills contains an invalid row");
    }
  }
  for (const category of data.creatorCategories) {
    if (!category?.id || !category.title || !Array.isArray(category.rows) || category.rows.length === 0) {
      fail(`leaderboardViewData creator category is invalid: ${category?.id ?? "<missing>"}`);
    }
  }
}

for (const entry of skillSignals?.decoded ?? []) {
  if (!entry?.id || !skillIds.has(entry.id)) {
    fail(`skillSignals entry missing matching skill id: ${entry?.id ?? "<missing>"}`);
  }
}

for (const entry of authorSignals?.decoded ?? []) {
  if (!entry?.authorHandle || !authorHandles.has(entry.authorHandle)) {
    fail(`authorSignals entry missing matching author handle: ${entry?.authorHandle ?? "<missing>"}`);
  }
  for (const skillId of entry?.topSkillIds ?? []) {
    if (!skillIds.has(skillId)) {
      fail(`authorSignals top skill missing from skills payload: ${skillId}`);
    }
  }
}

for (const entry of authorLeaderboards?.decoded ?? []) {
  if (!entry?.authorHandle || !authorHandles.has(entry.authorHandle)) {
    fail(`authorLeaderboards entry missing matching author handle: ${entry?.authorHandle ?? "<missing>"}`);
  }
}

if (shaHistory) {
  if (shaHistory.decoded.version !== 1 || !shaHistory.decoded.shaToSkillIds || Array.isArray(shaHistory.decoded.shaToSkillIds)) {
    fail("shaHistory must include version 1 and shaToSkillIds object");
  }
  for (const [sha, ids] of Object.entries(shaHistory.decoded.shaToSkillIds)) {
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      fail(`shaHistory contains invalid git blob sha: ${sha}`);
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      fail(`shaHistory entry must map to a non-empty id array: ${sha}`);
    }
    for (const id of ids) {
      if (typeof id !== "string" || id.length === 0) {
        fail(`shaHistory entry contains invalid skill id for ${sha}`);
      }
    }
  }

  const canonicalBySha = shaHistory.decoded.canonicalBySha;
  if (canonicalBySha !== undefined) {
    if (!canonicalBySha || Array.isArray(canonicalBySha) || typeof canonicalBySha !== "object") {
      fail("shaHistory canonicalBySha must be an object when present");
    }
    for (const [sha, entry] of Object.entries(canonicalBySha)) {
      if (!/^[0-9a-f]{40}$/.test(sha)) {
        fail(`canonicalBySha contains invalid git blob sha: ${sha}`);
      }
      if (!entry || Array.isArray(entry) || typeof entry !== "object") {
        fail(`canonicalBySha entry must be an object: ${sha}`);
      }
      if (typeof entry.skillId !== "string" || entry.skillId.length === 0) {
        fail(`canonicalBySha entry is missing skillId: ${sha}`);
      }
      if (entry.confidence !== "high" || entry.reason !== "same-repo") {
        fail(`canonicalBySha entry must be high-confidence same-repo: ${sha}`);
      }
      const memberIds = shaHistory.decoded.shaToSkillIds[sha];
      if (!Array.isArray(memberIds) || !memberIds.includes(entry.skillId)) {
        fail(`canonicalBySha skill is not a member of ${sha}: ${entry.skillId}`);
      }
      const liveSkill = skillsById.get(entry.skillId);
      if (!liveSkill) {
        fail(`canonicalBySha skill is not live: ${entry.skillId}`);
      }
      if (String(liveSkill.skill_md_sha ?? "").trim().toLowerCase() !== sha) {
        fail(`canonicalBySha skill SHA does not match ${sha}: ${entry.skillId}`);
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      skillsCount: skills.decoded.length,
      trendingCount: trending.decoded.length,
      trendingLeaderboardCount: trendingLeaderboard?.decoded.length ?? 0,
      leaderboardViewDataCategories: leaderboardViewData?.decoded?.creatorCategories?.length ?? 0,
      xTrendingCount: xTrending?.decoded.length ?? 0,
      skillSignalsCount: skillSignals?.decoded.length ?? 0,
      authorSignalsCount: authorSignals?.decoded.length ?? 0,
      authorLeaderboardsCount: authorLeaderboards?.decoded.length ?? 0,
      collectionsCount: collections?.decoded.collections.length ?? 0,
      staleCollectionReferenceCount,
      shaHistoryCount: shaHistory ? Object.keys(shaHistory.decoded.shaToSkillIds).length : 0,
      canonicalByShaCount: shaHistory ? Object.keys(shaHistory.decoded.canonicalBySha ?? {}).length : 0,
      skillEquivalenceGroupCount,
    },
    null,
    2,
  ),
);
