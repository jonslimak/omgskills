import type React from "react";
import { useState } from "react";
import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createGroup, updateGroupModeration, updateGroupVisibility } from "@/groups/api";
import { groupVisibilityLabel, groupVisibilityOptions, publicGroupUrl } from "@/groups/model";
import type { GroupProfile, GroupVisibility, SkillGroup } from "@/groups/types";
import { usePortalApi } from "@/portal-api";

const iconClassName = "app-icon";

export function GroupsPanel({
  title,
  groups,
  onRefresh,
  canManage = false,
  profile,
}: {
  title: string;
  groups: SkillGroup[];
  onRefresh?: () => void;
  canManage?: boolean;
  profile?: GroupProfile | null;
}) {
  const api = usePortalApi();
  const [status, setStatus] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupVisibility, setNewGroupVisibility] = useState<GroupVisibility>("private");
  const [isEditingSets, setIsEditingSets] = useState(false);

  async function createNewGroup() {
    setStatus("Creating group...");
    try {
      await createGroup(api, newGroupName, newGroupVisibility);
      setStatus("Group created.");
      setNewGroupName("");
      setNewGroupVisibility("private");
      setIsEditingSets(false);
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create group");
    }
  }

  async function setVisibility(group: SkillGroup, visibility: GroupVisibility) {
    setStatus("Updating group...");
    try {
      await updateGroupVisibility(api, group.id, visibility);
      setStatus("Group updated.");
      onRefresh?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update group");
    }
  }

  async function setDisabled(group: SkillGroup, disabled: boolean) {
    setStatus("Updating moderation state...");
    try {
      await updateGroupModeration(api, group.id, disabled);
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
    if (!isInteractiveTarget(event.target)) {
      window.location.href = `/app/groups/${groupId}`;
    }
  }

  return (
    <Card className="panel">
      <div
        className={
          canManage && isEditingSets ? "panel-header sets-header editing" : "panel-header sets-header"
        }
      >
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
            <select
              aria-label="New group visibility"
              className="group-visibility-select"
              onChange={(event) => setNewGroupVisibility(event.target.value as GroupVisibility)}
              value={newGroupVisibility}
            >
              {groupVisibilityOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <Button disabled={!newGroupName.trim()} onClick={createNewGroup}>Create new</Button>
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
            className={group.disabledAt ? "row group-row disabled-row" : "row group-row expandable-row"}
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
                {group.ownerDisplayName ? <span>{` · ${group.ownerDisplayName}`}</span> : null}
              </div>
              <div className="row-actions">
                {group.allowedEmailCount !== undefined ? <span>{group.allowedEmailCount} emails</span> : null}
                {canManage ? (
                  <>
                    {group.visibility === "public" && !group.disabledAt && profile?.handle ? (
                      <Button
                        aria-label="Open public group URL"
                        asChild
                        className="icon-link"
                        size="icon"
                        title="Open public URL"
                        variant="secondary"
                      >
                        <a href={publicGroupUrl(profile.handle, group.slug)}>
                          <ArrowUpRight className={iconClassName} />
                        </a>
                      </Button>
                    ) : null}
                    <select
                      aria-label={`${group.name} visibility`}
                      className="group-visibility-select"
                      disabled={group.isFavorites}
                      onChange={(event) => {
                        void setVisibility(group, event.target.value as GroupVisibility);
                      }}
                      title={group.isFavorites ? "Favorites visibility is protected" : "Group visibility"}
                      value={group.visibility ?? "private"}
                    >
                      {groupVisibilityOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
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
