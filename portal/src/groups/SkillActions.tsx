import { useState } from "react";
import { Check, Grid2X2Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addSyncedSkillToGroup,
  createFavoritesGroup,
} from "@/groups/api";
import type { SkillGroup } from "@/groups/types";
import { usePortalApi } from "@/portal-api";
import type { GroupedSyncedSkill } from "@/synced-skill-grouping";

const iconClassName = "app-icon";

export function SkillActions({
  skill,
  groups,
  onRefresh,
}: {
  skill: GroupedSyncedSkill;
  groups: SkillGroup[];
  onRefresh: () => void;
}) {
  const api = usePortalApi();
  const [status, setStatus] = useState("");
  const favoritesGroup = groups.find((group) => group.isFavorites);
  const isFavorite = Boolean(
    favoritesGroup?.syncedSkillIds?.some((id) => skill.allSkillIds.includes(id))
  );
  const selectableGroups = groups.filter((group) => !group.isFavorites);

  async function addToFavorites() {
    if (isFavorite) {
      return;
    }
    setStatus("Adding to Favorites...");
    try {
      if (favoritesGroup) {
        await addSyncedSkillToGroup(api, favoritesGroup.id, skill.id);
      } else {
        await createFavoritesGroup(api, skill.id);
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
      await addSyncedSkillToGroup(api, group.id, skill.id);
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
            <Button
              aria-label="Add to group"
              className="icon-button"
              size="icon"
              title="Add to group"
              variant="secondary"
            >
              <Grid2X2Plus className={iconClassName} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {selectableGroups.length === 0 ? (
              <DropdownMenuItem disabled>No groups yet</DropdownMenuItem>
            ) : null}
            {selectableGroups.map((group) => {
              const alreadyAdded =
                group.syncedSkillIds?.some((id) => skill.allSkillIds.includes(id)) ?? false;
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
