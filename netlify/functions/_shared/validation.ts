export function requireString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== "string") {
    throw new Response(`${field} must be a string`, { status: 400 });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Response(`${field} is required`, { status: 400 });
  }
  if (trimmed.length > maxLength) {
    throw new Response(`${field} is too long`, { status: 400 });
  }
  return trimmed;
}

export function optionalString(value: unknown, maxLength = 1000): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Response("Expected string value", { status: 400 });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new Response("String value is too long", { status: 400 });
  }
  return trimmed;
}

export function normalizeEmail(value: unknown): string {
  const email = requireString(value, "email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Response("email must be valid", { status: 400 });
  }
  return email;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "skill-group";
}
