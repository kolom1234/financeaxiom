import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { API_BASE } from "./apiBase";

type AuthGatewayData = Record<string, unknown>;

interface GatewayErrorEnvelope {
  ok: false;
  error?: {
    message?: string;
  };
}

interface GatewaySuccessEnvelope {
  ok: true;
  data?: AuthGatewayData;
  meta?: Record<string, unknown>;
}

type GatewayEnvelope = GatewaySuccessEnvelope | GatewayErrorEnvelope;

interface AuthGatewayResult {
  ok: boolean;
  status: number;
  data: AuthGatewayData | null;
  message: string | null;
  networkError: boolean;
}

interface DirectResponse {
  data?: Record<string, unknown> | null;
  error?: {
    message?: string;
  };
}

interface DirectSessionResponse {
  data?: (Record<string, unknown> & {
    session?: Session | null;
    user?: unknown;
  }) | null;
  error?: {
    message?: string;
  };
}

const AUTH_GATEWAY_TIMEOUT_MS = 5000;
const AUTH_DIRECT_FALLBACK_ENABLED = import.meta.env.VITE_AUTH_DIRECT_FALLBACK === "1";

function readGatewayMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const errorObj = payload as GatewayErrorEnvelope;
  const message = errorObj?.error?.message;

  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  const directMessage = (payload as GatewaySuccessEnvelope & { message?: string }).message;
  if (typeof directMessage === "string" && directMessage.trim().length > 0) {
    return directMessage;
  }

  return null;
}

function extractToken(payload: unknown): { accessToken?: string; refreshToken?: string } {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const direct = payload as AuthGatewayData;

  const session = direct.session;
  if (session && typeof session === "object") {
    const sessionObj = session as AuthGatewayData;
    const topLevelAccess =
      typeof direct.access_token === "string" && direct.access_token.length > 0 ? direct.access_token : undefined;
    const topLevelRefresh =
      typeof direct.refresh_token === "string" && direct.refresh_token.length > 0 ? direct.refresh_token : undefined;

    return {
      accessToken: typeof sessionObj.access_token === "string" ? sessionObj.access_token : topLevelAccess,
      refreshToken: typeof sessionObj.refresh_token === "string" ? sessionObj.refresh_token : topLevelRefresh
    };
  }

  return {
    accessToken: typeof direct.access_token === "string" ? direct.access_token : undefined,
    refreshToken: typeof direct.refresh_token === "string" ? direct.refresh_token : undefined
  };
}

export function extractAuthTokenFromGateway(payload: unknown): { accessToken?: string; refreshToken?: string } {
  return extractToken(payload);
}

function mapDirectSessionPayload(direct: DirectSessionResponse["data"]): AuthGatewayData | null {
  if (!direct?.session) {
    return null;
  }

  const directSession = direct.session;
  return {
    access_token: directSession.access_token,
    refresh_token: directSession.refresh_token,
    ...(direct.user ? { user: direct.user } : {}),
    ...direct
  };
}

