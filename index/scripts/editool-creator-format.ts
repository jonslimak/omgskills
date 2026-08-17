import type { CreatorRegistrySource } from "../scraper/creator-registry.js";

// Keep creators.json compact and byte-stable while preserving every reviewed field.
export function formatCreatorRegistry(source: CreatorRegistrySource): string {
  const lines = source.creators.map((entry) => {
    const parts = [`"handle": ${JSON.stringify(entry.handle)}`];
    if (entry.roles !== undefined) parts.push(`"roles": ${JSON.stringify(entry.roles)}`);
    parts.push(`"watch": ${JSON.stringify(entry.watch ?? false)}`);
    parts.push(`"featured": ${JSON.stringify(entry.featured ?? false)}`);
    if (entry.aliases?.length) parts.push(`"aliases": ${JSON.stringify(entry.aliases)}`);
    if (entry.skillCoverage !== undefined) {
      parts.push(`"skillCoverage": ${JSON.stringify(entry.skillCoverage)}`);
    }
    if (entry.skillRepos?.length) parts.push(`"skillRepos": ${JSON.stringify(entry.skillRepos)}`);
    if (entry.skillPathExclusions?.length) {
      parts.push(`"skillPathExclusions": ${JSON.stringify(entry.skillPathExclusions)}`);
    }
    if (entry.notes) parts.push(`"notes": ${JSON.stringify(entry.notes)}`);
    return `    { ${parts.join(", ")} }`;
  });
  return `{\n  "creators": [\n${lines.join(",\n")}\n  ]\n}\n`;
}
