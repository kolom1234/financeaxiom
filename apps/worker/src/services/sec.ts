import type { Env } from "../types";

export function assertSecUserAgentConfigured(env: Env): void {
  const ua = env.SEC_USER_AGENT?.trim();
  if (!ua) {
    throw new Error("SEC_USER_AGENT is required.");
  }
  const hasContact = ua.includes("@");
  const hasCompany = ua.split(" ").length >= 2;
  if (!hasContact || !hasCompany) {
    throw new Error("SEC_USER_AGENT must include company name and contact email.");
  }
}

export async function acquireSecPermit(env: Env): Promise<void> {
  if (!env.SEC_LIMITER_DO) {
    throw new Error("SEC limiter binding is required.");
  }
  const id = env.SEC_LIMITER_DO.idFromName("global-sec-rps");
  const stub = env.SEC_LIMITER_DO.get(id);
  const response = await stub.fetch("https://internal/acquire");
  if (!response.ok) {
    throw new Error("SEC limiter denied request.");
  }
}
