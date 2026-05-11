export const TRUSTED_VENDOR_HANDLES = [
  "anthropics",
  "firebase",
  "get-convex",
  "github",
  "google-labs-code",
  "google-gemini",
  "googleworkspace",
  "huggingface",
  "larksuite",
  "microsoft",
  "n8n-io",
  "neondatabase",
  "expo",
  "vercel-labs",
  "getsentry",
  "trailofbits",
  "cloudflare",
  "stripe",
  "supabase",
  "supabas",
  "figma",
  "openai",
  "facebook",
  "pytorch",
  "electron",
  "composiohq",
  "firecrawl",
  "heygen-com",
  "openclaw",
] as const;

export const TRUSTED_VENDOR_SET = new Set<string>(TRUSTED_VENDOR_HANDLES);

export function isTrustedVendor(handle: string): boolean {
  return TRUSTED_VENDOR_SET.has(handle);
}
