import { z } from "zod";
import { cacheGetJson, cachePutJson } from "../services/cache";
import { recordServerAudit } from "../services/audit";
import { sha256Hex } from "../services/hash";
import { describeError, logEvent } from "../services/log";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { HttpError, clientIp, formatRetryAfterSeconds, okJson, parseOriginList, originOf, readValidatedBody } from "./utils";
import type { Env } from "../types";

/*
 * Auth gateway in front of Supabase Auth.
 *
 * Note on threat model: the Supabase anon key is public, so Supabase Auth can
 * also be called directly. The gateway's limits are therefore a convenience
 * layer; the authoritative brute-force protection must be configured in
 * Supabase itself (rate limits + CAPTCHA). The gateway forwards CAPTCHA tokens
 * (`captcha_token`) so CAPTCHA can be enabled without bypassing the gateway.
 */

const AUTH_UPSTREAM_TIMEOUT_MS = 5_000;
const AUTH_MAX_BODY_BYTES = 8_000;
/** Matches supabase/config.toml (minimum_password_length) and the web UI. */
export const AUTH_NEW_PASSWORD_MIN_LENGTH = 10;
const AUTH_UPSTREAM_RETRY_DELAYS_MS = [150, 320];
const AUTH_CIRCUIT_FAILURE_THRESHOLD = 3;
const AUTH_CIRCUIT_OPEN_MS = 8_000;
const AUTH_CIRCUIT_STATE_VERSION = 2;
const AUTH_CIRCUIT_STATE_TTL_SECONDS = 120;
/** How long an isolate trusts its last read of the shared circuit state. */
const AUTH_CIRCUIT_LOCAL_TTL_MS = 2_000;

type SupabaseAuthAction = "login" | "signup" | "password_reset" | "password_change" | "logout";

const AUTH_RATE_LIMITS: Record<SupabaseAuthAction, RateLimitConfig> = {
  login: { limit: 30, windowMs: 60 * 1000 },
  signup: { limit: 15, windowMs: 60 * 1000 },
  password_reset: { limit: 10, windowMs: 60 * 1000 },
  password_change: { limit: 20, windowMs: 60 * 1000 },
  logout: { limit: 120, windowMs: 60 * 1000 }
};

/** Only idempotent-safe actions are retried on 5xx/network errors. */
const AUTH_UPSTREAM_RETRIES: Record<SupabaseAuthAction, number> = {
  login: 0,
  signup: 0,
  password_reset: 1,
  password_change: 0,
  logout: 1
};
const AUTH_RETRYABLE_UPSTREAM_STATUS = new Set([500, 502, 503, 504]);

// ---------------------------------------------------------------------------
// Request schemas (passwords are never trimmed or otherwise altered)
// ---------------------------------------------------------------------------

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "invalid email");
const existingPassword = z.string().min(1).max(1024);
const newPassword = z
  .string()
  .min(AUTH_NEW_PASSWORD_MIN_LENGTH, `must be at least ${AUTH_NEW_PASSWORD_MIN_LENGTH} characters`)
  .max(1024);
const accessToken = z.string().trim().min(12).max(4096);
const captchaToken = z.string().min(1).max(4096).optional();
const redirectTo = z.string().max(2048).optional();

const LoginSchema = z.object({ email, password: existingPassword, captcha_token: captchaToken });
const SignupSchema = z.object({ email, password: newPassword, redirect_to: redirectTo, captcha_token: captchaToken });
const ResetSchema = z.object({ email, redirect_to: redirectTo, captcha_token: captchaToken });
const ChangeSchema = z
  .object({
    access_token: accessToken.optional(),
    new_password: newPassword.optional(),
    password: newPassword.optional(),
    nonce: z.string().min(1).max(64).optional()
  })
  .refine((value) => value.new_password !== undefined || value.password !== undefined, {
    message: "new_password is required",
    path: ["new_password"]
  });
