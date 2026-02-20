import { clientIp, errorJson, okJson, readJsonWithLimit, RequestBodyError } from "./utils";
import type { Env } from "../types";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { cacheGetJson, cachePutJson } from "../services/cache";
import { sha256Hex } from "../services/hash";

const AUTH_UPSTREAM_TIMEOUT_MS = 5_000;
const AUTH_MAX_BODY_BYTES = 8_000;
const AUTH_PASSWORD_MIN_LENGTH = 8;
const AUTH_EMAIL_MAX_LENGTH = 254;
const AUTH_TOKEN_MAX_LENGTH = 4_096;
const AUTH_TOKEN_MIN_LENGTH = 12;
const AUTH_REDIRECT_MAX_LENGTH = 2_048;
const AUTH_UPSTREAM_RETRY_MS = [150, 320];
const AUTH_CIRCUIT_FAILURE_THRESHOLD = 3;
const AUTH_CIRCUIT_OPEN_MS = 8_000;
const AUTH_CIRCUIT_STATE_VERSION = 1;
const AUTH_CIRCUIT_STATE_TTL_SECONDS = 120;
const AUTH_CIRCUIT_STATE_KEY_PREFIX = "auth:circuit";

const AUTH_RATE_LIMITS: Record<
  "login" | "signup" | "password_reset" | "password_change" | "logout",
  RateLimitConfig
> = {
  login: { limit: 30, windowMs: 60 * 1000 },
  signup: { limit: 15, windowMs: 60 * 1000 },
  password_reset: { limit: 10, windowMs: 60 * 1000 },
  password_change: { limit: 20, windowMs: 60 * 1000 },
  logout: { limit: 120, windowMs: 60 * 1000 }
};
const AUTH_UPSTREAM_RETRIES: Record<
  "login" | "signup" | "password_reset" | "password_change" | "logout",
  number
> = {
  login: 0,
  signup: 0,
  password_reset: 1,
  password_change: 0,
  logout: 1
};
const AUTH_RETRYABLE_UPSTREAM_STATUS = new Set([500, 502, 503, 504]);

type AuthCircuitState = "closed" | "open" | "half_open";

interface AuthCircuitStateRecord {
  state: AuthCircuitState;
  consecutiveFailures: number;
  openedAtMs: number;
  nextRetryAtMs: number;
  halfOpenInFlight: boolean;
  updatedAtMs: number;
}

interface AuthGatewayPayload {
  [key: string]: unknown;
}

interface AuthGatewayRequest {
  email?: unknown;
  password?: unknown;
  new_password?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  redirect_to?: unknown;
}

type SupabaseAuthAction = keyof typeof AUTH_RATE_LIMITS;

const authCircuitStateByAction: Record<SupabaseAuthAction, AuthCircuitStateRecord> = {
  login: {
    state: "closed",
    consecutiveFailures: 0,
    openedAtMs: 0,
    nextRetryAtMs: 0,
    halfOpenInFlight: false,
    updatedAtMs: 0
  },
  signup: {
    state: "closed",
    consecutiveFailures: 0,
    openedAtMs: 0,
    nextRetryAtMs: 0,
    halfOpenInFlight: false,
    updatedAtMs: 0
  },
  password_reset: {
    state: "closed",
    consecutiveFailures: 0,
    openedAtMs: 0,
    nextRetryAtMs: 0,
    halfOpenInFlight: false,
    updatedAtMs: 0
  },
  password_change: {
    state: "closed",
    consecutiveFailures: 0,
    openedAtMs: 0,
    nextRetryAtMs: 0,
    halfOpenInFlight: false,
    updatedAtMs: 0
  },
  logout: {
    state: "closed",
    consecutiveFailures: 0,
    openedAtMs: 0,
    nextRetryAtMs: 0,
    halfOpenInFlight: false,
    updatedAtMs: 0
  }
};

interface AuthCircuitCheckResult {
  allowed: boolean;
  retryAfterMs?: number;
}

interface PersistedAuthCircuitState {
  schemaVersion: number;
  state: AuthCircuitState;
  consecutiveFailures: number;
  openedAtMs: number;
  nextRetryAtMs: number;
  updatedAtMs: number;
}

function isRetryableStatus(status: number): boolean {
  return AUTH_RETRYABLE_UPSTREAM_STATUS.has(status);
}

function buildAuthCircuitKey(action: SupabaseAuthAction): string {
  return `${AUTH_CIRCUIT_STATE_KEY_PREFIX}:${action}`;
}

