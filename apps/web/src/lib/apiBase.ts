import { getRuntimeHost, isLoopbackHost, isLoopbackUrl } from "./runtimeHost";

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveApiBase(): string {
  const host = getRuntimeHost();
  const remoteRuntime = host.length > 0 && !isLoopbackHost(host);
  const fromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL?.trim() ?? "");

  if (fromEnv) {
    const envIsLoopback = isLoopbackUrl(fromEnv);
    if (!envIsLoopback || !remoteRuntime) {
      return fromEnv;
    }
  }

  if (remoteRuntime) {
    return "https://api.financeaxiom.com";
  }

  return "";
}

export const API_BASE = resolveApiBase();
