export const CREATOR_BACKFILL_GITHUB_MAX_ATTEMPTS = 3;

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const transientCodes = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

function numericStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : null;
}

export function isTransientCreatorBackfillGitHubError(error: unknown): boolean {
  const status = numericStatus(error);
  if (status !== null) return transientStatuses.has(status);
  const code = errorCode(error);
  return code !== null && transientCodes.has(code);
}

export async function withCreatorBackfillGitHubRetry<T>(input: {
  label: string;
  operation: () => Promise<T>;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<T> {
  const maxAttempts = input.maxAttempts ?? CREATOR_BACKFILL_GITHUB_MAX_ATTEMPTS;
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.operation();
    } catch (error) {
      lastError = error;
      if (!isTransientCreatorBackfillGitHubError(error)) throw error;
      if (attempt === maxAttempts) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${input.label} failed after ${maxAttempts} attempts: ${message}`, { cause: error });
      }
      await sleep(500 * (2 ** (attempt - 1)));
    }
  }

  throw new Error(`${input.label} failed after ${maxAttempts} attempts`, { cause: lastError });
}
