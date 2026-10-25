import type { CreatorDisplay } from "./model";

// Legacy manifests omit isCompany. Keep their fallback aligned with the Mac app.
const companyHandles = new Set([
  "anthropics", "automattic", "browser-use", "clickhouse", "cloudflare", "cursor",
  "everyinc", "expo", "facebook", "firebase", "firecrawl", "flutter", "getsentry",
  "github", "google-gemini", "google-labs-code", "googleworkspace", "heygen-com",
  "higgsfield-ai", "huggingface", "langchain-ai", "lobehub", "microsoft", "n8n-io",
  "nousresearch", "openai", "paperclipai", "posthog", "pytorch", "react", "shadcn",
  "stripe", "supabase", "trailofbits", "vercel", "vercel-labs", "warpdotdev",
]);

export function isCompany(handle: string, classification?: boolean) {
  return classification ?? companyHandles.has(handle.toLowerCase());
}

export function discoveryCreatorGroups(items: CreatorDisplay[]) {
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return {
    companies: sorted.filter(item => isCompany(item.handle, item.isCompany)),
    creators: sorted.filter(item => !isCompany(item.handle, item.isCompany)),
  };
}

const featuredProfileOrder = new Map<string, number>([
  "anthropics", "openai", "microsoft", "google-gemini", "github", "vercel",
  "cloudflare", "huggingface", "firebase",
  "mattpocock", "emilkowalski", "garrytan", "steipete", "twostraws", "addyosmani",
  "coreyhaines31", "obra", "blader",
].map((handle, index) => [handle, index]));

export function featuredProfiles(items: CreatorDisplay[], limit: number) {
  return [...items].sort((a, b) =>
    (featuredProfileOrder.get(a.handle.toLowerCase()) ?? Infinity)
      - (featuredProfileOrder.get(b.handle.toLowerCase()) ?? Infinity)
    || a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  ).slice(0, limit);
}
