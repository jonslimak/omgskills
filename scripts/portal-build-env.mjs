// The combined artifact is published by both manual and scheduled production deploys.
export function verifyPortalBuildEnv(env = process.env) {
  const key = env.VITE_CLERK_PUBLISHABLE_KEY;
  const encoded = typeof key === "string" && /^pk_live_([A-Za-z0-9+/]+={0,2})$/.exec(key)?.[1];
  const expected = Buffer.from("clerk.omgskills.com$").toString("base64");
  if (!encoded || encoded.replace(/=+$/, "") !== expected.replace(/=+$/, "")) {
    throw new Error("A production Clerk publishable key for clerk.omgskills.com is required. Set VITE_CLERK_PUBLISHABLE_KEY to the same live value in GitHub Actions and Netlify.");
  }
}
