import { useEffect, useState } from "react";
import { UserButton, useUser } from "@clerk/clerk-react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  addGroupAllowedEmail,
  deleteGroup,
  loadGroupDetail,
  removeGroupAllowedEmail,
  removeGroupItem,
  reorderGroupItems,
  updateGroup,
} from "@/groups/api";
import { groupVisibilityLabel, groupVisibilityOptions } from "@/groups/model";
import type { GroupVisibility, SkillGroupDetail, SkillGroupItem } from "@/groups/types";
import { usePortalApi } from "@/portal-api";

const iconClassName = "app-icon";

export function GroupDetailPage({ groupId }: { groupId: string }) {
  const api = usePortalApi();
  const { user } = useUser();
  const [group, setGroup] = useState<SkillGroupDetail | null>(null);
  const [items, setItems] = useState<SkillGroupItem[]>([]);
  const [status, setStatus] = useState("Loading group...");
  const [emailToAdd, setEmailToAdd] = useState("");
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftVisibility, setDraftVisibility] = useState<GroupVisibility>("private");
  const [isMutating, setIsMutating] = useState(false);

  async function loadGroup() {
    setStatus("Loading group...");
    try {
      const result = await loadGroupDetail(api, groupId);
      setGroup(result.group);
      setItems(result.items);
      setDraftName(result.group.name);
      setDraftDescription(result.group.description ?? "");
      setDraftVisibility(result.group.visibility ?? "private");
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
      await addGroupAllowedEmail(api, group.id, email);
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
      await removeGroupAllowedEmail(api, group.id, emailId);
      await loadGroup();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to remove email");
    }
  }

  async function saveGroup() {
    if (!group) {
      return;
    }
    setStatus("Saving group...");
    setIsMutating(true);
    try {
      await updateGroup(
        api,
        group.id,
        group.isFavorites
          ? { description: draftDescription }
          : {
              name: draftName,
              description: draftDescription,
              visibility: draftVisibility,
            }
      );
      setIsEditing(false);
      await loadGroup();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save group");
    } finally {
      setIsMutating(false);
    }
  }

  async function confirmDeleteGroup() {
    if (!group || group.isFavorites) {
      return;
    }
    setStatus("Deleting group...");
    setIsMutating(true);
    try {
      await deleteGroup(api, group.id);
      window.location.href = "/app/";
    } catch (error) {
      setShowDeleteConfirmation(false);
      setStatus(error instanceof Error ? error.message : "Failed to delete group");
      setIsMutating(false);
    }
  }

  async function removeItem(item: SkillGroupItem) {
    if (!group) {
      return;
    }
    setStatus(`Removing ${item.name}...`);
    setIsMutating(true);
    try {
      await removeGroupItem(api, group.id, item.id);
      await loadGroup();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to remove skill");
    } finally {
      setIsMutating(false);
    }
  }

  async function moveItem(index: number, offset: -1 | 1) {
    if (!group) {
      return;
    }
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) {
      return;
    }
    const reordered = [...items];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setItems(reordered);
    setStatus("Saving skill order...");
    setIsMutating(true);
    try {
      await reorderGroupItems(api, group.id, reordered.map((item) => item.id));
      setStatus("");
    } catch (error) {
      setItems(items);
      setStatus(error instanceof Error ? error.message : "Failed to reorder skills");
    } finally {
      setIsMutating(false);
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
              {isEditing ? (
                <div className="group-settings-form">
                  <Input
                    aria-label="Group name"
                    disabled={group.isFavorites}
                    onChange={(event) => setDraftName(event.target.value)}
                    value={draftName}
                  />
                  <Input
                    aria-label="Group description"
                    onChange={(event) => setDraftDescription(event.target.value)}
                    placeholder="Description"
                    value={draftDescription}
                  />
                  <select
                    aria-label="Group visibility"
                    className="group-visibility-select"
                    disabled={group.isFavorites}
                    onChange={(event) => setDraftVisibility(event.target.value as GroupVisibility)}
                    value={draftVisibility}
                  >
                    {groupVisibilityOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <div className="group-settings-actions">
                    <Button disabled={!draftName.trim() || isMutating} onClick={saveGroup} type="button">Save</Button>
                    <Button onClick={() => setIsEditing(false)} type="button" variant="outline">Cancel</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <h2>{group.name}</h2>
                  <p className="group-meta">
                    <span>{group.itemCount} skills</span>
                    <span>{groupVisibilityLabel(group.visibility)}</span>
                    <span>{group.accessRole}</span>
                    {group.ownerDisplayName ? <span>{group.ownerDisplayName}</span> : null}
                  </p>
                </div>
              )}
              {group.accessRole === "owner" && !isEditing ? (
                <div className="row-actions">
                  <Button onClick={() => setIsEditing(true)} type="button" variant="outline">
                    <Pencil className={iconClassName} />
                    Edit
                  </Button>
                  {!group.isFavorites ? (
                    <Button
                      aria-label={`Delete ${group.name}`}
                      disabled={isMutating}
                      onClick={() => setShowDeleteConfirmation(true)}
                      type="button"
                      variant="destructive"
                    >
                      <Trash2 className={iconClassName} />
                      Delete
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!isEditing && group.description ? <p>{group.description}</p> : null}
          </Card>

          <Card className="panel">
            <h2>Skills</h2>
            <div className="group-skills-panel">
              {items.map((item, index) => (
                <div className="group-skill-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    {item.description ? <p>{item.description}</p> : null}
                  </div>
                  <div className="group-skill-actions">
                    {item.githubUrl ? (
                      <a href={item.githubUrl} title="Open GitHub source">GitHub →</a>
                    ) : null}
                    {group.accessRole === "owner" ? (
                      <>
                        <Button
                          aria-label={`Move ${item.name} up`}
                          disabled={isMutating || index === 0}
                          onClick={() => moveItem(index, -1)}
                          size="icon-sm"
                          title="Move up"
                          type="button"
                          variant="secondary"
                        >
                          <ArrowUp className={iconClassName} />
                        </Button>
                        <Button
                          aria-label={`Move ${item.name} down`}
                          disabled={isMutating || index === items.length - 1}
                          onClick={() => moveItem(index, 1)}
                          size="icon-sm"
                          title="Move down"
                          type="button"
                          variant="secondary"
                        >
                          <ArrowDown className={iconClassName} />
                        </Button>
                        <Button
                          aria-label={`Remove ${item.name}`}
                          disabled={isMutating}
                          onClick={() => removeItem(item)}
                          size="icon-sm"
                          title="Remove skill"
                          type="button"
                          variant="destructive"
                        >
                          <Trash2 className={iconClassName} />
                        </Button>
                      </>
                    ) : null}
                  </div>
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
                  <p>These emails can view the group when visibility is Invite only.</p>
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
                {(group.allowedEmails ?? []).length === 0 ? (
                  <p className="muted">No emails added.</p>
                ) : null}
              </div>
              {showEmailInput ? (
                <div className="inline-email-form">
                  <Input
                    autoFocus
                    onChange={(event) => setEmailToAdd(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void addAllowedEmail();
                      }
                    }}
                    placeholder="teammate@example.com"
                    value={emailToAdd}
                  />
                  <Button disabled={!emailToAdd.trim()} onClick={addAllowedEmail} type="button">Add</Button>
                </div>
              ) : (
                <Button
                  className="text-button"
                  onClick={() => setShowEmailInput(true)}
                  size="sm"
                  type="button"
                  variant="link"
                >
                  Add new email +
                </Button>
              )}
            </Card>
          ) : null}
          <Dialog onOpenChange={setShowDeleteConfirmation} open={showDeleteConfirmation}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {group.name}?</DialogTitle>
                <DialogDescription>This removes the group and its memberships.</DialogDescription>
              </DialogHeader>
              <DialogFooter showCloseButton>
                <Button disabled={isMutating} onClick={confirmDeleteGroup} type="button" variant="destructive">Delete group</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </main>
  );
}
