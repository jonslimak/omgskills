export type SkillEntry = {
  name: string;
  author: string;
  stars: string;
  installs?: string;
  tagline: string;
  points: string[];
  url: string;
  logo?: string;
  icon?: string;
};

export type SegmentEntry = {
  type: "intro" | "skill" | "wrap";
  index?: number;
  startSec: number;
};

export type VideoData = {
  id: string;
  title: string;
  displayTitle?: string;
  subtitle?: string;
  wrapTitle: string;
  audio: string;
  audioDurationSec: number;
  authorLogo?: string;
  authorHandle?: string;
  brandColor?: string;
  segments: SegmentEntry[];
  skills: SkillEntry[];
};
