import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
  useUser
} from "@clerk/clerk-react";
import {
  ArrowUpRight,
  Check,
  Earth,
  Eye,
  EyeOff,
  Grid2X2Plus,
  Lock,
  Pencil,
  RefreshCcw,
  Star,
  Trash2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const iconClassName = "app-icon";

function publicSiteOrigin() {
  if (window.location.hostname === "app.omgskills.com") {
    return "https://omgskills.com";
  }

  return window.location.origin;
}

function publicGroupUrl(handle: string, slug: string) {
  return `${publicSiteOrigin()}/profiles/${handle}/sets/${slug}`;
}

function groupVisibilityLabel(visibility: string | undefined) {
  return visibility === "public" ? "public" : "private";
}

function normalizedSkillText(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedDescriptionWords(value: string | null | undefined) {
  return normalizedSkillText(value)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((word) => word.length > 2);
}

function descriptionsMatch(first: string | null | undefined, second: string | null | undefined) {
  const normalizedFirst = normalizedSkillText(first);
  const normalizedSecond = normalizedSkillText(second);

  if (normalizedFirst === normalizedSecond) {
    return true;
  }
  if (!normalizedFirst || !normalizedSecond) {
    return false;
  }
  if (
    Math.min(normalizedFirst.length, normalizedSecond.length) >= 35 &&
    (normalizedFirst.includes(normalizedSecond) || normalizedSecond.includes(normalizedFirst))
  ) {
    return true;
  }

  const firstWords = new Set(normalizedDescriptionWords(normalizedFirst));
  const secondWords = new Set(normalizedDescriptionWords(normalizedSecond));
  const smallerSize = Math.min(firstWords.size, secondWords.size);

  let shared = 0;
  for (const word of firstWords) {
    if (secondWords.has(word)) {
      shared += 1;
    }
  }

  if (smallerSize >= 3 && smallerSize < 5) {
    return shared / smallerSize >= 0.8;
  }

  if (smallerSize < 5) {
    return false;
  }

  return shared / smallerSize >= 0.72;
}

function normalizedSource(value: string) {
  return value.toLowerCase();
}

function hasSource(skill: GroupedSyncedSkill, source: string) {
  const target = source.toLowerCase();
  return skill.sources.some((item) => normalizedSource(item).includes(target));
}

function chooseRepresentativeSkill(skills: SyncedSkill[]) {
  const representative =
    skills.find((skill) => normalizedSource(skill.source).includes("codex")) ??
    skills.find((skill) => Boolean(skill.githubUrl)) ??
    [...skills].sort((first, second) => first.source.localeCompare(second.source))[0];

  if (!representative) {
    throw new Error("Cannot group empty synced skill set");
  }

  return representative;
}

function groupSyncedSkills(skills: SyncedSkill[]): GroupedSyncedSkill[] {
  const groups: SyncedSkill[][] = [];
  for (const skill of skills) {
    const skillName = normalizedSkillText(skill.name);
    const matchingGroup = groups.find((group) => {
      const firstSkill = group[0];
      if (normalizedSkillText(firstSkill.name) !== skillName) {
        return false;
      }
      if (skill.githubUrl && firstSkill.githubUrl && skill.githubUrl === firstSkill.githubUrl) {
        return true;
      }
      return group.some((groupSkill) => descriptionsMatch(groupSkill.description, skill.description));
    });

    if (matchingGroup) {
      matchingGroup.push(skill);
    } else {
      groups.push([skill]);
    }
  }

  return groups
    .map((group) => {
      const representative = chooseRepresentativeSkill(group);
      const bestDescription =
        [...group]
          .map((skill) => skill.description)
          .filter((description): description is string => Boolean(description))
          .sort((first, second) => second.length - first.length)[0] ?? null;
      const sources = [...new Set(group.map((skill) => skill.source))].sort((first, second) =>
        first.localeCompare(second)
      );
      return {
        ...representative,
        description: bestDescription,
        githubUrl: representative.githubUrl ?? group.find((skill) => skill.githubUrl)?.githubUrl ?? null,
        allSkillIds: group.map((skill) => skill.id),
        sourceSkills: group,
        sources
      };
    })
    .sort((first, second) => first.name.localeCompare(second.name));
}

type SyncedSkill = {
  id: string;
  name: string;
  description: string | null;
  skillMdSha?: string | null;
  identityStatus?: "resolved" | "ambiguous" | "localOnly";
  githubUrl: string | null;
  isLocalOnly: boolean;
  source: string;
  lastSeenAt: string;
};

type GroupedSyncedSkill = SyncedSkill & {
  allSkillIds: string[];
  sourceSkills: SyncedSkill[];
  sources: string[];
};

type SkillGroup = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  visibility?: string;
  isFavorites?: boolean;
  disabledAt?: string | null;
  itemCount: number;
  allowedEmailCount?: number;
  allowedEmails?: { id: string; email: string }[];
  ownerDisplayName?: string;
  syncedSkillIds?: string[];
};

type SkillGroupItem = {
  id: string;
  kind: string;
  name: string;
  description: string;
  githubUrl: string | null;
  source: string;
  position: number;
};

type SkillGroupDetail = SkillGroup & {
  accessRole: "owner" | "invited";
  allowedEmails?: { id: string; email: string }[];
};

type Profile = {
  handle: string | null;
  profilePublished: boolean;
  publicUrl: string | null;
};

type ApiState = {
  syncedSkills: SyncedSkill[];
  groups: SkillGroup[];
  sharedGroups: SkillGroup[];
  profile: Profile | null;
};

function dashboardCacheKey(userId: string) {
  return `omgskills.portal.dashboard.${userId}.v1`;
}

function readDashboardCache(userId: string) {
  try {
    const cached = window.localStorage.getItem(dashboardCacheKey(userId));
    return cached ? (JSON.parse(cached) as ApiState) : null;
  } catch {
    return null;
  }
}

function writeDashboardCache(userId: string, state: ApiState) {
  try {
    window.localStorage.setItem(dashboardCacheKey(userId), JSON.stringify(state));
  } catch {
    // Cache is best effort; the live API remains the source of truth.
  }
}

function usePortalApi() {
  const { getToken } = useAuth();

  return async function portalApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error ?? `Request failed with ${response.status}`);
    }
    return body as T;
  };
}

