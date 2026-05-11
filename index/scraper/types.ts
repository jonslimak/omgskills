export interface Skill {
  id: string;
  name: string;
  description: string;
  github_url: string;
  skill_md_path?: string;
  install_cmd: string;
  author_handle: string;
  tags: string[];
  stars: number;
  last_updated: string;
  first_seen: string;
  skill_md_sha?: string;
  source_tag?: string;
  source_url?: string;
  tweet_url?: string;
  tweet_likes?: number;
  tweet_retweets?: number;
  tweet_replies?: number;
  tweet_views?: number;
  tweet_author_handle?: string;
  tweet_author_name?: string;
  tweet_posted_at?: string | null;
  tweet_text?: string;
}
