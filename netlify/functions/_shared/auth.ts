import { verifyToken } from "@clerk/backend";
import { getEnv } from "./env.js";

export type AuthenticatedUser = {
  clerkUserId: string;
  sessionId?: string;
};

function tokenFromRequest(req: Request): string | undefined {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice("bearer ".length).trim();
  }

  const cookieHeader = req.headers.get("cookie");
  const sessionCookie = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("__session="));

  return sessionCookie ? decodeURIComponent(sessionCookie.slice("__session=".length)) : undefined;
}

export async function requireAuth(req: Request): Promise<AuthenticatedUser> {
  const token = tokenFromRequest(req);
  if (!token) {
    throw new Response("Missing Clerk session token", { status: 401 });
  }

  const secretKey = getEnv("CLERK_SECRET_KEY");
  if (!secretKey) {
    throw new Response("Missing Clerk server configuration", { status: 500 });
  }

  try {
    const verified = await verifyToken(token, {
      secretKey
    });

    return {
      clerkUserId: verified.sub,
      sessionId: typeof verified.sid === "string" ? verified.sid : undefined
    };
  } catch {
    throw new Response("Invalid Clerk session token", { status: 401 });
  }
}
