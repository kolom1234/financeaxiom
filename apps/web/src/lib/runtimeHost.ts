function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
}

export function isLoopbackUrl(value: string): boolean {
  const parsed = tryParseUrl(value);
  if (!parsed) {
    return false;
  }
  return isLoopbackHost(parsed.hostname);
}

export function getRuntimeHost(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.hostname.toLowerCase();
}