function defaultAuthCircuitState(): AuthCircuitStateRecord {
  return {
    state: "closed",
    consecutiveFailures: 0,
    openedAtMs: 0,
    nextRetryAtMs: 0,
    halfOpenInFlight: false,
    updatedAtMs: Date.now()
  };
}

function getAuthCircuitState(action: SupabaseAuthAction): AuthCircuitStateRecord {
  return authCircuitStateByAction[action];
}

function sanitizePersistedCircuitState(raw: unknown): AuthCircuitStateRecord {
  if (!raw || typeof raw !== "object") {
    return defaultAuthCircuitState();
  }

  const candidate = raw as Partial<PersistedAuthCircuitState>;
  const validState = candidate.state === "open" || candidate.state === "half_open" || candidate.state === "closed"
    ? candidate.state
    : "closed";

  const nextRetryAtMs = typeof candidate.nextRetryAtMs === "number" && Number.isFinite(candidate.nextRetryAtMs) && candidate.nextRetryAtMs > 0
    ? candidate.nextRetryAtMs
    : 0;
  const openedAtMs = typeof candidate.openedAtMs === "number" && Number.isFinite(candidate.openedAtMs) && candidate.openedAtMs > 0
    ? candidate.openedAtMs
    : 0;
  const consecutiveFailures = typeof candidate.consecutiveFailures === "number" && Number.isFinite(candidate.consecutiveFailures) && candidate.consecutiveFailures >= 0
    ? candidate.consecutiveFailures
    : 0;
  const updatedAtMs = typeof candidate.updatedAtMs === "number" && Number.isFinite(candidate.updatedAtMs) && candidate.updatedAtMs > 0
    ? candidate.updatedAtMs
    : Date.now();

  return {
    state: validState,
    consecutiveFailures,
    openedAtMs,
    nextRetryAtMs,
    halfOpenInFlight: false,
    updatedAtMs
  };
}

async function loadAuthCircuitState(
  env: Env,
  action: SupabaseAuthAction
): Promise<AuthCircuitStateRecord> {
  const localState = getAuthCircuitState(action);
  if (!env.OFP_KV) {
    return localState;
  }

  const now = Date.now();
  try {
    const persisted = await cacheGetJson<PersistedAuthCircuitState>(env.OFP_KV, buildAuthCircuitKey(action));
    if (!persisted || persisted.schemaVersion !== AUTH_CIRCUIT_STATE_VERSION) {
      localState.state = "closed";
      localState.consecutiveFailures = 0;
      localState.openedAtMs = 0;
      localState.nextRetryAtMs = 0;
      localState.halfOpenInFlight = false;
      localState.updatedAtMs = now;
      return localState;
    }

    const sanitized = sanitizePersistedCircuitState(persisted);
    localState.state = sanitized.state;
    localState.consecutiveFailures = sanitized.consecutiveFailures;
    localState.openedAtMs = sanitized.openedAtMs;
    localState.nextRetryAtMs = sanitized.nextRetryAtMs;
    localState.halfOpenInFlight = sanitized.halfOpenInFlight;
    localState.updatedAtMs = sanitized.updatedAtMs;
    return localState;
  } catch {
    return localState;
  }
}

async function persistAuthCircuitState(
  env: Env,
  action: SupabaseAuthAction,
  state: AuthCircuitStateRecord
): Promise<void> {
  if (!env.OFP_KV) {
    return;
  }
  const payload: PersistedAuthCircuitState = {
    schemaVersion: AUTH_CIRCUIT_STATE_VERSION,
    state: state.state,
    consecutiveFailures: state.consecutiveFailures,
    openedAtMs: state.openedAtMs,
    nextRetryAtMs: state.nextRetryAtMs,
    updatedAtMs: Date.now()
  };

  try {
    await cachePutJson(env.OFP_KV, buildAuthCircuitKey(action), payload, AUTH_CIRCUIT_STATE_TTL_SECONDS);
  } catch {
    // Fall back to process memory on cache errors.
  }
}

