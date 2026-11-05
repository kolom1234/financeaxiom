/**
 * Client-side courtesy lockout after repeated failed attempts (UX only; the
 * authoritative limits are enforced server-side).
 */
interface AuthFailureState {
  failures: number;
  lockedUntil: number | null;
  lastFailureAt?: number;
}

const AUTH_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
const MAX_AUTH_FAILURES = 5;
const AUTH_FAILURE_STORE_KEY = "ofp_auth_failures_v1";

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function readStore(): Record<string, AuthFailureState> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTH_FAILURE_STORE_KEY) ?? "{}") as Record<string, AuthFailureState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, AuthFailureState>): void {
  try {
    window.localStorage.setItem(AUTH_FAILURE_STORE_KEY, JSON.stringify(store));
  } catch {
    // Best effort only.
  }
}

function currentState(email: string): AuthFailureState {
  const state = readStore()[normalizeEmailAddress(email)];
  const now = Date.now();
  if (!state || (state.lockedUntil && state.lockedUntil <= now) || (state.lastFailureAt && now - state.lastFailureAt > AUTH_LOCKOUT_WINDOW_MS)) {
    return { failures: 0, lockedUntil: null };
  }
  return state;
}

function saveState(email: string, state: AuthFailureState): void {
  const key = normalizeEmailAddress(email);
  if (!key) {
    return;
  }
  const store = readStore();
  if (state.failures <= 0) {
    delete store[key];
  } else {
    store[key] = state;
  }
  writeStore(store);
}

export function lockoutRemainingMs(email: string): number {
  const state = currentState(email);
  return state.lockedUntil ? Math.max(0, state.lockedUntil - Date.now()) : 0;
}

export function clearAuthFailures(email: string): void {
  saveState(email, { failures: 0, lockedUntil: null });
}

export function recordAuthFailure(email: string): number {
  if (!normalizeEmailAddress(email)) {
    return 0;
  }
  const state = currentState(email);
  state.failures += 1;
  state.lastFailureAt = Date.now();
  if (state.failures >= MAX_AUTH_FAILURES) {
    state.lockedUntil = Date.now() + AUTH_LOCKOUT_WINDOW_MS;
  }
  saveState(email, state);
  return state.failures;
}

export function formatLockoutSeconds(remainingMs: number): string {
  return `${Math.max(1, Math.ceil(remainingMs / 1000))}s`;
}
