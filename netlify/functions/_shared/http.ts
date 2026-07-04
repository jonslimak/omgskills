const allowedOrigins = new Set([
  "https://app.omgskills.com",
  "http://localhost:5173",
  "http://localhost:8888"
]);

function isAllowedPreviewOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith("--omgskills.netlify.app");
  } catch {
    return false;
  }
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type"
  };

  if (origin && (allowedOrigins.has(origin) || isAllowedPreviewOrigin(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export function optionsResponse(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req)
  });
}

export function jsonResponse(req: Request, body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: {
      ...corsHeaders(req),
      ...init.headers
    }
  });
}

export function errorResponse(req: Request, status: number, message: string): Response {
  return jsonResponse(req, { error: message }, { status });
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs = 8000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Operation timed out")), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
