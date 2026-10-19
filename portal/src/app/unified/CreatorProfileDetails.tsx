import React, { useEffect, useState } from "react";
import { loadCreatorProfiles, rankingLabels, type CreatorProfileSummary } from "./creator-profiles";
import { starCount } from "./model";

export function CreatorProfileText({ profile }: { profile: CreatorProfileSummary }) {
  return <div className="ua-creator-profile-text">
    {profile.description && <p className="ua-creator-profile-description">{profile.description}</p>}
    <div className="ua-creator-profile-details">
      {profile.rankings.length > 0 && <div className="ua-creator-profile-rankings">
        {profile.rankings.map(badge => <p key={badge.category}><strong>{rankingLabels[badge.category]} #{badge.rank}</strong></p>)}
      </div>}
      {(profile.totalStars !== undefined || profile.skillCount !== undefined || profile.totalInstalls !== undefined) && <div className="ua-creator-profile-stats" role="group" aria-label="Creator statistics">
        {profile.totalStars !== undefined && <span><strong>{starCount(profile.totalStars)}</strong> Stars</span>}
        {profile.skillCount !== undefined && <span><strong>{profile.skillCount.toLocaleString("en")}</strong> Skills</span>}
        {profile.totalInstalls !== undefined && <span><strong>{starCount(profile.totalInstalls)}</strong> Installs</span>}
      </div>}
    </div>
  </div>;
}

function useCreatorProfile(handle: string) {
  const [profile, setProfile] = useState<{ handle: string; value: CreatorProfileSummary }>();
  useEffect(() => {
    let active = true;
    void loadCreatorProfiles().then(profiles => {
      const value = profiles[handle.toLowerCase()];
      if (active && value) setProfile({ handle, value });
    }).catch(() => { /* Profile statistics must never block browsing skills. */ });
    return () => { active = false; };
  }, [handle]);
  return profile?.handle === handle ? profile.value : undefined;
}

export function CreatorProfileLinks({ profile }: { profile: CreatorProfileSummary }) {
  return <>
    {profile.githubUrl && <a className="ua-creator-social-link" href={profile.githubUrl} target="_blank" rel="noreferrer" aria-label="View on GitHub" title="View on GitHub"><span className="ua-creator-github-mark" aria-hidden="true" /></a>}
    {profile.xUrl && <a className="ua-creator-social-link" href={profile.xUrl} target="_blank" rel="noreferrer" aria-label="View on X" title="View on X"><span className="ua-creator-x-mark" aria-hidden="true" /></a>}
  </>;
}

export function CreatorSocialLinks({ handle }: { handle: string }) {
  const profile = useCreatorProfile(handle);
  return profile ? <CreatorProfileLinks profile={profile} /> : null;
}

export function CreatorProfileDetails({ handle }: { handle: string }) {
  const profile = useCreatorProfile(handle);
  return profile ? <CreatorProfileText profile={profile} /> : null;
}
