import { API_BASE } from "./apiBase";

export interface AlertRule {
  rule_id: string;
  rule_type: "breaking" | "entity" | "ticker" | "macro" | "filing_form";
  enabled: boolean;
  rule: Record<string, unknown>;
}

export interface AccountAuditEvent {
  id: string;
  at: string;
  action: string;
  outcome: "success" | "failure";
  details?: string;
  /** server: recorded by the API itself; client: reported by a browser; local: this browser only. */
  source: "server" | "client" | "local";
}

export type ApiCallResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** Authenticated JSON call to the worker API. */
export async function apiCall<T>(token: string, path: string, init: RequestInit = {}): Promise<ApiCallResult<T>> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`
      }
    });
    const payload = (await response.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
    if (response.ok && payload && "data" in payload) {
      return { ok: true, data: payload.data as T };
    }
    return { ok: false, status: response.status, message: payload?.error?.message ?? `Request failed with ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : "Network error" };
  }
}

export const listRules = (token: string) => apiCall<{ rules: AlertRule[]; max_rules?: number }>(token, "/api/alerts/rules");

export const createRule = (token: string, rule: Pick<AlertRule, "rule_type" | "rule" | "enabled">) =>
  apiCall<{ rule: AlertRule }>(token, "/api/alerts/rules", { method: "POST", body: JSON.stringify(rule) });

export const deleteRule = (token: string, ruleId: string) =>
  apiCall<{ deleted: boolean }>(token, `/api/alerts/rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" });

export const fetchAudit = (token: string) => apiCall<{ events: AccountAuditEvent[] }>(token, "/api/account/audit");

/** Browser-reported event (stored server-side with source "client"). */
export const postAudit = (token: string, event: { action: string; outcome: "success" | "failure"; details?: string }) =>
  apiCall<{ events: AccountAuditEvent[] }>(token, "/api/account/audit", { method: "POST", body: JSON.stringify(event) });

export const deleteAccountData = (token: string) =>
  apiCall<{ deleted: Record<string, number>; auth_account_deleted: boolean; note?: string }>(token, "/api/account/delete", {
    method: "POST",
    body: JSON.stringify({ confirm: "DELETE" })
  });