const LogoutSchema = z.object({ access_token: accessToken.optional() });

// ---------------------------------------------------------------------------
// Circuit breaker (shared via KV, written only on state transitions)
// ---------------------------------------------------------------------------

type CircuitState = "closed" | "open" | "half_open";

interface CircuitRecord {
  state: CircuitState;
  consecutiveFailures: number;
  nextRetryAtMs: number;
}

interface LocalCircuit extends CircuitRecord {
  loadedAtMs: number;
  /** True while this isolate has a half-open probe in flight. */
  probeInFlight: boolean;
}

const CLOSED: CircuitRecord = { state: "closed", consecutiveFailures: 0, nextRetryAtMs: 0 };
// Keyed by KV binding so independent environments (and tests) never share state.
const localCircuits = new WeakMap<object, Map<SupabaseAuthAction, LocalCircuit>>();
const noKvScope = {};

function circuitKey(action: SupabaseAuthAction): string {
  return `auth:circuit:v${AUTH_CIRCUIT_STATE_VERSION}:${action}`;
}

function localStore(env: Env): Map<SupabaseAuthAction, LocalCircuit> {
  const scope = (env.OFP_KV as object | undefined) ?? noKvScope;
  let store = localCircuits.get(scope);
  if (!store) {
    store = new Map();
    localCircuits.set(scope, store);
  }
  return store;
}

function sanitizeCircuit(raw: unknown): CircuitRecord {
  if (!raw || typeof raw !== "object") {
    return { ...CLOSED };
  }
  const candidate = raw as Partial<CircuitRecord>;
  const state: CircuitState = candidate.state === "open" || candidate.state === "half_open" ? candidate.state : "closed";
  const failures = Number(candidate.consecutiveFailures);
  const retryAt = Number(candidate.nextRetryAtMs);
  return {
    state,
    consecutiveFailures: Number.isFinite(failures) && failures > 0 ? failures : 0,
    nextRetryAtMs: Number.isFinite(retryAt) && retryAt > 0 ? retryAt : 0
  };
}

async function loadCircuit(env: Env, action: SupabaseAuthAction): Promise<LocalCircuit> {
  const store = localStore(env);
  const now = Date.now();
  const cached = store.get(action);
  if (cached && (now - cached.loadedAtMs < AUTH_CIRCUIT_LOCAL_TTL_MS || !env.OFP_KV)) {
    return cached;
  }
  let shared: CircuitRecord = { ...CLOSED };
  if (env.OFP_KV) {
    try {
      shared = sanitizeCircuit(await cacheGetJson<CircuitRecord>(env.OFP_KV, circuitKey(action)));
    } catch (error) {
      logEvent("warn", "auth_circuit_read_failed", { action, ...describeError(error) });
    }
  }
  const local: LocalCircuit = { ...shared, loadedAtMs: now, probeInFlight: cached?.probeInFlight ?? false };
  store.set(action, local);
  return local;
}

async function saveCircuit(env: Env, action: SupabaseAuthAction, next: CircuitRecord): Promise<void> {
  const local = await loadCircuit(env, action);
  const changed =
    local.state !== next.state ||
    local.consecutiveFailures !== next.consecutiveFailures ||
    local.nextRetryAtMs !== next.nextRetryAtMs;
  Object.assign(local, next, { loadedAtMs: Date.now() });
  if (!changed || !env.OFP_KV) {
    return;
  }
  try {
    await cachePutJson(env.OFP_KV, circuitKey(action), next, AUTH_CIRCUIT_STATE_TTL_SECONDS);
  } catch (error) {
    logEvent("warn", "auth_circuit_write_failed", { action, ...describeError(error) });
  }
}