function SyncAppButton({ hasSynced }: { hasSynced: boolean }) {
  const api = usePortalApi();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [token, setToken] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [copyStatus, setCopyStatus] = useState<string>("");

  function openPopover() {
    setIsPopoverOpen(true);
    setStatus("");
    setCopyStatus("");
  }

  async function createToken() {
    setStatus("Generating new token...");
    setCopyStatus("");
    try {
      const result = await api<{ token: string; expiresAt: string }>("/api/portal/sync-token", {
        method: "POST",
        body: JSON.stringify({})
      });
      setToken(result.token);
      setStatus("Token is ready.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create token");
    }
  }

  async function copyToken() {
    if (!token) {
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      setCopyStatus("Copied.");
    } catch {
      setCopyStatus("Select and copy the token.");
    }
  }

  return (
    <>
      <Button
        className={hasSynced ? "sync-resync" : ""}
        onClick={openPopover}
        size={hasSynced ? "sm" : "default"}
        variant={hasSynced ? "link" : "default"}
      >
        {hasSynced ? "Resync" : "Sync app"}
      </Button>
      <Dialog open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <DialogContent className="sync-modal-card" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Sync your app</DialogTitle>
            <DialogDescription className="sr-only">
              Generate a one time token and paste it into the local omgskills app.
            </DialogDescription>
          </DialogHeader>
          <div className="sync-step">
            <h3>Step 1</h3>
            <p>Generate a one time token for your local app</p>
            <Button onClick={createToken}>Generate new token</Button>
            <div className="sync-token-area">
              {token ? (
                <Button className="sync-token-button" onClick={copyToken} title="Copy token" type="button" variant="link">
                  {token}
                </Button>
              ) : null}
              {status ? <p className="sync-status">{status}</p> : null}
              {copyStatus ? <p className="sync-status">{copyStatus}</p> : null}
            </div>
          </div>
          <div className="sync-step">
            <h3>Step 2</h3>
            <p>Open the app and tap on the user icon.</p>
            <p>Paste the token in the token input box.</p>
            <p>That's it!</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SkillActions({
  skill,
  groups,
  onRefresh
}: {
  skill: GroupedSyncedSkill;
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  const api = usePortalApi();
  const [status, setStatus] = useState("");
  const favoritesGroup = groups.find((group) => group.isFavorites);
  const isFavorite = Boolean(favoritesGroup?.syncedSkillIds?.some((id) => skill.allSkillIds.includes(id)));
  const selectableGroups = groups.filter((group) => !group.isFavorites);

  async function addToFavorites() {
    if (isFavorite) {
      return;
    }
    setStatus("Adding to Favorites...");
    try {
      if (favoritesGroup) {
        await api(`/api/portal/groups/${favoritesGroup.id}/items`, {
          method: "POST",
          body: JSON.stringify({ kind: "synced", syncedSkillId: skill.id })
        });
      } else {
        await api("/api/portal/groups", {
          method: "POST",
          body: JSON.stringify({
            name: "Favorite Skills",
            visibility: "public",
            isFavorites: true,
            syncedSkillIds: [skill.id]
          })
        });
      }
      setStatus("");
      onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add to Favorites");
    }
  }

  async function addToGroup(group: SkillGroup) {
    if (group.syncedSkillIds?.some((id) => skill.allSkillIds.includes(id))) {
      return;
    }
    setStatus(`Adding to ${group.name}...`);
    try {
      await api(`/api/portal/groups/${group.id}/items`, {
        method: "POST",
        body: JSON.stringify({ kind: "synced", syncedSkillId: skill.id })
      });
      setStatus("");
      onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add to group");
    }
  }

  return (
    <div className="skill-action-stack">
      <div className="skill-actions">
        <Button
          aria-label={isFavorite ? "Already in Favorites" : "Add to Favorites"}
          className={isFavorite ? "icon-button active" : "icon-button"}
          disabled={isFavorite}
          onClick={addToFavorites}
          size="icon"
          title={isFavorite ? "Already in Favorites" : "Add to Favorites"}
          variant="secondary"
        >
          <Star className={iconClassName} fill={isFavorite ? "currentColor" : "none"} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Add to group" className="icon-button" size="icon" title="Add to group" variant="secondary">
              <Grid2X2Plus className={iconClassName} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {selectableGroups.length === 0 ? <DropdownMenuItem disabled>No groups yet</DropdownMenuItem> : null}
            {selectableGroups.map((group) => {
              const alreadyAdded = group.syncedSkillIds?.some((id) => skill.allSkillIds.includes(id)) ?? false;
              return (
                <DropdownMenuItem
                  disabled={alreadyAdded}
                  key={group.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    void addToGroup(group);
                  }}
                >
                  <span>{group.name}</span>
                  {alreadyAdded ? <Check className={iconClassName} /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {status ? <p className="inline-status">{status}</p> : null}
    </div>
  );
}

function SyncedSkillRow({
  skill,
  groups,
  onRefresh
}: {
  skill: GroupedSyncedSkill;
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const description = skill.description || "No description";
  const canExpand = description.length > 90;

  function isInteractiveTarget(target: EventTarget | null) {
    return target instanceof HTMLElement
      ? Boolean(target.closest("a, button, input, select, textarea"))
      : false;
  }

  function expandFromRow(event: React.MouseEvent<HTMLDivElement>) {
    if (!canExpand || expanded || isInteractiveTarget(event.target)) {
      return;
    }

    setExpanded(true);
  }

  function expandFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!canExpand || expanded || event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setExpanded(true);
    }
  }

  return (
    <div
      aria-expanded={canExpand ? expanded : undefined}
      className={canExpand && !expanded ? "row expandable-row" : "row"}
      onClick={expandFromRow}
      onKeyDown={expandFromKeyboard}
      role={canExpand ? "button" : undefined}
      tabIndex={canExpand && !expanded ? 0 : undefined}
    >
      <div className="row-main">
        <h3 className="skill-title">
          <span>{skill.name}</span>
          {skill.githubUrl ? (
            <a href={skill.githubUrl} title="Open GitHub source">
              GitHub →
            </a>
          ) : null}
        </h3>
        <p className={expanded ? "skill-description expanded" : "skill-description"}>{description}</p>
        {canExpand && expanded ? (
          <Button className="text-button" onClick={() => setExpanded(false)} size="sm" variant="link">
            Show less
          </Button>
        ) : null}
        <div className="source-badges">
          {skill.sources.map((source) => (
            <Badge key={source} variant="secondary">{source}</Badge>
          ))}
        </div>
      </div>
      <SkillActions groups={groups} onRefresh={onRefresh} skill={skill} />
    </div>
  );
}

function SyncedSkillsTable({
  skills,
  groups,
  onRefresh
}: {
  skills: GroupedSyncedSkill[];
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  return (
    <div className="skill-table-wrap">
      <Table className="skill-table">
        <TableHeader>
          <TableRow>
            <TableHead>Skill</TableHead>
            <TableHead>Claude</TableHead>
            <TableHead>Codex</TableHead>
            <TableHead>GitHub</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {skills.map((skill) => (
            <TableRow key={skill.id}>
              <TableCell className="skill-table-name">{skill.name}</TableCell>
              <TableCell>{hasSource(skill, "claude") ? <Check className="app-icon table-check" /> : null}</TableCell>
              <TableCell>{hasSource(skill, "codex") ? <Check className="app-icon table-check" /> : null}</TableCell>
              <TableCell>
                {skill.githubUrl ? (
                  <a href={skill.githubUrl} title="Open GitHub source">
                    GitHub →
                  </a>
                ) : null}
              </TableCell>
              <TableCell>
                <SkillActions groups={groups} onRefresh={onRefresh} skill={skill} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SyncedSkillsPanel({
  skills,
  groups,
  onRefresh
}: {
  skills: SyncedSkill[];
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  const [viewMode, setViewMode] = useState<"list" | "table">(() =>
    window.localStorage.getItem("syncedSkillsViewMode") === "table" ? "table" : "list"
  );

  function updateViewMode(nextViewMode: "list" | "table") {
    setViewMode(nextViewMode);
    window.localStorage.setItem("syncedSkillsViewMode", nextViewMode);
  }

  const groupedSkills = groupSyncedSkills(skills);

  return (
    <Card className="panel">
      <div className="panel-header">
        <div>
          <h2>SKILLS</h2>
          <p>
            {groupedSkills.length} skills from {skills.length} installs.
          </p>
        </div>
        <div className="panel-controls">
          <Tabs value={viewMode} onValueChange={(value) => updateViewMode(value === "table" ? "table" : "list")}>
            <TabsList aria-label="Synced skills view" className="segmented-control">
              <TabsTrigger value="list">
              List
              </TabsTrigger>
              <TabsTrigger value="table">
              Table
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button aria-label="Refresh synced skills" className="icon-button" onClick={onRefresh} size="icon" title="Refresh synced skills" variant="secondary">
            <RefreshCcw className={iconClassName} />
          </Button>
        </div>
      </div>
      {viewMode === "table" && groupedSkills.length > 0 ? (
        <SyncedSkillsTable groups={groups} onRefresh={onRefresh} skills={groupedSkills} />
      ) : (
        <div className="list">
          {groupedSkills.map((skill) => (
            <SyncedSkillRow groups={groups} key={skill.id} onRefresh={onRefresh} skill={skill} />
          ))}
          {groupedSkills.length === 0 ? <p className="muted">No synced skills yet.</p> : null}
        </div>
      )}
    </Card>
  );
}

function ProfileHeaderControls({
  profile,
  onRefresh
}: {
  profile: Profile | null;
  onRefresh: () => void;
}) {
  const api = usePortalApi();
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [published, setPublished] = useState(profile?.profilePublished ?? false);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  const savedHandle = profile?.handle ?? "";
  const hasSavedHandle = Boolean(savedHandle);
  const mode = !hasSavedHandle ? "setup" : editing ? "edit" : "view";

  useEffect(() => {
    setHandle(profile?.handle ?? "");
    setPublished(profile?.profilePublished ?? false);
    setEditing(false);
  }, [profile]);

  async function saveProfile(nextPublished = published) {
    setStatus("Saving profile...");
    try {
      await api("/api/portal/profile", {
        method: "PATCH",
        body: JSON.stringify({ handle, profilePublished: nextPublished })
      });
      setStatus("Profile saved.");
      onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save profile");
    }
  }

  async function updatePublished(nextPublished: boolean) {
    setPublished(nextPublished);
    await saveProfile(nextPublished);
  }

  return (
    <div className="dashboard-profile">
      {mode === "view" && profile?.publicUrl ? (
        <div className="username-row">
          <a className="username-link" href={profile.publicUrl}>/{savedHandle}</a>
          <Button aria-label="Edit username" className="icon-button" onClick={() => setEditing(true)} size="icon" title="Edit username" variant="secondary">
            <Pencil className={iconClassName} />
          </Button>
        </div>
      ) : (
        <div className="username-row">
          <Input
            className="username-input"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="Set your username"
          />
          <Button className="compact" disabled={!handle.trim()} onClick={() => saveProfile()} size="sm">
            save
          </Button>
        </div>
      )}
      <div className="username-meta">
        <span>Username</span>
        <Label className={published ? "publish-toggle public" : "publish-toggle private"}>
          <span>{published ? "Public" : "Private"}</span>
          <Switch checked={published} onCheckedChange={(checked) => void updatePublished(checked)} />
        </Label>
      </div>
      {status ? <p className="inline-status">{status}</p> : null}
    </div>
  );
}

function GroupsPanel({
  title,
  groups,
  onRefresh,
  canManage = false,
  profile
}: {
  title: string;
  groups: SkillGroup[];
  onRefresh?: () => void;
  canManage?: boolean;
  profile?: Profile | null;
}) {
  const api = usePortalApi();
  const [status, setStatus] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [isEditingSets, setIsEditingSets] = useState(false);

  async function createGroup() {
    setStatus("Creating group...");
    try {
      await api<{ groupId: string }>("/api/portal/groups", {
        method: "POST",
        body: JSON.stringify({
          name: newGroupName,
          visibility: "restricted",
          syncedSkillIds: []
        })
      });

      setStatus("Group created.");
      setNewGroupName("");
      setIsEditingSets(false);
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create group");
    }
  }

  async function setVisibility(group: SkillGroup, visibility: string) {
    setStatus("Updating group...");
    try {
      await api(`/api/portal/groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility })
      });
      setStatus("Group updated.");
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update group");
    }
  }

  async function setDisabled(group: SkillGroup, disabled: boolean) {
    setStatus("Updating moderation state...");
    try {
      await api(`/api/portal/groups/${group.id}/moderation`, {
        method: "PATCH",
        body: JSON.stringify({ disabled })
      });
      setStatus(disabled ? "Group visibility disabled." : "Group restored.");
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update moderation state");
    }
  }

  function isInteractiveTarget(target: EventTarget | null) {
    return target instanceof HTMLElement
      ? Boolean(target.closest("a, button, input, select, textarea"))
      : false;
  }

  function openGroup(groupId: string, event: React.MouseEvent<HTMLDivElement>) {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    window.location.href = `/app/groups/${groupId}`;
  }

  return (
    <Card className="panel">
      <div className={canManage && isEditingSets ? "panel-header sets-header editing" : "panel-header sets-header"}>
        <div className="sets-title-row">
          <h2>{title}</h2>
          {status ? <p className="inline-status">{status}</p> : null}
        </div>
        {canManage && isEditingSets ? (
          <div className="sets-create-inline">
            <Input
              aria-label="Set name"
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="Enter set name..."
              value={newGroupName}
            />
            <Button disabled={!newGroupName.trim()} onClick={createGroup}>Create new</Button>
          </div>
        ) : null}
        {canManage ? (
          <Button
            className="sets-edit-button"
            onClick={() => setIsEditingSets((current) => !current)}
            variant="outline"
          >
            {isEditingSets ? "Done" : "Edit"}
          </Button>
        ) : null}
      </div>
      <div className="list">
        {groups.map((group) => (
            <div
              className={
                group.disabledAt
                  ? "row group-row disabled-row"
                  : "row group-row expandable-row"
              }
              key={group.id}
              onClick={(event) => openGroup(group.id, event)}
            >
              <div className="group-row-summary">
                <div>
                  <h3 className="group-title-line">
                    <span>{group.name}</span>
                    <span className="group-meta">
                    <span>{group.description || `${group.itemCount} skills`}</span>
                      <span>{groupVisibilityLabel(group.visibility)}</span>
                    </span>
                  </h3>
                  {group.ownerDisplayName ? (
                    <span>
                      {group.ownerDisplayName ? ` · ${group.ownerDisplayName}` : ""}
                    </span>
                  ) : null}
                </div>
                <div className="row-actions">
                  {group.allowedEmailCount !== undefined ? <span>{group.allowedEmailCount} emails</span> : null}
                  {canManage ? (
                    <>
                      {group.visibility === "public" && !group.disabledAt && profile?.handle ? (
                        <Button aria-label="Open public group URL" asChild className="icon-link" size="icon" title="Open public URL" variant="secondary">
                          <a href={publicGroupUrl(profile.handle, group.slug)}>
                            <ArrowUpRight className={iconClassName} />
                          </a>
                        </Button>
                      ) : null}
                      <Button
                        aria-label={group.visibility === "public" ? "Unpublish group" : "Publish group"}
                        className={group.visibility === "public" ? "icon-button active" : "icon-button"}
                        onClick={() => setVisibility(group, group.visibility === "public" ? "restricted" : "public")}
                        size="icon"
                        title={group.visibility === "public" ? "Public. Click to make private." : "Private. Click to publish."}
                        variant="secondary"
                      >
                        {group.visibility === "public" ? (
                          <Earth className={`${iconClassName} public-icon`} />
                        ) : (
                          <Lock className={iconClassName} />
                        )}
                      </Button>
                      <Button
                        aria-label={group.disabledAt ? "Restore group" : "Hide group"}
                        className={group.disabledAt ? "icon-button active neutral-active" : "icon-button"}
                        onClick={() => setDisabled(group, !group.disabledAt)}
                        size="icon"
                        title={group.disabledAt ? "Hidden. Click to restore." : "Hide group from public pages."}
                        variant="secondary"
                      >
                        {group.disabledAt ? <EyeOff className={iconClassName} /> : <Eye className={iconClassName} />}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
        ))}
        {groups.length === 0 ? <p className="muted">No groups yet.</p> : null}
      </div>
    </Card>
  );
}

function GroupDetailPage({ groupId }: { groupId: string }) {
  const api = usePortalApi();
  const { user } = useUser();
  const [group, setGroup] = useState<SkillGroupDetail | null>(null);
  const [items, setItems] = useState<SkillGroupItem[]>([]);
  const [status, setStatus] = useState("Loading group...");
  const [emailToAdd, setEmailToAdd] = useState("");
  const [showEmailInput, setShowEmailInput] = useState(false);

  async function loadGroup() {
    setStatus("Loading group...");
    try {
      const result = await api<{
        group: SkillGroupDetail;
        items: SkillGroupItem[];
        accessRole: "owner" | "invited";
      }>(`/api/portal/groups/${groupId}`);
      setGroup({ ...result.group, accessRole: result.accessRole });
      setItems(result.items);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load group");
    }
  }

  async function addAllowedEmail() {
    const email = emailToAdd.trim();
    if (!email || !group) {
      return;
    }

    setStatus("Adding email...");
    try {
      await api(`/api/portal/groups/${group.id}/allowed-emails`, {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setEmailToAdd("");
      setShowEmailInput(false);
      await loadGroup();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add email");
    }
  }

  async function removeAllowedEmail(emailId: string) {
    if (!group) {
      return;
    }

    setStatus("Removing email...");
    try {
      await api(`/api/portal/groups/${group.id}/allowed-emails`, {
        method: "DELETE",
        body: JSON.stringify({ emailId })
      });
      await loadGroup();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to remove email");
    }
  }

  useEffect(() => {
    void loadGroup();
  }, [groupId]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Skill Group</p>
          <h1>{group?.name ?? "Skill Group"}</h1>
          <p>{user?.primaryEmailAddress?.emailAddress}</p>
        </div>
        <UserButton />
      </header>

      <a href="/app/" className="back-link">← Back to portal</a>
      {status ? <p className="status">{status}</p> : null}

      {group ? (
        <>
          <Card className="panel">
            <div className="panel-header">
              <div>
                <h2>{group.name}</h2>
                <p className="group-meta">
                  <span>{group.itemCount} skills</span>
                  <span>{groupVisibilityLabel(group.visibility)}</span>
                  <span>{group.accessRole}</span>
                  {group.ownerDisplayName ? <span>{group.ownerDisplayName}</span> : null}
                </p>
              </div>
            </div>
            {group.description ? <p>{group.description}</p> : null}
          </Card>

          <Card className="panel">
            <h2>Skills</h2>
            <div className="group-skills-panel">
              {items.map((item) => (
                <div className="group-skill-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    {item.description ? <p>{item.description}</p> : null}
                  </div>
                  {item.githubUrl ? (
                    <a href={item.githubUrl} title="Open GitHub source">
                      GitHub →
                    </a>
                  ) : null}
                </div>
              ))}
              {items.length === 0 ? <p className="muted">No skills in this group yet.</p> : null}
            </div>
          </Card>

          {group.accessRole === "owner" ? (
            <Card className="panel">
              <div className="panel-header">
                <div>
                  <h2>Allowed Emails</h2>
                  <p>People signed in with these emails can view this private group.</p>
                </div>
              </div>
              <div className="email-list">
                {(group.allowedEmails ?? []).map((allowedEmail) => (
                  <div className="email-row" key={allowedEmail.id}>
                    <span>{allowedEmail.email}</span>
                    <Button
                      aria-label={`Remove ${allowedEmail.email}`}
                      className="icon-button warning"
                      onClick={() => removeAllowedEmail(allowedEmail.id)}
                      size="icon"
                      title="Remove email"
                      type="button"
                      variant="secondary"
                    >
                      <Trash2 className={iconClassName} />
                    </Button>
                  </div>
                ))}
                {(group.allowedEmails ?? []).length === 0 ? <p className="muted">No emails added.</p> : null}
              </div>
              {showEmailInput ? (
                <div className="inline-email-form">
                  <Input
                    autoFocus
                    onChange={(event) => setEmailToAdd(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        addAllowedEmail();
                      }
                    }}
                    placeholder="teammate@example.com"
                    value={emailToAdd}
                  />
                  <Button disabled={!emailToAdd.trim()} onClick={addAllowedEmail} type="button">
                    Add
                  </Button>
                </div>
              ) : (
                <Button className="text-button" onClick={() => setShowEmailInput(true)} size="sm" type="button" variant="link">
                  Add new email +
                </Button>
              )}
            </Card>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function Dashboard() {
  const api = usePortalApi();
  const { isLoaded, user } = useUser();
  const [state, setState] = useState<ApiState>({ syncedSkills: [], groups: [], sharedGroups: [], profile: null });
  const [status, setStatus] = useState("Loading...");

  async function refresh() {
    try {
      const [synced, groups, shared, profile] = await Promise.all([
        api<{ skills: SyncedSkill[] }>("/api/portal/synced-skills"),
        api<{ groups: SkillGroup[] }>("/api/portal/groups"),
        api<{ groups: SkillGroup[] }>("/api/portal/shared"),
        api<{ profile: Profile }>("/api/portal/profile")
      ]);
      const nextState = {
        syncedSkills: synced.skills,
        groups: groups.groups,
        sharedGroups: shared.groups,
        profile: profile.profile
      };
      setState(nextState);
      if (user?.id) {
        writeDashboardCache(user.id, nextState);
      }
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load portal data");
    }
  }

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    if (user?.id) {
      const cached = readDashboardCache(user.id);
      if (cached) {
        setState(cached);
        setStatus("");
      }
    }
    void refresh();
  }, [isLoaded, user?.id]);

  return (
    <main className="shell">
      <header className="dashboard-header">
        <div className="dashboard-identity">
          <div className="dashboard-profile-line">
            <a aria-label="Home" className="eyes-logo" href="/app/">👀</a>
            <ProfileHeaderControls profile={state.profile} onRefresh={refresh} />
          </div>
        </div>
        <div className="dashboard-actions">
          <UserButton />
          <SyncAppButton hasSynced={state.syncedSkills.length > 0} />
        </div>
      </header>

      {status ? <p className="status">{status}</p> : null}
      <GroupsPanel title="SETS" groups={state.groups} onRefresh={refresh} canManage profile={state.profile} />
      <SyncedSkillsPanel groups={state.groups} skills={state.syncedSkills} onRefresh={refresh} />
      <GroupsPanel title="Shared With Me" groups={state.sharedGroups} />
    </main>
  );
}

function App() {
  const groupDetailMatch = window.location.pathname.match(/^\/app\/groups\/([^/]+)\/?$/);

  return (
    <>
      <SignedOut>
        <main className="shell auth-shell">
          <section className="hero">
            <p className="eyebrow">omgskills</p>
            <h1>Sign in to manage Skill Groups</h1>
            <p>Sync local skills, build a private group, and share it with a teammate by email.</p>
            <div className="actions">
              <SignInButton mode="modal">
                <Button>Sign in</Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button variant="secondary">Create account</Button>
              </SignUpButton>
            </div>
          </section>
        </main>
      </SignedOut>
      <SignedIn>
        {groupDetailMatch ? <GroupDetailPage groupId={decodeURIComponent(groupDetailMatch[1])} /> : <Dashboard />}
      </SignedIn>
    </>
  );
}

if (!publishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
);
