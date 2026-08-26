import { useEffect, useState } from "react";
import { UserButton, useUser } from "@clerk/clerk-react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addGroupAllowedEmail,
  loadGroupDetail,
  removeGroupAllowedEmail,
} from "@/groups/api";
import { groupVisibilityLabel } from "@/groups/model";
import type { SkillGroupDetail, SkillGroupItem } from "@/groups/types";
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

  async function loadGroup() {
    setStatus("Loading group...");
    try {
      const result = await loadGroupDetail(api, groupId);
      setGroup(result.group);
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
                    <a href={item.githubUrl} title="Open GitHub source">GitHub →</a>
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
        </>
      ) : null}
    </main>
  );
}