/** Returns whether a call may proceed and, if it is the half-open probe, marks it. */
async function acquireCircuit(env: Env, action: SupabaseAuthAction): Promise<{ allowed: boolean; retryAfterMs: number; probe: boolean }> {
  const circuit = await loadCircuit(env, action);
  const now = Date.now();
  if (circuit.state === "closed") {
    return { allowed: true, retryAfterMs: 0, probe: false };
  }
  if (now < circuit.nextRetryAtMs || circuit.probeInFlight) {
    return { allowed: false, retryAfterMs: Math.max(1, circuit.nextRetryAtMs - now), probe: false };
  }
  circuit.probeInFlight = true;
  await saveCircuit(env, action, { state: "half_open", consecutiveFailures: circuit.consecutiveFailures, nextRetryAtMs: now + AUTH_CIRCUIT_OPEN_MS });
  return { allowed: true, retryAfterMs: 0, probe: true };
}

async function recordCircuitSuccess(env: Env, action: SupabaseAuthAction): Promise<void> {
  const circuit = await loadCircuit(env, action);
  circuit.probeInFlight = false;
  await saveCircuit(env, action, { ...CLOSED });
}

async function recordCircuitFailure(env: Env, action: SupabaseAuthAction): Promise<void> {
  const circuit = await loadCircuit(env, action);
  circuit.probeInFlight = false;
  const now = Date.now();
  if (circuit.state === "half_open") {
    await saveCircuit(env, action, { state: "open", consecutiveFailures: circuit.consecutiveFailures, nextRetryAtMs: now + AUTH_CIRCUIT_OPEN_MS });
    return;
  }
  const failures = circuit.consecutiveFailures + 1;
  await saveCircuit(
    env,
    action,
    failures >= AUTH_CIRCUIT_FAILURE_THRESHOLD
      ? { state: "open", consecutiveFailures: failures, nextRetryAtMs: now + AUTH_CIRCUIT_OPEN_MS }
      : { state: "closed", consecutiveFailures: failures, nextRetryAtMs: 0 }
  );
}

// ---------------------------------------------------------------------------
// Upstream calls
// ---------------------------------------------------------------------------

type UpstreamBody = Record<string, unknown>;

interface UpstreamResult {
  ok: boolean;
  status: number;
  body: UpstreamBody;
}

