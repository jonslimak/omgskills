export default async (request, context) => {
  const password = Netlify.env.get("HEALTH_BASIC_AUTH_PASSWORD");
  if (!password) {
    return new Response("Health auth is not configured", { status: 503 });
  }

  const expected = `Basic ${btoa(`ops:${password}`)}`;
  if (request.headers.get("authorization") === expected) {
    return context.next();
  }

  return new Response("Authentication required", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="omgskills health"',
      "cache-control": "no-store",
    },
  });
};

export const config = {
  path: ["/health/*", "/data/health.json"],
};
