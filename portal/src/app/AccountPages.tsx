import { GitFork as Github, Laptop, Copy, Pencil, LogOut } from "lucide-react";
import type { GroupedSyncedSkill } from "../synced-skill-grouping";
import type { PortalActions, PortalData, PortalDevice } from "./model";
import type { LinkRenderer } from "./SetsPage";
import {
  Action,
  Avatar,
  EmptyState,
  IconAction,
  StatusBadge,
  Toggle,
  TextInput,
} from "./ui";

export function AgentsPage({
  skills,
  data,
  link,
  revoke,
  unavailable,
  readOnly = false,
}: {
  skills: GroupedSyncedSkill[];
  data: PortalData;
  link: LinkRenderer;
  revoke: (device: PortalDevice) => void;
  unavailable: (title: string, description: string) => void;
  readOnly?: boolean;
}) {
  const sources = [...new Set(skills.flatMap((skill) => skill.sources))].sort();
  return (
    <>
      <div className="rd-list">
        {sources.map((source) => (
          <div className="rd-agent-row" key={source}>
            <span className="rd-agent-tile rd-agent-large">
              {source === "Codex" ? "O" : source[0]}
            </span>
            <div className="rd-grow">
              <div className="rd-row-title">{source}</div>
              <p>Observed in your synced skills</p>
            </div>
            {link(
              `?source=${encodeURIComponent(source)}`,
              <>
                {
                  skills.filter((skill) => skill.sources.includes(source))
                    .length
                }{" "}
                skills
              </>,
              "rd-inline-link",
            )}
          </div>
        ))}
        {!sources.length && (
          <EmptyState
            title="No agents yet"
            description="Agent sources appear when you sync your skills."
          />
        )}
      </div>
      <div className="rd-section-heading">
        <h2>Connected devices</h2>
        <Action
          disabled={readOnly}
          title={readOnly ? "Device controls are not connected yet" : undefined}
          onClick={() =>
            unavailable(
              "Connect app",
              "The real pairing and legacy sync flows will be connected in the integration pass. This local preview does not issue tokens or open the Mac app.",
            )
          }
        >
          Connect app
        </Action>
      </div>
      <div className="rd-list">
        {readOnly ? (
          <p className="rd-muted">
            Device information is not loaded in this view.
          </p>
        ) : (
          data.devices.map((device) => (
            <div className="rd-agent-row" key={device.id}>
              <span className="rd-agent-tile rd-agent-large">
                <Laptop />
              </span>
              <div className="rd-grow">
                <div className="rd-row-title">{device.name}</div>
                <p>Last active {device.lastActive}</p>
              </div>
              <StatusBadge>{device.status}</StatusBadge>
              {device.status === "active" && (
                <Action variant="destructive" onClick={() => revoke(device)}>
                  Revoke
                </Action>
              )}
            </div>
          ))
        )}
        {!readOnly && !data.devices.length && (
          <EmptyState title="No connected devices" />
        )}
      </div>
    </>
  );
}

export function HomePage({
  data,
  actions,
  editProfile,
  unavailable,
  copy,
  readOnly = false,
}: {
  data: PortalData;
  actions: PortalActions;
  editProfile: () => void;
  unavailable: (title: string, description: string) => void;
  copy: () => void;
  readOnly?: boolean;
}) {
  const profile = data.profile;
  return (
    <div className="rd-home">
      <div className="rd-identity">
        <Avatar name={profile.name} large />
        <div className="rd-grow">
          <h2>{profile.handle ? `/${profile.handle}` : "No handle set"}</h2>
          <p>{profile.email}</p>
        </div>
        <IconAction
          label="Edit profile"
          onClick={editProfile}
          disabled={readOnly}
          title={
            readOnly ? "Profile editing is not connected yet" : "Edit profile"
          }
        >
          <Pencil />
        </IconAction>
      </div>
      <section className="rd-profile-section">
        <div className="rd-section-line">
          <div>
            <h2>Public profile</h2>
            <p>
              {profile.published
                ? "Your profile lists your public sets."
                : "Your profile is not published. Public sets remain accessible."}
            </p>
          </div>
          <Toggle
            disabled={readOnly}
            label="Publish profile"
            checked={profile.published}
            onChange={(published) => actions.updateProfile({ published })}
          />
        </div>
        {profile.published && (!readOnly || profile.publicUrl) && (
          <div className="rd-profile-url">
            <span>
              {readOnly
                ? profile.publicUrl
                : `omgskills.com/u/${profile.handle}`}
            </span>
            <Action onClick={copy} disabled={readOnly}>
              <Copy data-icon="inline-start" />
              Copy
            </Action>
          </div>
        )}
      </section>
      <section className="rd-private-source">
        <h2>Private source</h2>
        {data.privateSourceConnected === null ? (
          <p className="rd-muted">
            Private-source information is not loaded in this view.
          </p>
        ) : data.privateSourceConnected ? (
          <div className="rd-connected-source">
            <div className="rd-section-line">
              <Github />
              <strong>example-studio</strong>
              <StatusBadge>Sample installation</StatusBadge>
            </div>
            <label>
              Repository
              <select defaultValue="skills">
                <option value="skills">example-studio/skills</option>
              </select>
            </label>
            <label>
              Skill root
              <TextInput defaultValue="skills/design-review" />
            </label>
            <Action
              onClick={() =>
                unavailable(
                  "Register private source",
                  "Source registration and release creation use the existing backend. They are not connected in this sample-data preview.",
                )
              }
            >
              Register source
            </Action>
            <div className="rd-source-release">
              <strong>design-review</strong>
              <span className="rd-muted">Release 1</span>
              <Action
                onClick={() =>
                  unavailable(
                    "Create release",
                    "No package is created or uploaded from the local preview.",
                  )
                }
              >
                Create release
              </Action>
            </div>
          </div>
        ) : (
          <div className="rd-source-empty">
            <div className="rd-source-icon">
              <Github />
            </div>
            <h3>No installation connected</h3>
            <p>
              A GitHub App installation is required for private repositories.
            </p>
            <Action
              variant="default"
              onClick={() =>
                unavailable(
                  "Connect GitHub",
                  "Self-service GitHub installation is not available yet. Existing connected installations remain supported.",
                )
              }
            >
              <Github data-icon="inline-start" />
              Connect GitHub
            </Action>
          </div>
        )}
      </section>
      <div className="rd-account-actions">
        <Action
          disabled={readOnly}
          onClick={() =>
            unavailable(
              "Account settings",
              "Clerk account settings will remain available in the signed-in portal. This preview has no signed-in account.",
            )
          }
        >
          Account settings
        </Action>
        <Action
          variant="ghost"
          disabled={readOnly}
          onClick={() =>
            unavailable(
              "Sign out",
              "There is no signed-in account in this local preview.",
            )
          }
        >
          <LogOut data-icon="inline-start" />
          Sign out
        </Action>
      </div>
    </div>
  );
}
