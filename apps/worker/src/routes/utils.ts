import { envelope } from "@ofp/shared";
import type { z } from "zod";
import type { Env } from "../types";

const DEFAULT_JSON_BODY_MAX_BYTES = 16 * 1024;

/** An error that maps directly to an HTTP response (message is safe to show). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RequestBodyError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "RequestBodyError";
  }
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
    return null;
  }
}

/** Parses a comma-separated origin allowlist into normalised origins. */
export function parseOriginList(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter((value): value is string => Boolean(value));
}

/** Normalised origin of an absolute URL, or null. */
export function originOf(value: string): string | null {
  return normalizeOrigin(value);
}

function applySecurityHeaders(headers: Headers): void {
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "geolocation=(), microphone=(), camera=()");
  headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  headers.set("cache-control", "no-store");
}

/** The request origin if it is allowlisted, otherwise null (no ACAO header is sent). */
function allowedOrigin(request: Request, env: Env): string | null {
  const requestOrigin = normalizeOrigin(request.headers.get("origin"));
  if (!requestOrigin) {
    return null;
  }
  return parseOriginList(env.ALLOWED_ORIGINS).includes(requestOrigin) ? requestOrigin : null;
}

export function clientIp(request: Request): string {
  // On Cloudflare, cf-connecting-ip is set by the edge and cannot be spoofed by
  // the client. Proxy headers are only trusted for local development.
  const candidate =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");

  if (!candidate) {
    return "unknown";
  }

  const first = candidate.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

export function corsHeaders(request: Request, env: Env): Headers {
  const origin = allowedOrigin(request, env);
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    vary: "Origin"
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  }
  applySecurityHeaders(headers);
  return headers;
}

export function okJson<T>(
  request: Request,
  env: Env,
  data: T,
  meta?: Partial<ReturnType<typeof envelope<T>>["meta"]>,
  status = 200
): Response {
  return new Response(JSON.stringify(envelope(data, meta)), {
    status,
    headers: corsHeaders(request, env)
  });
}

export function errorJson(
  request: Request,
  env: Env,
  status: number,
  message: string,
  extraHeaders?: Record<string, string>
): Response {
  const headers = corsHeaders(request, env);
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers.set(key, value);
    }
  }
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        message
      }
    }),
    {
      status,
      headers
    }
  );
}

export function formatRetryAfterSeconds(milliseconds: number): string {
  return String(Math.max(1, Math.ceil(milliseconds / 1000)));
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestBodyError(413, `Request payload is too large. Limit is ${maxBytes} bytes.`);
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new RequestBodyError(413, `Request payload is too large. Limit is ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function readJson<T>(request: Request): Promise<T> {
  return readJsonWithLimit(request, DEFAULT_JSON_BODY_MAX_BYTES);
}

export async function readJsonWithLimit<T>(request: Request, maxBytes: number): Promise<T> {
  const bodyText = await readTextWithLimit(request, maxBytes);
  if (!bodyText.trim()) {
    throw new RequestBodyError(400, "Request body is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new RequestBodyError(400, "Invalid JSON body.");
  }

  const isObject =
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.getPrototypeOf(parsed) === Object.prototype;
  if (!isObject) {
    throw new RequestBodyError(400, "Request body must be a JSON object.");
  }

  return parsed as T;
}

function describeIssues(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) {
    return "Invalid request.";
  }
  const path = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
  return `${path}${first.message}`;
}

/** Validates a size-limited JSON body against a zod schema; 400/413 on failure. */
export async function readValidatedBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  maxBytes: number
): Promise<z.infer<S>> {
  const raw = await readJsonWithLimit<unknown>(request, maxBytes);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(400, `Invalid request body. ${describeIssues(result.error)}`);
  }
  return result.data;
}

/** Validates URL query parameters against a zod object schema; 400 on failure. */
export function parseQuery<S extends z.ZodTypeAny>(url: URL, schema: S): z.infer<S> {
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    raw[key] = value;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(400, `Invalid query. ${describeIssues(result.error)}`);
  }
  return result.data;
}
