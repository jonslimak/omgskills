import React, { useEffect, useRef, useState } from "react";
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
  Copy,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  browserPairingCancelUrl,
  parseBrowserPairingRequest
} from "@/browser-pairing";
import {
  groupSyncedSkills,
  hasSource,
  type GroupedSyncedSkill,
  type SyncedSkill
} from "@/synced-skill-grouping";
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
  return `${publicSiteOrigin()}/u/${handle}/sets/${slug}`;
}

function groupVisibilityLabel(visibility: string | undefined) {
  return visibility === "public" ? "public" : "private";
}

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

type PortalDevice = {
  id: string;
  deviceName: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  status: "active" | "revoked" | "expired" | "inactive";
};

function formatDeviceDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

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
  const [syncMode, setSyncMode] = useState<"latest" | "devices" | "legacy">("latest");
  const [pairingCode, setPairingCode] = useState<string>("");
  const [legacyToken, setLegacyToken] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [copyStatus, setCopyStatus] = useState<string>("");
  const [devices, setDevices] = useState<PortalDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  function openPopover() {
    requestGeneration.current += 1;
    setIsPopoverOpen(true);
    setSyncMode("latest");
    setPairingCode("");
    setLegacyToken("");
    setStatus("");
    setCopyStatus("");
    setDevices([]);
    setDevicesLoading(false);
    setDeviceStatus("");
    setConfirmRevokeId(null);
    setRevokingDeviceId(null);
  }

  function updatePopoverOpen(open: boolean) {
    setIsPopoverOpen(open);
    if (!open) {
      requestGeneration.current += 1;
      setPairingCode("");
      setLegacyToken("");
      setStatus("");
      setCopyStatus("");
      setDevices([]);
      setDevicesLoading(false);
      setDeviceStatus("");
      setConfirmRevokeId(null);
      setRevokingDeviceId(null);
    }
  }

  function updateSyncMode(value: string) {
    const mode = value === "legacy" ? "legacy" : value === "devices" ? "devices" : "latest";
    requestGeneration.current += 1;
    setSyncMode(mode);
    setPairingCode("");
    setLegacyToken("");
    setStatus("");
    setCopyStatus("");
    setDeviceStatus("");
    setConfirmRevokeId(null);
    if (mode === "devices") {
      void loadDevices();
    }
  }

  async function loadDevices() {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setDevicesLoading(true);
    setDeviceStatus("");
    try {
      const result = await api<{ devices: PortalDevice[] }>("/api/portal/devices");
      if (requestGeneration.current !== generation) return;
      setDevices(result.devices);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setDeviceStatus(error instanceof Error ? error.message : "Failed to load connected devices");
    } finally {
      if (requestGeneration.current === generation) setDevicesLoading(false);
    }
  }

  async function revokeDevice(deviceId: string) {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setRevokingDeviceId(deviceId);
    setDeviceStatus("");
    let revoked = false;
    try {
      await api(`/api/portal/devices/${deviceId}`, { method: "DELETE" });
      revoked = true;
      if (requestGeneration.current !== generation) return;
      setDevices((current) => current.map((device) => (
        device.id === deviceId ? { ...device, status: "revoked" } : device
      )));
      setConfirmRevokeId(null);
      setDeviceStatus("Device revoked.");
      const result = await api<{ devices: PortalDevice[] }>("/api/portal/devices");
      if (requestGeneration.current !== generation) return;
      setDevices(result.devices);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setDeviceStatus(revoked
        ? "Device revoked, but the list could not refresh."
        : error instanceof Error ? error.message : "Failed to revoke device");
    } finally {
      if (requestGeneration.current === generation) setRevokingDeviceId(null);
    }
  }

  async function createPairingCode() {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setStatus("Generating connection code...");
    setCopyStatus("");
    try {
      const result = await api<{ pairingCode: string; expiresAt: string }>("/api/portal/sync-pairing-code", {
        method: "POST",
        body: JSON.stringify({})
      });
      if (requestGeneration.current !== generation) return;
      setPairingCode(result.pairingCode);
      setStatus("Connection code is ready and expires in 10 minutes.");
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setStatus(error instanceof Error ? error.message : "Failed to create connection code");
    }
  }

  async function createLegacyToken() {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setStatus("Generating legacy token...");
    setCopyStatus("");
    try {
      const result = await api<{ token: string; expiresAt: string }>("/api/portal/sync-token", {
        method: "POST",
        body: JSON.stringify({})
      });
      if (requestGeneration.current !== generation) return;
      setLegacyToken(result.token);
      setStatus("Legacy token is ready and expires in 10 minutes.");
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setStatus(error instanceof Error ? error.message : "Failed to create token");
    }
  }

  async function copySecret(secret: string) {
    if (!secret) {
      return;
    }
    try {
      await navigator.clipboard.writeText(secret);
      setCopyStatus("Copied.");
    } catch {
      setCopyStatus("Select and copy the value.");
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
      <Dialog open={isPopoverOpen} onOpenChange={updatePopoverOpen}>
        <DialogContent className="sync-modal-card" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Sync your app</DialogTitle>
            <DialogDescription className="sr-only">
              Connect the latest app or generate a legacy one-time sync token.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={syncMode} onValueChange={updateSyncMode}>
            <TabsList className="sync-mode-tabs">
              <TabsTrigger value="latest">Connect app</TabsTrigger>
              <TabsTrigger value="devices">Devices</TabsTrigger>
              <TabsTrigger value="legacy">Legacy</TabsTrigger>
            </TabsList>
            <TabsContent value="latest">
              <div className="sync-step">
                <h3>Step 1</h3>
                <p>Generate a connection code for the latest Mac app.</p>
                <Button onClick={createPairingCode}>Generate connection code</Button>
                <SyncSecret
                  label="Connection code"
                  secret={pairingCode}
                  onCopy={() => copySecret(pairingCode)}
                />
              </div>
              <div className="sync-step">
                <h3>Step 2</h3>
                <p>Open the app, select the user page, and choose Resync.</p>
                <p>Paste the connection code and select Connect.</p>
              </div>
            </TabsContent>
            <TabsContent value="devices">
              <div className="device-list" aria-live="polite">
                {devicesLoading ? <p className="sync-status">Loading devices...</p> : null}
                {!devicesLoading && devices.length === 0 && !deviceStatus ? (
                  <p className="sync-status">No connected devices.</p>
                ) : null}
                {devices.map((device) => (
                  <div className="device-row" key={device.id}>
                    <div className="device-row-heading">
                      <strong>{device.deviceName}</strong>
                      <span className={`device-state device-state-${device.status}`}>{device.status}</span>
                    </div>
                    <dl className="device-meta">
                      <div>
                        <dt>Connected</dt>
                        <dd>{formatDeviceDate(device.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>Last sync</dt>
                        <dd>{formatDeviceDate(device.lastUsedAt)}</dd>
                      </div>
                      <div>
                        <dt>Expires</dt>
                        <dd>{formatDeviceDate(device.expiresAt)}</dd>
                      </div>
                    </dl>
                    {device.status !== "revoked" && confirmRevokeId !== device.id ? (
                      <Button onClick={() => setConfirmRevokeId(device.id)} size="sm" variant="outline">
                        Revoke
                      </Button>
                    ) : null}
                    {device.status !== "revoked" && confirmRevokeId === device.id ? (
                      <div className="device-revoke-confirm">
                        <span>Revoke this device?</span>
                        <Button
                          disabled={revokingDeviceId === device.id}
                          onClick={() => void revokeDevice(device.id)}
                          size="sm"
                          variant="destructive"
                        >
                          {revokingDeviceId === device.id ? "Revoking..." : "Confirm revoke"}
                        </Button>
                        <Button
                          disabled={revokingDeviceId === device.id}
                          onClick={() => setConfirmRevokeId(null)}
                          size="sm"
                          variant="ghost"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                {deviceStatus ? <p className="sync-status">{deviceStatus}</p> : null}
              </div>
            </TabsContent>
            <TabsContent value="legacy">
              <div className="sync-step">
                <h3>Legacy fallback</h3>
                <p>Use this only with an older app or the Legacy one-time sync section.</p>
                <Button onClick={createLegacyToken}>Generate legacy token</Button>
                <SyncSecret
                  label="Legacy token"
                  secret={legacyToken}
                  onCopy={() => copySecret(legacyToken)}
                />
              </div>
              <div className="sync-step">
                <p>Open Resync in the app and expand Legacy one-time sync.</p>
              </div>
            </TabsContent>
          </Tabs>
          <div className="sync-token-area" aria-live="polite">
            {status ? <p className="sync-status">{status}</p> : null}
            {copyStatus ? <p className="sync-status">{copyStatus}</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SyncSecret({ label, secret, onCopy }: { label: string; secret: string; onCopy: () => void }) {
  if (!secret) {
    return null;
  }

  return (
    <div className="sync-secret-row">
      <Input aria-label={label} readOnly value={secret} />
      <Button aria-label={`Copy ${label.toLowerCase()}`} onClick={onCopy} size="icon" type="button" variant="outline">
        <Copy aria-hidden="true" className={iconClassName} />
      </Button>
    </div>
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
  const refreshInFlight = useRef<Promise<void> | null>(null);

  async function performRefresh() {
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

  function refresh() {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const request = performRefresh();
    refreshInFlight.current = request;
    void request.finally(() => {
      if (refreshInFlight.current === request) {
        refreshInFlight.current = null;
      }
    });
    return request;
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

  useEffect(() => {
    if (!isLoaded || !user?.id) {
      return;
    }

    function refreshWhenActive() {
      if (!document.hidden) {
        void refresh();
      }
    }

    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
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

function ConnectPage() {
  const api = usePortalApi();
  const [request] = useState(() => parseBrowserPairingRequest(window.location.hash));
  const [status, setStatus] = useState(request ? "" : "This connection request is invalid or expired.");
  const [isApproving, setIsApproving] = useState(false);

  async function approve() {
    if (!request || isApproving) return;
    setIsApproving(true);
    setStatus("Approving connection...");
    try {
      const result = await api<{ callbackUrl: string; expiresAt: string }>(
        "/api/portal/sync-pairing-code",
        {
          method: "POST",
          body: JSON.stringify({
            state: request.state,
            codeChallenge: request.codeChallenge,
            codeChallengeMethod: "S256"
          })
        }
      );
      setStatus("Returning to omgskills...");
      window.location.assign(result.callbackUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to approve connection");
      setIsApproving(false);
    }
  }

  function cancel() {
    if (!request) return;
    window.location.assign(browserPairingCancelUrl(request.state));
  }

  return (
    <main className="shell auth-shell connect-shell">
      <section className="connect-panel">
        <p className="eyebrow">omgskills</p>
        <h1>Connect this Mac?</h1>
        <p>The app will be able to sync installed skill metadata to your account.</p>
        <div className="connect-permission">
          <strong>Access</strong>
          <span>Sync installed skills</span>
        </div>
        {status ? <p className={request ? "status" : "connect-error"}>{status}</p> : null}
        <div className="actions">
          <Button disabled={!request || isApproving} onClick={approve}>
            {isApproving ? "Approving..." : "Approve"}
          </Button>
          <Button disabled={!request || isApproving} onClick={cancel} variant="outline">
            Cancel
          </Button>
        </div>
      </section>
    </main>
  );
}

function SignedOutPage({ isConnectRoute }: { isConnectRoute: boolean }) {
  return (
    <main className="shell auth-shell">
      <section className="hero">
        <p className="eyebrow">omgskills</p>
        <h1>{isConnectRoute ? "Sign in to connect your Mac" : "Sign in to manage Skill Groups"}</h1>
        <p>
          {isConnectRoute
            ? "After signing in, you can review and approve the connection."
            : "Sync local skills, build a private group, and share it with a teammate by email."}
        </p>
        <div className="actions">
          <SignInButton mode="modal">
            <Button>Sign in</Button>
          </SignInButton>
          {!isConnectRoute ? (
            <SignUpButton mode="modal">
              <Button variant="secondary">Create account</Button>
            </SignUpButton>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function App() {
  const isConnectRoute = /^\/(?:app\/)?connect\/?$/.test(window.location.pathname);
  const groupDetailMatch = window.location.pathname.match(/^\/app\/groups\/([^/]+)\/?$/);

  return (
    <>
      <SignedOut>
        <SignedOutPage isConnectRoute={isConnectRoute} />
      </SignedOut>
      <SignedIn>
        {isConnectRoute
          ? <ConnectPage />
          : groupDetailMatch
            ? <GroupDetailPage groupId={decodeURIComponent(groupDetailMatch[1])} />
            : <Dashboard />}
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
