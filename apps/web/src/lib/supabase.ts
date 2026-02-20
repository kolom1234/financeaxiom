import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeHost, isLoopbackHost, isLoopbackUrl } from "./runtimeHost";

let singleton: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (singleton) {
    return singleton;
  }
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }
  const host = getRuntimeHost();
  const remoteRuntime = host.length > 0 && !isLoopbackHost(host);
  if (remoteRuntime && isLoopbackUrl(url)) {
    return null;
  }
  singleton = createClient(url, anonKey);
  return singleton;
}
