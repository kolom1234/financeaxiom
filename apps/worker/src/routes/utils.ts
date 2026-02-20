import { envelope } from "@ofp/shared";
import type { Env } from "../types";

const DEFAULT_JSON_BODY_MAX_BYTES = 16 * 1024;

export class RequestBodyError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
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
    return trimmed.toLowerCase();
  }
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

function allowedOrigin(request: Request, env: Env): string {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) {
    return "null";
  }

  if (!env.ALLOWED_ORIGINS?.trim()) {
    return "null";
  }

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  if (!normalizedRequestOrigin) {
    return "null";
  }

  const allowed = env.ALLOWED_ORIGINS.split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter((value): value is string => Boolean(value));

  return allowed.includes(normalizedRequestOrigin) ? normalizedRequestOrigin : "null";
}

function parseContentLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (!header) {
    return null;
  }
  const parsed = Number.parseInt(header, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = parseContentLength(request);
  if (declaredLength !== null && declaredLength > maxBytes) {
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

export function clientIp(request: Request): string {
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
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    vary: "Origin"
  });
  if (origin !== "*" && origin !== "null") {
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
