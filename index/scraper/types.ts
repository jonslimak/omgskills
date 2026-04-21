export interface Skill {
  id: string;
  name: string;
  description: string;
  github_url: string;
  install_cmd: string;
  author_handle: string;
  tags: string[];
  readme_snippet?: string;
  stars: number;
  last_updated: string;
  first_seen: string;
  skill_md_sha?: string;
}
