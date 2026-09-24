import { useState } from "react";
import { ArrowDown, ArrowUp, X, Plus, EyeOff, Star } from "lucide-react";
import type { GroupedSyncedSkill } from "../synced-skill-grouping";
import { isMember, visibilityLabels, type PortalActions, type PortalSet } from "./model";
import {
  Action,
  Avatar,
  EmptyState,
  IconAction,
  SourceLink,
  StatusBadge,
  TextInput,
} from "./ui";
import { MembershipPicker } from "./SkillsPage";

export function SetDetailPage({
  set,
  sets,
  actions,
  edit,
  skills,
  addSkills,
  notify,
  star,
  newSet,
  readOnly = false,
}: {
  set: PortalSet;
  actions: PortalActions;
  edit: boolean;
  skills: GroupedSyncedSkill[];
  addSkills: () => void;
  notify: (message: string) => void;
  sets: PortalSet[];
  star: (skills: GroupedSyncedSkill[], add: boolean) => void;
  newSet: (skills: GroupedSyncedSkill[]) => void;
  readOnly?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const owner = set.role === "owner";
  const canEdit = owner && !readOnly;
  const reorder = (index: number, offset: number) => {
    const items = [...set.items];
    [items[index], items[index + offset]] = [
      items[index + offset],
      items[index],
    ];
    actions.updateSet(set.id, { items });
  };
  return (
    <>
      {set.hidden && (
        <p className="rd-notice">
          <EyeOff />
          This set is hidden from other people.
        </p>
      )}
      {set.description && <p className="rd-intro">{set.description}</p>}
      <div className="rd-access-strip">
        <strong>Access</strong>
        {readOnly && <StatusBadge>{visibilityLabels[set.visibility]}</StatusBadge>}
        <span className="rd-member">
          <Avatar name={set.ownerName} />
          <span>{set.ownerName}</span>
          <small>Owner</small>
        </span>
        {owner &&
          set.emails.map((address) => (
            <span className="rd-member" key={address}>
              <Avatar name={address} />
              <span title={address}>{address}</span>
              <IconAction
                label={`Remove access for ${address}`}
                disabled={readOnly}
                onClick={() =>
                  actions.updateSet(set.id, {
                    emails: set.emails.filter((value) => value !== address),
                  })
                }
              >
                <X />
              </IconAction>
            </span>
          ))}
        {!owner && (
          <span className="rd-muted">
            {set.role === "invited"
              ? "You have read-only access"
              : "Public read-only access"}
          </span>
        )}
        {canEdit && !set.isFavorites && set.visibility === "restricted" && (
          <form
            className="rd-email-form"
            onSubmit={(event) => {
              event.preventDefault();
              const address = email.trim().toLowerCase();
              if (set.emails.includes(address)) {
                setEmailError("This email already has access.");
                return;
              }
              actions.updateSet(set.id, { emails: [...set.emails, address] });
              setEmail("");
              setEmailError("");
              notify("Access added to sample set. No email sent.");
            }}
          >
            <TextInput
              aria-label="Email address for access"
              type="email"
              required
              placeholder="Add email for access"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Action type="submit" variant="default">
              Add email
            </Action>
            {emailError && <p role="alert">{emailError}</p>}
          </form>
        )}
      </div>
      <div className="rd-section-heading">
        <h2>
          Skills <span className="rd-muted">{set.items.length}</span>
        </h2>
        {canEdit && edit && (
          <Action onClick={addSkills} disabled={!skills.length}>
            <Plus data-icon="inline-start" />
            Add skills
          </Action>
        )}
      </div>
      <div className="rd-table-wrap">
        <table className="rd-table rd-detail-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th className="rd-desktop rd-source-column">Source</th>
              <th
                className={
                  canEdit && edit ? "rd-detail-action-column" : "rd-action-column"
                }
              >
                <span className="rd-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {set.items.map((item, index) => {
              const skill = skills.find(
                (skill) =>
                  item.syncedSkillId &&
                  skill.allSkillIds.includes(item.syncedSkillId),
              );
              const favorites = sets.find((set) => set.isFavorites);
              const starred = Boolean(
                skill && favorites && isMember(favorites, skill),
              );
              return (
                <tr key={item.id}>
                  <td>
                    <div className="rd-skill-title">{item.name}</div>
                    <details className="rd-item-description">
                      <summary>{item.description || "View details"}</summary>
                      <p>{item.description || "No description available."}</p>
                      {item.kind === "private-release" && (
                        <p>Private release</p>
                      )}
                    </details>
                  </td>
                  <td className="rd-desktop">
                    {item.kind === "private-release" ? (
                      <span className="rd-muted">Private release</span>
                    ) : (
                      <SourceLink url={item.githubUrl} />
                    )}
                  </td>
                  <td>
                    {canEdit && edit ? (
                      <div className="rd-actions">
                        <IconAction
                          label={`Move ${item.name} up`}
                          disabled={index === 0}
                          onClick={() => reorder(index, -1)}
                        >
                          <ArrowUp />
                        </IconAction>
                        <IconAction
                          label={`Move ${item.name} down`}
                          disabled={index === set.items.length - 1}
                          onClick={() => reorder(index, 1)}
                        >
                          <ArrowDown />
                        </IconAction>
                        <IconAction
                          variant="destructive"
                          label={`Remove ${item.name}`}
                          onClick={() =>
                            actions.updateSet(set.id, {
                              items: set.items.filter(
                                (value) => value.id !== item.id,
                              ),
                            })
                          }
                        >
                          <X />
                        </IconAction>
                      </div>
                    ) : (
                      <div className="rd-actions">
                        <IconAction
                          disabled={readOnly || !skill}
                          className={starred ? "rd-starred" : undefined}
                          label={
                            readOnly
                              ? `Star ${item.name}`
                              : skill
                              ? `${starred ? "Unstar" : "Star"} ${item.name}`
                              : "Not in your synced library"
                          }
                          {...(readOnly ? { title: "Favorites changes are not connected yet" } : {})}
                          aria-pressed={starred}
                          onClick={() => {
                            if (skill) star([skill], !starred);
                          }}
                        >
                          <Star />
                        </IconAction>
                        {skill && !readOnly && (
                          <MembershipPicker
                            skill={skill}
                            sets={sets}
                            actions={actions}
                            newSet={newSet}
                          />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!set.items.length && (
          <EmptyState
            title="No skills in this set"
            description={
              canEdit
                ? "Choose Edit to add skills."
                : "The owner hasn't added any skills yet."
            }
          />
        )}
      </div>
    </>
  );
}
