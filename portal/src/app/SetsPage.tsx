import { ChevronRight, Trash2, Star } from "lucide-react";
import { visibilityLabels, type PortalSet } from "./model";
import { Avatar, EmptyState, IconAction, StatusBadge } from "./ui";
import type { ReactNode } from "react";

export type LinkRenderer = (
  path: string,
  children: ReactNode,
  className?: string,
) => ReactNode;
export function SetsPage({
  sets,
  edit,
  link,
  remove,
}: {
  sets: PortalSet[];
  edit: boolean;
  link: LinkRenderer;
  remove: (set: PortalSet) => void;
}) {
  return (
    <>
      {[
        { title: "My sets", owned: true },
        { title: "Shared with me", owned: false },
      ].map((section) => {
        const items = sets.filter(
          (set) => (set.role === "owner") === section.owned,
        );
        return (
          <section className="rd-set-section" key={section.title}>
            <h2 className="rd-group-label">{section.title}</h2>
            <div className="rd-list">
              {items.length === 0 ? (
                <EmptyState
                  title={section.owned ? "No sets yet" : "No shared sets"}
                  description={
                    section.owned
                      ? "Create a set to organize your skills."
                      : "Sets shared with your account will appear here."
                  }
                />
              ) : (
                items.map((set) => (
                  <div className="rd-set-row" key={set.id}>
                    {link(
                      `groups/${encodeURIComponent(set.id)}`,
                      <>
                        <div className="rd-grow">
                          <div className="rd-row-title">
                            {set.isFavorites && <Star />}
                            {set.name}
                          </div>
                          <p>
                            {set.itemCount ?? set.items.length} skills
                            {set.role !== "owner" && ` · by ${set.ownerName}`}
                          </p>
                        </div>
                        <StatusBadge>
                          {set.hidden
                            ? "Hidden"
                            : visibilityLabels[set.visibility]}
                        </StatusBadge>
                        <div className="rd-avatars rd-desktop">
                          <Avatar name={set.ownerName} />
                          {set.role === "owner" &&
                            set.emails
                              .slice(0, 3)
                              .map((email) => (
                                <Avatar key={email} name={email} />
                              ))}
                        </div>
                        <ChevronRight />
                      </>,
                      "rd-set-link",
                    )}
                    {edit && set.role === "owner" && !set.isFavorites && (
                      <IconAction
                        label={`Delete ${set.name}`}
                        variant="destructive"
                        onClick={() => remove(set)}
                      >
                        <Trash2 />
                      </IconAction>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