async function checkAuthCircuit(env: Env, action: SupabaseAuthAction): Promise<AuthCircuitCheckResult> {
  const state = await loadAuthCircuitState(env, action);
  const now = Date.now();
  let stateChanged = false;

  if (state.state === "open") {
    if (now < state.nextRetryAtMs) {
      return { allowed: false, retryAfterMs: state.nextRetryAtMs - now };
    }
    state.state = "half_open";
    stateChanged = true;
  }

  if (state.state === "half_open") {
    if (state.halfOpenInFlight) {
      return { allowed: false, retryAfterMs: Math.max(1, state.nextRetryAtMs - now) };
    }
    state.halfOpenInFlight = true;
    state.nextRetryAtMs = now + AUTH_CIRCUIT_OPEN_MS;
    stateChanged = true;
  }

  if (!stateChanged) {
    return { allowed: true };
  }

  state.updatedAtMs = now;
  await persistAuthCircuitState(env, action, state);
  return { allowed: true };
}

async function failAuthCircuit(env: Env, action: SupabaseAuthAction): Promise<void> {
  const state = await loadAuthCircuitState(env, action);
  state.halfOpenInFlight = false;

  if (state.state === "half_open") {
    state.state = "open";
    const now = Date.now();
    state.openedAtMs = now;
    state.nextRetryAtMs = now + AUTH_CIRCUIT_OPEN_MS;
  } else {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= AUTH_CIRCUIT_FAILURE_THRESHOLD) {
      state.state = "open";
      const now = Date.now();
      state.openedAtMs = now;
      state.nextRetryAtMs = now + AUTH_CIRCUIT_OPEN_MS;
    } else {
      state.state = "closed";
    }
  }

  state.updatedAtMs = Date.now();
  await persistAuthCircuitState(env, action, state);
}

async function closeAuthCircuit(env: Env, action: SupabaseAuthAction): Promise<void> {
  const state = await loadAuthCircuitState(env, action);
  state.halfOpenInFlight = false;
  state.state = "closed";
  state.consecutiveFailures = 0;
  state.openedAtMs = 0;
  state.nextRetryAtMs = 0;
  state.updatedAtMs = Date.now();

  await persistAuthCircuitState(env, action, state);
}

async function releaseAuthCircuitProbe(env: Env, action: SupabaseAuthAction): Promise<void> {
  const state = await loadAuthCircuitState(env, action);
  state.halfOpenInFlight = false;
  state.updatedAtMs = Date.now();
  await persistAuthCircuitState(env, action, state);
}

class AuthGatewayError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AuthGatewayError";
  }
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function normalizeToken(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeOrigin(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function allowedRedirectOrigins(env: Env): string[] {
  const raw = env.AUTH_ALLOWED_REDIRECT_ORIGINS?.trim() || env.ALLOWED_ORIGINS?.trim() || "";
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeRedirect(input: unknown, env: Env): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const value = input.trim();
  if (!value || value.length > AUTH_REDIRECT_MAX_LENGTH) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return undefined;
  }
  const origin = normalizeOrigin(parsed.toString());
  if (!origin) {
    return undefined;
  }
  const allowed = allowedRedirectOrigins(env);
  if (allowed.length === 0 || !allowed.includes(origin)) {
    return undefined;
  }
  return parsed.toString();
}

function isValidEmail(value: string): boolean {
  return value.length > 0 && value.length <= AUTH_EMAIL_MAX_LENGTH && value.includes("@") && value.includes(".");
}

function isValidToken(value: string): boolean {
  return value.length >= AUTH_TOKEN_MIN_LENGTH && value.length <= AUTH_TOKEN_MAX_LENGTH;
}

function isValidPassword(value: string): boolean {
  return value.length >= AUTH_PASSWORD_MIN_LENGTH;
}

async function hashRateLimitSeed(value: string): Promise<string> {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return "";
  }
  const digest = await sha256Hex(normalized);
  return `h:${digest}`;
}

function buildMessage(payload: unknown, defaultMessage: string): string {
  if (!payload || typeof payload !== "object") {
    return defaultMessage;
  }

  const typed = payload as Record<string, unknown>;

  if (typeof typed.error_description === "string" && typed.error_description.trim().length > 0) {
    return typed.error_description;
  }
  if (typeof typed.error === "string" && typed.error.trim().length > 0) {
    return typed.error;
  }
  if (typeof typed.msg === "string" && typed.msg.trim().length > 0) {
    return typed.msg;
  }
  if (typeof typed.message === "string" && typed.message.trim().length > 0) {
    return typed.message;
  }

  return defaultMessage;
}

