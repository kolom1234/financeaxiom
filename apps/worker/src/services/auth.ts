import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import type { Env } from "../types";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const DEFAULT_JWT_AUDIENCE = "authenticated";
const DEFAULT_JWT_MAX_AGE_SECONDS = 60 * 60;

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

function isLocalRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    return isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function parseBearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new AuthError("Missing bearer token.");
  }

  const [scheme, token] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new AuthError("Missing bearer token.");
  }
  return token;
}

function normalizeSupabaseOrigin(supabaseUrl: string): string {
  const trimmed = supabaseUrl.trim();
  if (!trimmed) {
    return "https://localhost";
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function buildDefaultIssuer(supabaseUrl: string): string {
  return `${normalizeSupabaseOrigin(supabaseUrl)}/auth/v1`;
}

async function verifyWithSupabase(token: string, env: Env): Promise<JWTPayload> {
  if (!env.SUPABASE_URL) {
    throw new AuthError("SUPABASE_URL is not configured.");
  }

  const jwksUrl = env.SUPABASE_JWKS_URL ?? `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, jwks);
  }

  const audience =
    env.SUPABASE_JWT_AUDIENCE?.trim() ||
    DEFAULT_JWT_AUDIENCE;
  const issuer = env.SUPABASE_JWT_ISSUER?.trim() || buildDefaultIssuer(env.SUPABASE_URL);
  const configuredMaxAge = Number.parseInt(String(env.SUPABASE_JWT_MAX_AGE_SECONDS ?? ""), 10);
  const maxAgeSeconds = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0 ? configuredMaxAge : DEFAULT_JWT_MAX_AGE_SECONDS;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
      maxTokenAge: `${maxAgeSeconds}s`,
      clockTolerance: "5s"
    });
    if (!payload.sub || typeof payload.sub !== "string") {
      throw new AuthError("Token does not contain a valid subject.");
    }
    return payload;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    console.error("jwt_verify_failed", error);
    throw new AuthError("Invalid or expired access token.");
  }
}

export async function requireUserId(request: Request, env: Env): Promise<string> {
  const token = parseBearer(request);

  if (env.TEST_AUTH_BYPASS === "1" && token.startsWith("test-user:")) {
    if (!isLocalRequest(request)) {
      throw new AuthError("Test auth bypass is only allowed for local development requests.");
    }
    const userId = token.replace("test-user:", "").trim();
    if (!userId) {
      throw new AuthError("Invalid test user token.");
    }
    return userId;
  }

  const payload = await verifyWithSupabase(token, env);
  return payload.sub as string;
}
