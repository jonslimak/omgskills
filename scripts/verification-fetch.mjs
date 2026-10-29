const attempts = 3;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function describeError(error, depth = 0) {
  const details = [`${error?.code ? `${error.code}: ` : ""}${error?.message || String(error)}`];
  if (depth < 3) {
    if (error?.cause) details.push(describeError(error.cause, depth + 1));
    for (const nested of error?.errors || []) details.push(describeError(nested, depth + 1));
  }
  return details.join(" <- ");
}

export async function consumeVerificationBody(response, url) {
  try {
    // Streaming and discarding permits connection reuse without buffering whole pages.
    if (response.body) for await (const chunk of response.body) { void chunk; }
  } catch (error) {
    throw new Error(`Failed to read response body from ${url}: ${describeError(error)}`, { cause: error });
  }
}

export async function fetchForVerification(url, options = {}, {
  fetchImpl = fetch,
  timeoutMs = 20_000,
  expectedStatus,
  sleep: wait = sleep,
  onRetry = console.warn,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let failure;
    try {
      options.signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await fetchImpl(url, {
        ...options,
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
      if (response.status < 500 || response.status === expectedStatus || attempt === attempts) return response;
      failure = new Error(`HTTP ${response.status}`);
      await consumeVerificationBody(response, url);
    } catch (error) {
      failure = error;
      if (attempt === attempts || options.signal?.aborted) {
        throw new Error(`Failed to fetch ${url} after ${attempt} attempts: ${describeError(error)}`, { cause: error });
      }
    }
    const delay = 500 * attempt;
    onRetry(`[verification] ${url}: attempt ${attempt}/${attempts} failed: ${describeError(failure)}; retrying in ${delay}ms`);
    await wait(delay);
  }
}