function authConfig(env: Env): { baseUrl: string; apiKey: string } {
  const baseUrl = env.SUPABASE_URL?.trim();
  const apiKey = env.SUPABASE_ANON_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new HttpError(503, "Authentication is not configured.");
  }
  return { baseUrl, apiKey };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callOnce(
  env: Env,
  endpoint: string,
  method: string,
  payload: UpstreamBody,
  bearer: string | undefined,
  query: Record<string, string> | undefined
): Promise<UpstreamResult> {
  const config = authConfig(env);
  const url = new URL(`${config.baseUrl}/auth/v1/${endpoint}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method,
      headers: {
        "content-type": "application/json",
        apikey: config.apiKey,
        Authorization: `Bearer ${bearer ?? config.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = (await response.json().catch(() => ({}))) as UpstreamBody;
    return { ok: response.ok, status: response.status, body: body && typeof body === "object" ? body : {} };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callSupabaseAuth(
  env: Env,
  action: SupabaseAuthAction,
  endpoint: string,
  method: string,
  payload: UpstreamBody,
  options: { bearer?: string; query?: Record<string, string> } = {}
): Promise<UpstreamResult> {
  const gate = await acquireCircuit(env, action);
  if (!gate.allowed) {
    const seconds = formatRetryAfterSeconds(gate.retryAfterMs);
    throw new HttpError(503, `Authentication gateway is temporarily unavailable. Retry in ${seconds} seconds.`, { "retry-after": seconds });
  }

  const maxRetries = AUTH_UPSTREAM_RETRIES[action];
  for (let attempt = 0; ; attempt += 1) {
    const isLastAttempt = attempt >= maxRetries;
    try {
      const result = await callOnce(env, endpoint, method, payload, options.bearer, options.query);
      if (!AUTH_RETRYABLE_UPSTREAM_STATUS.has(result.status)) {
        // Any non-5xx answer (including 4xx such as wrong password) means the upstream is healthy.
        await recordCircuitSuccess(env, action);
        return result;
      }
      if (isLastAttempt) {
        await recordCircuitFailure(env, action);
        return result;
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      if (isLastAttempt) {
        await recordCircuitFailure(env, action);
        const timedOut = error instanceof Error && error.name === "AbortError";
        logEvent("warn", "auth_upstream_failed", { action, timed_out: timedOut, ...describeError(error) });
        throw timedOut
          ? new HttpError(504, "Authentication service timed out.")
          : new HttpError(503, "Authentication upstream is unavailable.");
      }
    }
    await sleep(AUTH_UPSTREAM_RETRY_DELAYS_MS[attempt] ?? 500);
  }
}

function upstreamMessage(body: UpstreamBody, fallback: string): string {
  for (const key of ["error_description", "msg", "message", "error"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return fallback;
}

function upstreamError(result: UpstreamResult, fallback: string): HttpError {
  return new HttpError(result.status >= 500 ? 502 : result.status, upstreamMessage(result.body, fallback));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hashSeed(value: string): Promise<string> {
  return `h:${await sha256Hex(value)}`;
}

async function enforceRateLimit(request: Request, env: Env, action: SupabaseAuthAction, accountSeed: string): Promise<void> {
  if (!env.RATE_LIMITER_DO) {
    throw new HttpError(503, "Rate limiter is not configured.");
  }
  const config = AUTH_RATE_LIMITS[action];
  const checks: Array<[string, string]> = [
    [rateLimitKey(`auth_${action}`, await hashSeed(clientIp(request)), "ip"), "from this network"],
    [rateLimitKey(`auth_${action}`, await hashSeed(accountSeed), "account"), "for this account"]
  ];
  for (const [key, label] of checks) {
    const result = await checkRateLimit(env.OFP_KV, key, config, Date.now(), env.RATE_LIMITER_DO);
    if (!result.allowed) {
      const seconds = formatRetryAfterSeconds(result.retryAfterMs);
      throw new HttpError(429, `Too many ${action} attempts ${label}. Retry in ${seconds} seconds.`, { "retry-after": seconds });
    }
  }
}

function validatedRedirect(value: string | undefined, env: Env): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new HttpError(400, "Invalid request body. redirect_to: must be an absolute URL");
  }
  const origin = originOf(parsed.toString());
  const allowed = parseOriginList(env.AUTH_ALLOWED_REDIRECT_ORIGINS?.trim() || env.ALLOWED_ORIGINS);
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !origin || !allowed.includes(origin)) {
    throw new HttpError(400, "Invalid request body. redirect_to: origin is not allowed");
  }
  return parsed.toString();
}

function securityMeta(captcha: string | undefined): UpstreamBody {
  return captcha ? { gotrue_meta_security: { captcha_token: captcha } } : {};
}

function bearerFromHeader(request: Request): string | undefined {
  const header = request.headers.get("authorization")?.trim();
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1];
}

/** Flattens `session.{access,refresh}_token` to the top level for clients. */
function withTopLevelTokens(body: UpstreamBody): UpstreamBody {
  const session = body.session && typeof body.session === "object" ? (body.session as UpstreamBody) : null;
  return {
    ...body,
    ...(typeof body.access_token !== "string" && typeof session?.access_token === "string" ? { access_token: session.access_token } : {}),
    ...(typeof body.refresh_token !== "string" && typeof session?.refresh_token === "string" ? { refresh_token: session.refresh_token } : {})
  };
}

function userIdFrom(body: UpstreamBody): string | null {
  const user = body.user && typeof body.user === "object" ? (body.user as UpstreamBody) : body;
  return typeof user.id === "string" ? user.id : null;
}

/** `sub` of a token that the upstream has just accepted (used for audit attribution only). */
function subjectOfAcceptedToken(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleAuthLogin(request: Request, env: Env): Promise<Response> {
  const body = await readValidatedBody(request, LoginSchema, AUTH_MAX_BODY_BYTES);
  await enforceRateLimit(request, env, "login", body.email);
  const result = await callSupabaseAuth(env, "login", "token?grant_type=password", "POST", {
    email: body.email,
    password: body.password,
    ...securityMeta(body.captcha_token)
  });
  if (!result.ok) {
    throw upstreamError(result, "Invalid credentials.");
  }
  await recordServerAudit(env, userIdFrom(result.body), "login", "success", "Signed in via gateway.");
  return okJson(request, env, withTopLevelTokens(result.body));
}

export async function handleAuthSignup(request: Request, env: Env): Promise<Response> {
  const body = await readValidatedBody(request, SignupSchema, AUTH_MAX_BODY_BYTES);
  const redirect = validatedRedirect(body.redirect_to, env);
  await enforceRateLimit(request, env, "signup", body.email);
  const result = await callSupabaseAuth(
    env,
    "signup",
    "signup",
    "POST",
    { email: body.email, password: body.password, ...securityMeta(body.captcha_token) },
    { query: redirect ? { redirect_to: redirect } : undefined }
  );
  if (!result.ok) {
    throw upstreamError(result, "Sign up request failed.");
  }
  await recordServerAudit(env, userIdFrom(result.body), "signup", "success", "Account created via gateway.");
  return okJson(request, env, withTopLevelTokens(result.body));
}

export async function handleAuthPasswordReset(request: Request, env: Env): Promise<Response> {
  const body = await readValidatedBody(request, ResetSchema, AUTH_MAX_BODY_BYTES);
  const redirect = validatedRedirect(body.redirect_to, env);
  await enforceRateLimit(request, env, "password_reset", body.email);
  const result = await callSupabaseAuth(
    env,
    "password_reset",
    "recover",
    "POST",
    { email: body.email, ...securityMeta(body.captcha_token) },
    { query: redirect ? { redirect_to: redirect } : undefined }
  );
  if (!result.ok) {
    throw upstreamError(result, "Password reset request failed.");
  }
  return okJson(request, env, { ok: true });
}

export async function handleAuthPasswordChange(request: Request, env: Env): Promise<Response> {
  const body = await readValidatedBody(request, ChangeSchema, AUTH_MAX_BODY_BYTES);
  const token = bearerFromHeader(request) ?? body.access_token;
  if (!token) {
    throw new HttpError(401, "Missing bearer token.");
  }
  await enforceRateLimit(request, env, "password_change", token);
  const result = await callSupabaseAuth(
    env,
    "password_change",
    "user",
    "PUT",
    { password: body.new_password ?? body.password, ...(body.nonce ? { nonce: body.nonce } : {}) },
    { bearer: token }
  );
  if (!result.ok) {
    throw upstreamError(result, "Password change failed.");
  }
  await recordServerAudit(env, userIdFrom(result.body), "password_change", "success", "Password changed via gateway.");
  return okJson(request, env, { ok: true, user_id: userIdFrom(result.body) });
}

export async function handleAuthLogout(request: Request, env: Env): Promise<Response> {
  const body = await readValidatedBody(request, LogoutSchema, AUTH_MAX_BODY_BYTES);
  const token = bearerFromHeader(request) ?? body.access_token;
  if (!token) {
    throw new HttpError(401, "Missing bearer token.");
  }
  await enforceRateLimit(request, env, "logout", token);
  const result = await callSupabaseAuth(env, "logout", "logout", "POST", {}, { bearer: token });
  if (!result.ok && result.status !== 204) {
    throw upstreamError(result, "Logout failed.");
  }
  await recordServerAudit(env, subjectOfAcceptedToken(token), "logout", "success", "Signed out via gateway.");
  return okJson(request, env, { ok: true });
}