function makeAuthHeaders(apiKey: string, accessToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    apikey: apiKey
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function extractAuthConfig(env: Env): { baseUrl: string; apiKey: string } {
  const baseUrl = env.SUPABASE_URL?.trim();
  const apiKey = env.SUPABASE_ANON_KEY?.trim();

  if (!baseUrl) {
    throw new AuthGatewayError(503, "SUPABASE_URL is not configured.");
  }
  if (!apiKey) {
    throw new AuthGatewayError(503, "SUPABASE_ANON_KEY is not configured.");
  }

  return { baseUrl, apiKey };
}

function formatRateLimitSeconds(milliseconds: number): string {
  return String(Math.max(1, Math.ceil(milliseconds / 1000)));
}

async function enforceRateLimit(
  request: Request,
  env: Env,
  action: SupabaseAuthAction,
  keySeed: string
): Promise<null | Response> {
  if (!env.RATE_LIMITER_DO) {
    return errorJson(request, env, 503, "Rate limiter is not configured.");
  }

  const config = AUTH_RATE_LIMITS[action];
  const networkSeed = (await hashRateLimitSeed(clientIp(request))) || "unknown";
  const networkKey = rateLimitKey(`auth_${action}`, networkSeed, "ip");
  const networkResult = await checkRateLimit(env.OFP_KV, networkKey, config, Date.now(), env.RATE_LIMITER_DO);
  if (!networkResult.allowed) {
    return errorJson(
      request,
      env,
      429,
      `Too many ${action} attempts from this network. Retry in ${formatRateLimitSeconds(networkResult.retryAfterMs)} seconds.`,
      { "retry-after": formatRateLimitSeconds(networkResult.retryAfterMs) }
    );
  }

  if (keySeed) {
    const accountSeed = await hashRateLimitSeed(keySeed);
    if (accountSeed) {
      const accountKey = rateLimitKey(`auth_${action}`, accountSeed, "account");
      const accountResult = await checkRateLimit(env.OFP_KV, accountKey, config, Date.now(), env.RATE_LIMITER_DO);
      if (!accountResult.allowed) {
        return errorJson(
          request,
          env,
          429,
          `Too many ${action} attempts for this account. Retry in ${formatRateLimitSeconds(accountResult.retryAfterMs)} seconds.`,
          { "retry-after": formatRateLimitSeconds(accountResult.retryAfterMs) }
        );
      }
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callSupabaseAuthAttempt(
  env: Env,
  endpoint: string,
  method: string,
  payload: AuthGatewayPayload,
  accessToken?: string,
  query?: Record<string, string>
): Promise<{ ok: boolean; status: number; body: AuthGatewayPayload }> {
  const config = extractAuthConfig(env);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_UPSTREAM_TIMEOUT_MS);
  const requestUrl = new URL(`${config.baseUrl}/auth/v1/${endpoint}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) {
        requestUrl.searchParams.set(key, value);
      }
    }
  }

  try {
    const response = await fetch(requestUrl.toString(), {
      method,
      headers: makeAuthHeaders(config.apiKey, accessToken),
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const body = (await response.json().catch(() => ({} as unknown))) as AuthGatewayPayload;
    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callSupabaseAuth(
  env: Env,
  endpoint: string,
  method: string,
  payload: AuthGatewayPayload,
  accessToken: string | undefined,
  action: SupabaseAuthAction,
  query?: Record<string, string>
): Promise<{ ok: boolean; status: number; body: AuthGatewayPayload }> {
  const maxRetries = AUTH_UPSTREAM_RETRIES[action];
  const circuitCheck = await checkAuthCircuit(env, action);
  if (!circuitCheck.allowed) {
    const seconds = Math.max(1, Math.ceil((circuitCheck.retryAfterMs ?? AUTH_CIRCUIT_OPEN_MS) / 1000));
    throw new AuthGatewayError(503, `Authentication gateway is temporarily unavailable. Retry in ${seconds} seconds.`);
  }

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await callSupabaseAuthAttempt(env, endpoint, method, payload, accessToken, query);
        if (response.ok) {
          await closeAuthCircuit(env, action);
          return response;
        }

        if (!isRetryableStatus(response.status)) {
          await closeAuthCircuit(env, action);
          return response;
        }

        if (attempt === maxRetries) {
          await failAuthCircuit(env, action);
          return response;
        }

        const retryDelay = AUTH_UPSTREAM_RETRY_MS[Math.max(0, attempt)] ?? 500;
        await sleep(retryDelay);
      } catch (error) {
        if (error instanceof AuthGatewayError) {
          throw error;
        }

        const isTimeout = error instanceof Error && error.name === "AbortError";
        if (isTimeout && attempt === maxRetries) {
          await failAuthCircuit(env, action);
          throw new AuthGatewayError(504, "Authentication service timed out.");
        }

        if (!isTimeout && attempt === maxRetries) {
          await failAuthCircuit(env, action);
          throw new AuthGatewayError(503, "Authentication upstream is unavailable.");
        }

        if (!isTimeout) {
          await failAuthCircuit(env, action);
          const retryDelay = AUTH_UPSTREAM_RETRY_MS[Math.max(0, attempt)] ?? 500;
          await sleep(retryDelay);
          continue;
        }

        const retryDelay = AUTH_UPSTREAM_RETRY_MS[Math.max(0, attempt)] ?? 500;
        await sleep(retryDelay);
      }
    }
    throw new AuthGatewayError(503, "Authentication upstream is unavailable.");
  } finally {
    await releaseAuthCircuitProbe(env, action);
  }
}

function extractAuthToken(payload: AuthGatewayPayload): { access_token?: string; refresh_token?: string } {
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : undefined;
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : undefined;

  if (accessToken && refreshToken) {
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  const session = payload.session;
  if (session && typeof session === "object" && session !== null) {
    const nested = session as Record<string, unknown>;
    const nestedAccessToken = typeof nested.access_token === "string" ? nested.access_token : undefined;
    const nestedRefreshToken = typeof nested.refresh_token === "string" ? nested.refresh_token : undefined;
    return {
      access_token: nestedAccessToken,
      refresh_token: nestedRefreshToken
    };
  }

  return {};
}

function withSuccessDefaults(payload: AuthGatewayPayload): AuthGatewayPayload {
  const normalized = extractAuthToken(payload);
  if (normalized.access_token && normalized.refresh_token) {
    return payload;
  }

  if (payload.session && typeof payload.session === "object" && payload.session !== null) {
    const session = payload.session as Record<string, unknown>;
    if (typeof session.access_token === "string" && !payload.access_token) {
      return { ...payload, access_token: session.access_token };
    }
    if (typeof session.refresh_token === "string" && !payload.refresh_token) {
      return { ...payload, refresh_token: session.refresh_token };
    }
  }

  return payload;
}

async function readAuthRequest(request: Request): Promise<AuthGatewayRequest> {
  try {
    return await readJsonWithLimit<AuthGatewayRequest>(request, AUTH_MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      throw new AuthGatewayError(error.status, error.message);
    }
    if (error instanceof AuthGatewayError) {
      throw error;
    }
    throw new AuthGatewayError(400, "Invalid JSON body.");
  }
}

export async function handleAuthLogin(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await readAuthRequest(request);
    const email = normalizeEmail(payload.email);
    const password = normalizeToken(payload.password);

    if (!isValidEmail(email) || !isValidPassword(password)) {
      return errorJson(request, env, 400, "Invalid login payload.");
    }

    const rateLimited = await enforceRateLimit(request, env, "login", email);
    if (rateLimited) {
      return rateLimited;
    }

    const upstream = await callSupabaseAuth(
      env,
      "token?grant_type=password",
      "POST",
      { email, password },
      undefined,
      "login"
    );
    if (!upstream.ok) {
      return errorJson(
        request,
        env,
        upstream.status >= 500 ? 502 : upstream.status,
        buildMessage(upstream.body, "Invalid credentials.")
      );
    }

    return okJson(request, env, withSuccessDefaults({ ...upstream.body, ...extractAuthToken(upstream.body) }));
  } catch (error) {
    if (error instanceof AuthGatewayError) {
      return errorJson(request, env, error.status, error.message);
    }
    if (error instanceof Error && error.name === "AbortError") {
      return errorJson(request, env, 504, "Authentication service timed out.");
    }
    return errorJson(request, env, 500, "Unable to authenticate.");
  }
}

export async function handleAuthSignup(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await readAuthRequest(request);
    const email = normalizeEmail(payload.email);
    const password = normalizeToken(payload.password);
    const redirectTo = normalizeRedirect(payload.redirect_to, env);

    if (!isValidEmail(email) || !isValidPassword(password) || (payload.redirect_to !== undefined && !redirectTo)) {
      return errorJson(request, env, 400, "Invalid signup payload.");
    }

    const rateLimited = await enforceRateLimit(request, env, "signup", email);
    if (rateLimited) {
      return rateLimited;
    }

    const body: AuthGatewayPayload = { email, password };
    const upstream = await callSupabaseAuth(
      env,
      "signup",
      "POST",
      body,
      undefined,
      "signup",
      redirectTo ? { redirect_to: redirectTo } : undefined
    );
    if (!upstream.ok) {
      return errorJson(
        request,
        env,
        upstream.status >= 500 ? 502 : upstream.status,
        buildMessage(upstream.body, "Sign up request failed.")
      );
    }

    return okJson(request, env, withSuccessDefaults(withSuccessDefaults(upstream.body)));
  } catch (error) {
    if (error instanceof AuthGatewayError) {
      return errorJson(request, env, error.status, error.message);
    }
    if (error instanceof Error && error.name === "AbortError") {
      return errorJson(request, env, 504, "Authentication service timed out.");
    }
    return errorJson(request, env, 500, "Unable to sign up.");
  }
}

export async function handleAuthPasswordReset(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await readAuthRequest(request);
    const email = normalizeEmail(payload.email);
    const redirectTo = normalizeRedirect(payload.redirect_to, env);

    if (!isValidEmail(email) || (payload.redirect_to !== undefined && !redirectTo)) {
      return errorJson(request, env, 400, "Invalid password-reset payload.");
    }

    const rateLimited = await enforceRateLimit(request, env, "password_reset", email);
    if (rateLimited) {
      return rateLimited;
    }

    const body: AuthGatewayPayload = { email };
    const upstream = await callSupabaseAuth(
      env,
      "recover",
      "POST",
      body,
      undefined,
      "password_reset",
      redirectTo ? { redirect_to: redirectTo } : undefined
    );
    if (!upstream.ok) {
      return errorJson(
        request,
        env,
        upstream.status >= 500 ? 502 : upstream.status,
        buildMessage(upstream.body, "Password reset request failed.")
      );
    }

    return okJson(request, env, { ok: true });
  } catch (error) {
    if (error instanceof AuthGatewayError) {
      return errorJson(request, env, error.status, error.message);
    }
    if (error instanceof Error && error.name === "AbortError") {
      return errorJson(request, env, 504, "Authentication service timed out.");
    }
    return errorJson(request, env, 500, "Unable to start password reset.");
  }
}

export async function handleAuthPasswordChange(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await readAuthRequest(request);
    const accessToken = normalizeToken(payload.access_token);
    const password = normalizeToken(payload.new_password ?? payload.password);

    if (!isValidToken(accessToken) || !isValidPassword(password)) {
      return errorJson(request, env, 400, "Invalid password change payload.");
    }

    const rateLimited = await enforceRateLimit(request, env, "password_change", accessToken);
    if (rateLimited) {
      return rateLimited;
    }

    const upstream = await callSupabaseAuth(
      env,
      "user",
      "PATCH",
      { password },
      accessToken,
      "password_change"
    );
    if (!upstream.ok) {
      return errorJson(
        request,
        env,
        upstream.status >= 500 ? 502 : upstream.status,
        buildMessage(upstream.body, "Password change failed.")
      );
    }

    return okJson(request, env, upstream.body as AuthGatewayPayload);
  } catch (error) {
    if (error instanceof AuthGatewayError) {
      return errorJson(request, env, error.status, error.message);
    }
    if (error instanceof Error && error.name === "AbortError") {
      return errorJson(request, env, 504, "Authentication service timed out.");
    }
    return errorJson(request, env, 500, "Unable to change password.");
  }
}

export async function handleAuthLogout(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await readAuthRequest(request);
    const accessToken = normalizeToken(payload.access_token);
    if (!isValidToken(accessToken)) {
      return errorJson(request, env, 400, "Invalid logout payload.");
    }

    const rateLimited = await enforceRateLimit(request, env, "logout", accessToken);
    if (rateLimited) {
      return rateLimited;
    }

    const upstream = await callSupabaseAuth(env, "logout", "POST", {}, accessToken, "logout");
    if (upstream.ok || upstream.status === 204) {
      return okJson(request, env, { ok: true });
    }

    return errorJson(
      request,
      env,
      upstream.status >= 500 ? 502 : upstream.status,
      buildMessage(upstream.body, "Logout failed.")
    );
  } catch (error) {
    if (error instanceof AuthGatewayError) {
      return errorJson(request, env, error.status, error.message);
    }
    if (error instanceof Error && error.name === "AbortError") {
      return errorJson(request, env, 504, "Authentication service timed out.");
    }
    return errorJson(request, env, 500, "Unable to logout.");
  }
}
