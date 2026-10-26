export function createCheckedXFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!new URL(url).pathname.endsWith("/SearchTimeline")) return response;

    if (!response.ok) throw new Error(`X search HTTP ${response.status}`);

    let body;
    try {
      body = await response.clone().json();
    } catch {
      throw new Error("X search returned non-JSON data");
    }
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      const codes = [...new Set(body.errors.map((error: { code?: unknown }) =>
        typeof error?.code === "number" ? error.code : "unknown"))];
      throw new Error(`X search API error codes: ${codes.join(", ")}`);
    }
    const instructions = body?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
    if (!Array.isArray(instructions)) {
      throw new Error("X search response missing timeline instructions");
    }
    return response;
  };
}
