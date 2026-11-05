/** Upstream HTTP helpers shared by all ingest sources. */

const UPSTREAM_TIMEOUT_MS = 10_000;
const UPSTREAM_MAX_ATTEMPTS = 3;
const UPSTREAM_RETRY_BASE_MS = 250;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("upstream_timeout"), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches a URL with timeout and bounded exponential-backoff retries on 408/429/5xx/network errors. */
export async function fetchUpstream(url: string, init: RequestInit = {}, label = "upstream"): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init);
      if (response.ok) {
        return response;
      }
      const error = new UpstreamError(`${label}: HTTP ${response.status}`, isRetryableStatus(response.status), response.status);
      if (!error.retryable) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (error instanceof UpstreamError && !error.retryable) {
        throw error;
      }
      lastError = error instanceof UpstreamError ? error : new UpstreamError(`${label}: ${String((error as Error)?.message ?? error)}`, true);
    }
    if (attempt < UPSTREAM_MAX_ATTEMPTS) {
      await sleep(UPSTREAM_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new UpstreamError(`${label}: request failed`, true);
}

export async function fetchText(url: string, init: RequestInit = {}, label = "upstream"): Promise<string> {
  const response = await fetchUpstream(url, init, label);
  return response.text();
}

/**
 * Fetches JSON. A 200 response with a non-JSON body (e.g. GDELT's plain-text
 * "Please limit requests..." throttle notice) is an UpstreamError; it is
 * retryable when it looks like throttling.
 */
export async function fetchJson<T>(url: string, init: RequestInit = {}, label = "upstream"): Promise<T> {
  const text = await fetchText(url, init, label);
  try {
    return JSON.parse(text) as T;
  } catch {
    const throttled = /limit requests|too many requests|rate limit/i.test(text);
    throw new UpstreamError(`${label}: non-JSON response${throttled ? " (throttled)" : ""}: ${text.slice(0, 120)}`, throttled);
  }
}
