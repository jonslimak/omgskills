export type RuntimeProgress = {
  ratePerMinute: number;
  estimatedRemainingMs: number | null;
};

export function parseOptionalPositiveDurationMs(
  name: string,
  value: string | undefined,
  unitMs: number,
): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed * unitMs;
}

export function runtimeBudgetExpired(
  startedAtMs: number,
  budgetMs: number | null,
  nowMs: number,
): boolean {
  return budgetMs !== null && nowMs - startedAtMs >= budgetMs;
}

export function calculateRuntimeProgress(
  processed: number,
  total: number,
  elapsedMs: number,
): RuntimeProgress {
  if (processed <= 0 || elapsedMs <= 0) {
    return { ratePerMinute: 0, estimatedRemainingMs: null };
  }
  const ratePerMs = processed / elapsedMs;
  return {
    ratePerMinute: ratePerMs * 60_000,
    estimatedRemainingMs: Math.max(0, total - processed) / ratePerMs,
  };
}

export function formatRuntimeDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs)) return "unknown";
  const totalMinutes = Math.max(0, Math.ceil(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function isRequestTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    name?: unknown;
    code?: unknown;
    cause?: { name?: unknown; code?: unknown };
  };
  return (
    value.name === "TimeoutError" ||
    value.name === "AbortError" ||
    value.code === "ETIMEDOUT" ||
    value.cause?.name === "TimeoutError" ||
    value.cause?.name === "AbortError" ||
    value.cause?.code === "ETIMEDOUT"
  );
}

export function isGitHubRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    status?: unknown;
    message?: unknown;
    response?: { headers?: Record<string, unknown> };
  };
  const status = typeof value.status === "number" ? value.status : null;
  if (status === 429) return true;
  if (status !== 403) return false;

  const remaining = value.response?.headers?.["x-ratelimit-remaining"];
  if (String(remaining) === "0") return true;
  return /rate limit|secondary rate|abuse/i.test(
    typeof value.message === "string" ? value.message : "",
  );
}

export function shouldRetryGitHubRateLimit(
  retryAfterSeconds: number,
  retryCount: number,
  maxWaitSeconds: number,
  retriesDisabled: boolean,
): boolean {
  if (retriesDisabled) return false;
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds > maxWaitSeconds) return false;
  return retryCount < 2;
}