async function callAuthGateway(endpoint: string, body: AuthGatewayData): Promise<AuthGatewayResult> {
  if (!API_BASE) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: "gateway_not_configured",
      networkError: true
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, AUTH_GATEWAY_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}/api/${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => ({}))) as GatewayEnvelope;
    return {
      ok: response.ok && payload.ok === true,
      status: response.status,
      data: (payload as GatewaySuccessEnvelope).data ?? null,
      message: readGatewayMessage(payload),
      networkError: false
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        data: null,
        message: "Authentication gateway timed out.",
        networkError: true
      };
    }

    return {
      ok: false,
      status: 0,
      data: null,
      message: "Gateway request failed.",
      networkError: true
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function applyGatewaySession(
  supabase: SupabaseClient | null,
  payload: unknown
): Promise<{ ok: boolean; session: Session | null; message: string }> {
  if (!supabase) {
    return { ok: false, session: null, message: "Supabase client is not configured." };
  }

  const { accessToken, refreshToken } = extractToken(payload);
  if (!accessToken || !refreshToken) {
    return {
      ok: false,
      session: null,
      message: "Authentication response did not include session tokens."
    };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  if (error) {
    return { ok: false, session: null, message: error.message };
  }

  return { ok: true, session: data.session, message: "" };
}

export async function loginViaGateway(
  supabase: SupabaseClient | null,
  email: string,
  password: string,
  directLogin: () => Promise<DirectResponse>
): Promise<AuthGatewayResult> {
  const gatewayResult = await callAuthGateway("auth/login", { email, password });
  if (gatewayResult.ok && gatewayResult.status >= 200 && gatewayResult.status < 300 && gatewayResult.data) {
    const applied = await applyGatewaySession(supabase, gatewayResult.data);
    if (applied.ok) {
      return gatewayResult;
    }

    gatewayResult.ok = false;
    gatewayResult.status = 502;
    gatewayResult.message = applied.message;
    gatewayResult.networkError = false;
    return gatewayResult;
  }

  if (!gatewayResult.networkError && !gatewayResult.ok && gatewayResult.status < 500) {
    return gatewayResult;
  }

  if (!AUTH_DIRECT_FALLBACK_ENABLED) {
    return gatewayResult;
  }

  const direct = await directLogin();
  return {
    ok: !direct.error,
    status: direct.error ? 500 : 200,
    data: direct.data ? mapDirectSessionPayload(direct.data as DirectSessionResponse["data"]) : null,
    message: direct.error?.message ?? null,
    networkError: false
  };
}

export async function signupViaGateway(
  supabase: SupabaseClient | null,
  email: string,
  password: string,
  redirectTo: string | undefined,
  directSignup: () => Promise<DirectResponse>
): Promise<AuthGatewayResult> {
  const gatewayResult = await callAuthGateway("auth/signup", {
    email,
    password,
    ...(redirectTo ? { redirect_to: redirectTo } : {})
  });
  if (gatewayResult.ok && gatewayResult.status >= 200 && gatewayResult.status < 300 && gatewayResult.data) {
    const tokens = extractToken(gatewayResult.data);
    if (tokens.accessToken && tokens.refreshToken) {
      const applied = await applyGatewaySession(supabase, gatewayResult.data);
      if (applied.ok) {
        return gatewayResult;
      }

      gatewayResult.ok = false;
      gatewayResult.status = 502;
      gatewayResult.message = applied.message;
      gatewayResult.networkError = false;
      return gatewayResult;
    }
  }

  if (!gatewayResult.networkError && !gatewayResult.ok && gatewayResult.status < 500) {
    return gatewayResult;
  }

  if (!AUTH_DIRECT_FALLBACK_ENABLED) {
    return gatewayResult;
  }

  const direct = await directSignup();
  return {
    ok: !direct.error,
    status: direct.error ? 500 : 200,
    data: direct.data ? mapDirectSessionPayload(direct.data as DirectSessionResponse["data"]) : null,
    message: direct.error?.message ?? null,
    networkError: false
  };
}

export async function passwordResetViaGateway(
  email: string,
  redirectTo: string,
  directReset: () => Promise<DirectResponse>
): Promise<AuthGatewayResult> {
  const gatewayResult = await callAuthGateway("auth/password-reset", { email, redirect_to: redirectTo });
  if (gatewayResult.ok && !gatewayResult.networkError) {
    return gatewayResult;
  }

  if (!gatewayResult.networkError && !gatewayResult.ok && gatewayResult.status < 500) {
    return gatewayResult;
  }

  if (!AUTH_DIRECT_FALLBACK_ENABLED) {
    return gatewayResult;
  }

  const direct = await directReset();
  return {
    ok: !direct.error,
    status: direct.error ? 500 : 200,
    data: direct.data ?? null,
    message: direct.error?.message ?? null,
    networkError: false
  };
}

export async function passwordChangeViaGateway(
  accessToken: string,
  password: string,
  directChange: () => Promise<DirectResponse>
): Promise<AuthGatewayResult> {
  const gatewayResult = await callAuthGateway("auth/password-change", {
    access_token: accessToken,
    new_password: password
  });
  if (gatewayResult.ok) {
    return gatewayResult;
  }

  if (!gatewayResult.networkError && !gatewayResult.ok && gatewayResult.status < 500) {
    return gatewayResult;
  }

  if (!AUTH_DIRECT_FALLBACK_ENABLED) {
    return gatewayResult;
  }

  const direct = await directChange();
  return {
    ok: !direct.error,
    status: direct.error ? 500 : 200,
    data: direct.data ?? null,
    message: direct.error?.message ?? null,
    networkError: false
  };
}

export async function logoutViaGateway(
  supabase: SupabaseClient | null,
  accessToken: string,
  directSignOut: () => Promise<DirectResponse>
): Promise<AuthGatewayResult> {
  const gatewayResult = await callAuthGateway("auth/logout", { access_token: accessToken });
  if (gatewayResult.ok) {
    await supabase?.auth.signOut();
    return gatewayResult;
  }

  if (!gatewayResult.networkError && !gatewayResult.ok && gatewayResult.status < 500) {
    return gatewayResult;
  }

  if (!AUTH_DIRECT_FALLBACK_ENABLED) {
    return gatewayResult;
  }

  const direct = await directSignOut();
  return {
    ok: !direct.error,
    status: direct.error ? 500 : 200,
    data: direct.data ? (direct.data as AuthGatewayData) : null,
    message: direct.error?.message ?? null,
    networkError: false
  };
}
