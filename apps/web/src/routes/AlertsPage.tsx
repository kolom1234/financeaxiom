import type { Session } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuditPanel } from "../components/account/AuditPanel";
import { ChangePasswordForm, LoginForm, ResetForm, SignupForm } from "../components/account/AuthForms";
import { DangerZone } from "../components/account/DangerZone";
import { PushPanel } from "../components/account/PushPanel";
import { RulesPanel, type NewRuleInput } from "../components/account/RulesPanel";
import { TokenTools } from "../components/account/TokenTools";
import {
  createRule,
  deleteAccountData,
  deleteRule,
  fetchAudit,
  listRules,
  postAudit,
  type AccountAuditEvent,
  type AlertRule
} from "../lib/accountApi";
import {
  extractAuthTokenFromGateway,
  loginViaGateway,
  logoutViaGateway,
  passwordChangeViaGateway,
  passwordResetViaGateway,
  signupViaGateway
} from "../lib/authGateway";
import { clearAuthFailures, formatLockoutSeconds, lockoutRemainingMs, normalizeEmailAddress, recordAuthFailure } from "../lib/authLockout";
import { checkPasswordStrength } from "../lib/passwordPolicy";
import { currentPushStatus, disablePush, enablePush, type PushStatus } from "../lib/pushClient";
import { getSupabaseClient } from "../lib/supabase";

type FeedbackTone = "success" | "error" | "info";
interface AuthFeedbackState {
  tone: FeedbackTone;
  message: string;
}
type BusyAction = "login" | "signup" | "reset" | "password_change" | "rules" | "push" | "delete" | null;
type AlertsView = "alerts" | "login" | "signup" | "reset";

const LOCAL_AUDIT_KEY = "ofp_account_audit_v2";
const AUDIT_LIMIT = 20;
const TOKEN_DEBUG_TOOLS_ENABLED = import.meta.env.VITE_TOKEN_DEBUG_TOOLS === "1";

/** Local-only history (no e-mail or other personal data is stored). */
function readLocalAudit(): AccountAuditEvent[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_AUDIT_KEY) ?? "[]") as AccountAuditEvent[];
    return Array.isArray(parsed) ? parsed.slice(0, AUDIT_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeLocalAudit(events: AccountAuditEvent[]): void {
  try {
    window.localStorage.setItem(LOCAL_AUDIT_KEY, JSON.stringify(events.slice(0, AUDIT_LIMIT)));
    window.localStorage.removeItem("ofp_account_audit_v1"); // legacy key stored e-mail addresses
  } catch {
    // Best effort only.
  }
}

function formatExpiry(seconds: number | null | undefined): string {
  return seconds ? new Date(seconds * 1000).toLocaleString() : "unknown";
}

function validEmail(value: string): string | null {
  const normalized = normalizeEmailAddress(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function toRule(input: NewRuleInput): Pick<AlertRule, "rule_type" | "rule" | "enabled"> {
  switch (input.rule_type) {
    case "ticker":
      return { rule_type: "ticker", rule: { ticker: input.value.toUpperCase() }, enabled: true };
    case "entity":
      return { rule_type: "entity", rule: { slug: input.value.toLowerCase() }, enabled: true };
    case "filing_form":
      return { rule_type: "filing_form", rule: input.value ? { form_type: input.value.toUpperCase() } : {}, enabled: true };
    case "macro":
      return { rule_type: "macro", rule: {}, enabled: true };
    default:
      return { rule_type: "breaking", rule: { tab: "breaking" }, enabled: true };
  }
}

export function AlertsPage({ view = "alerts" }: { view?: AlertsView }): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [token, setToken] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState("Not authenticated");
  const [feedback, setFeedbackState] = useState<AuthFeedbackState | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [auditEvents, setAuditEvents] = useState<AccountAuditEvent[]>(() => readLocalAudit());
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);

  const lockMs = lockoutRemainingMs(email);
  const lockMessage = lockMs > 0 ? `Too many failed attempts. Retry in ${formatLockoutSeconds(lockMs)}.` : "";
  const isAuthPage = view !== "alerts";
  const pageTitle =
    view === "login" ? "Login" : view === "signup" ? "Create Account" : view === "reset" ? "Forgot Password" : "Account & Alerts";

  const setFeedback = (tone: FeedbackTone, message: string): void => {
    setFeedbackState({ tone, message });
    setStatus(message);
  };

  const recordLocal = (action: string, outcome: "success" | "failure", details?: string): void => {
    const event: AccountAuditEvent = { id: crypto.randomUUID(), at: new Date().toISOString(), action, outcome, details, source: "local" };
    setAuditEvents((previous) => {
      const next = [event, ...previous].slice(0, AUDIT_LIMIT);
      writeLocalAudit(next);
      return next;
    });
  };

  const syncAudit = useCallback(async (requestToken: string): Promise<void> => {
    const result = await fetchAudit(requestToken);
    if (!result.ok) {
      return;
    }
    setAuditEvents((previous) => {
      const merged = [...result.data.events, ...previous.filter((item) => item.source === "local")]
        .sort((left, right) => right.at.localeCompare(left.at))
        .slice(0, AUDIT_LIMIT);
      writeLocalAudit(merged.filter((item) => item.source === "local"));
      return merged;
    });
  }, []);

  /** Non-auth actions are reported to the server (labelled "client" there); auth events are recorded server-side by the gateway. */
  const reportClientAction = async (action: string, outcome: "success" | "failure", details: string, requestToken: string): Promise<void> => {
    recordLocal(action, outcome, details);
    await postAudit(requestToken, { action, outcome, details });
  };

  const ensureNotLocked = (value: string): boolean => {
    const remaining = lockoutRemainingMs(value);
    if (remaining > 0) {
      setFeedback("error", `Action blocked: too many failed attempts. Try again in ${formatLockoutSeconds(remaining)}.`);
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      return;
    }
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setStatus(`Session check failed: ${error.message}`);
        return;
      }
      setSession(data.session);
      if (data.session) {
        setToken(data.session.access_token ?? "");
        setStatus("Authenticated");
        void syncAudit(data.session.access_token);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.access_token) {
        setToken(nextSession.access_token);
        void syncAudit(nextSession.access_token);
      }
      setStatus(nextSession ? "Authenticated" : "Signed out");
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, syncAudit]);

  useEffect(() => {
    if (isAuthPage && session) {
      navigate("/alerts", { replace: true });
    }
  }, [isAuthPage, navigate, session]);

  useEffect(() => {
    if (view === "alerts" && session) {
      void currentPushStatus().then(setPushStatus);
    }
  }, [view, session]);

  useEffect(() => {
    const state = location.state as { flash?: AuthFeedbackState } | null;
    if (state?.flash?.message) {
      setFeedback(state.flash.tone, state.flash.message);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  const requireToken = async (): Promise<string | null> => {
    if (token) {
      return token;
    }
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    if (!data.session?.access_token) {
      setStatus("No authenticated session. Please sign in.");
      return null;
    }
    setToken(data.session.access_token);
    return data.session.access_token;
  };

  const goToAlerts = (message: string): void => {
    if (isAuthPage) {
      navigate("/alerts", { state: { flash: { tone: "success", message } as AuthFeedbackState } });
    }
  };

  const login = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFeedbackState(null);
    const normalized = validEmail(email);
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      return;
    }
    if (!normalized) {
      setFeedback("error", "Login failed: enter a valid email.");
      return;
    }
    if (!ensureNotLocked(normalized)) {
      return;
    }
    setBusy("login");
    const result = await loginViaGateway(supabase, normalized, password, async () => {
      const direct = await supabase.auth.signInWithPassword({ email: normalized, password });
      return { data: direct.data ? (direct.data as Record<string, unknown>) : null, error: direct.error ? { message: direct.error.message } : undefined };
    });
    if (result.ok) {
      const { accessToken } = result.data ? extractAuthTokenFromGateway(result.data) : {};
      if (accessToken) {
        setToken(accessToken);
        await syncAudit(accessToken);
      }
      clearAuthFailures(normalized);
      recordLocal("login", "success", "Authenticated successfully.");
      setFeedback("success", "Login successful.");
      goToAlerts("Logged in successfully. You can now manage your alerts.");
    } else {
      const failures = recordAuthFailure(normalized);
      recordLocal("login", "failure", `login_failure_${failures}`);
      setFeedback("error", `Login failed: ${result.message ?? "unknown error"}`);
    }
    setBusy(null);
  };

  const signup = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFeedbackState(null);
    const normalized = validEmail(email);
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      return;
    }
    if (!normalized) {
      setFeedback("error", "Sign up failed: enter a valid email.");
      return;
    }
    if (!ensureNotLocked(normalized)) {
      return;
    }
    const strength = checkPasswordStrength(password);
    if (!strength.ok) {
      setFeedback("error", `Sign up failed: ${strength.reason}`);
      return;
    }
    if (password !== passwordConfirm) {
      setFeedback("error", "Sign up failed: Passwords do not match.");
      return;
    }
    setBusy("signup");
    const redirectTo = `${window.location.origin}/alerts`;
    const result = await signupViaGateway(supabase, normalized, password, redirectTo, async () => {
      const direct = await supabase.auth.signUp({ email: normalized, password, options: { emailRedirectTo: redirectTo } });
      return { data: direct.data ? (direct.data as Record<string, unknown>) : null, error: direct.error ? { message: direct.error.message } : undefined };
    });
    if (!result.ok) {
      recordAuthFailure(normalized);
      setFeedback("error", `Sign up failed: ${result.message ?? "unknown error"}`);
      setBusy(null);
      return;
    }
    clearAuthFailures(normalized);
    const tokens = result.data ? extractAuthTokenFromGateway(result.data) : {};
    if (tokens.accessToken) {
      setToken(tokens.accessToken);
      await syncAudit(tokens.accessToken);
      setFeedback("success", "Account created and logged in.");
      goToAlerts("Account created successfully. You are now logged in.");
    } else {
      setFeedback("success", "Verification email sent. Open your inbox and click the link to finish sign up.");
    }
    setBusy(null);
  };

  const sendPasswordReset = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFeedbackState(null);
    const normalized = validEmail(email);
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      return;
    }
    if (!normalized) {
      setFeedback("error", "Password reset request failed: enter a valid email.");
      return;
    }
    if (!ensureNotLocked(normalized)) {
      return;
    }
    setBusy("reset");
    const redirectTo = `${window.location.origin}/alerts`;
    const result = await passwordResetViaGateway(normalized, redirectTo, async () => {
      const direct = await supabase.auth.resetPasswordForEmail(normalized, { redirectTo });
      return { data: direct.data ? (direct.data as Record<string, unknown>) : null, error: direct.error ? { message: direct.error.message } : undefined };
    });
    if (result.ok) {
      clearAuthFailures(normalized);
      setFeedback("success", "Password reset email sent. Check your inbox.");
    } else {
      recordAuthFailure(normalized);
      setFeedback("error", `Password reset request failed: ${result.message ?? "unknown error"}`);
    }
    setBusy(null);
  };

  const updatePassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFeedbackState(null);
    if (!supabase || !session) {
      setFeedback("error", "Please sign in before changing your password.");
      return;
    }
    const strength = checkPasswordStrength(newPassword);
    if (!strength.ok) {
      setFeedback("error", `Password update failed: ${strength.reason}`);
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setFeedback("error", "Password update failed: Passwords do not match.");
      return;
    }
    setBusy("password_change");
    const result = await passwordChangeViaGateway(session.access_token, newPassword, async () => {
      const direct = await supabase.auth.updateUser({ password: newPassword });
      return { data: direct.data ? (direct.data as Record<string, unknown>) : null, error: direct.error ? { message: direct.error.message } : undefined };
    });
    if (result.ok) {
      setNewPassword("");
      setNewPasswordConfirm("");
      recordLocal("password_change", "success", "Password changed.");
      setFeedback("success", "Password updated.");
    } else {
      setFeedback("error", `Password update failed: ${result.message ?? "unknown error"}`);
    }
    setBusy(null);
  };

  const logout = async (): Promise<void> => {
    setFeedbackState(null);
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      return;
    }
    const result = await logoutViaGateway(supabase, token, async () => {
      const direct = await supabase.auth.signOut();
      return { data: null, error: direct.error ? { message: direct.error.message } : undefined };
    });
    if (!result.ok) {
      setFeedback("error", `Logout failed: ${result.message ?? "unknown error"}`);
      return;
    }
    setSession(null);
    setToken("");
    setRules([]);
    recordLocal("logout", "success", "Signed out.");
    setFeedback("info", "Signed out successfully.");
  };

  const loadRules = async (): Promise<void> => {
    const requestToken = await requireToken();
    if (!requestToken) {
      return;
    }
    setBusy("rules");
    const result = await listRules(requestToken);
    if (result.ok) {
      setRules(result.data.rules);
      setStatus("Rules loaded");
    } else {
      setStatus(`Failed to load rules: ${result.message}`);
    }
    setBusy(null);
  };

  const addRule = async (input: NewRuleInput): Promise<void> => {
    const requestToken = await requireToken();
    if (!requestToken) {
      return;
    }
    setBusy("rules");
    const result = await createRule(requestToken, toRule(input));
    setBusy(null);
    if (!result.ok) {
      setFeedback("error", `Create rule failed: ${result.message}`);
      return;
    }
    await reportClientAction("rule_add", "success", `Rule created (${input.rule_type}).`, requestToken);
    await loadRules();
  };

  const removeRule = async (ruleId: string): Promise<void> => {
    const requestToken = await requireToken();
    if (!requestToken) {
      return;
    }
    setBusy("rules");
    const result = await deleteRule(requestToken, ruleId);
    setBusy(null);
    if (!result.ok) {
      setFeedback("error", `Delete rule failed: ${result.message}`);
      return;
    }
    await reportClientAction("rule_delete", "success", "Rule deleted.", requestToken);
    setRules((previous) => previous.filter((rule) => rule.rule_id !== ruleId));
  };

  const togglePush = async (enable: boolean): Promise<void> => {
    const requestToken = await requireToken();
    if (!requestToken) {
      return;
    }
    setBusy("push");
    const result = enable ? await enablePush(requestToken) : await disablePush(requestToken);
    setPushStatus(result.status);
    setFeedback(result.status === "subscribed" || !enable ? "success" : "error", result.message);
    if (enable && result.status === "subscribed") {
      await reportClientAction("push_subscribe", "success", "Push notifications enabled.", requestToken);
    }
    setBusy(null);
  };

  const deleteMyData = async (): Promise<void> => {
    const requestToken = await requireToken();
    if (!requestToken || !window.confirm("Permanently delete all your alert rules, subscriptions and activity? This cannot be undone.")) {
      return;
    }
    setBusy("delete");
    await disablePush(requestToken).catch(() => undefined);
    const result = await deleteAccountData(requestToken);
    setBusy(null);
    if (!result.ok) {
      setFeedback("error", `Deletion failed: ${result.message}`);
      return;
    }
    setRules([]);
    setAuditEvents([]);
    writeLocalAudit([]);
    setFeedback(
      "success",
      result.data.auth_account_deleted ? "Your data and login account were deleted." : `Your data was deleted. ${result.data.note ?? ""}`.trim()
    );
    if (result.data.auth_account_deleted) {
      await supabase?.auth.signOut().catch(() => undefined);
      setSession(null);
    }
  };

  const credentials = {
    email,
    password,
    lockMessage,
    onEmailChange: setEmail,
    onPasswordChange: setPassword,
    onNavigate: (path: string) => navigate(path)
  };

  return (
    <section className="page-wrap">
      <header className="glass-panel page-header">
        <h1>{pageTitle}</h1>
        <p className="muted-copy">{status}</p>
      </header>

      {feedback ? (
        <section className={`glass-panel card-stack auth-feedback auth-feedback-${feedback.tone}`} role="status" aria-live="polite">
          <p>{feedback.message}</p>
        </section>
      ) : null}

      {view === "alerts" && !session ? (
        <section className="glass-panel card-stack auth-form">
          <h2>Sign in required</h2>
          <p className="muted-copy">Login first to manage alerts, account activity, and password settings.</p>
          <div className="row-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate("/login")}>
              Go to Login
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/signup")}>
              Create Account
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/forgot-password")}>
              Forgot Password
            </button>
          </div>
        </section>
      ) : null}

      {view === "login" ? <LoginForm {...credentials} busy={busy === "login"} onSubmit={login} /> : null}
      {view === "signup" ? (
        <SignupForm
          {...credentials}
          busy={busy === "signup"}
          passwordConfirm={passwordConfirm}
          onPasswordConfirmChange={setPasswordConfirm}
          onSubmit={signup}
        />
      ) : null}
      {view === "reset" ? (
        <ResetForm email={email} busy={busy === "reset"} onEmailChange={setEmail} onNavigate={credentials.onNavigate} onSubmit={sendPasswordReset} />
      ) : null}

      {view === "alerts" && session ? (
        <>
          <section className="glass-panel card-stack">
            <h2>Account</h2>
            <p className="muted-copy">Signed in as {session.user.email ?? "a verified user"}</p>
            <p className="muted-copy">Session expires: {formatExpiry(session.expires_at)}</p>
            <div className="row-actions">
              <button type="button" className="btn btn-ghost" onClick={logout}>
                Logout
              </button>
            </div>
          </section>
          <ChangePasswordForm
            newPassword={newPassword}
            newPasswordConfirm={newPasswordConfirm}
            busy={busy === "password_change"}
            onNewPasswordChange={setNewPassword}
            onNewPasswordConfirmChange={setNewPasswordConfirm}
            onSubmit={updatePassword}
          />
          <RulesPanel
            rules={rules}
            busy={busy === "rules"}
            onLoad={() => void loadRules()}
            onAddBreaking={() => void addRule({ rule_type: "breaking", value: "" })}
            onAdd={(input) => void addRule(input)}
            onDelete={(ruleId) => void removeRule(ruleId)}
          />
          <PushPanel status={pushStatus} busy={busy === "push"} onEnable={() => void togglePush(true)} onDisable={() => void togglePush(false)} />
          {TOKEN_DEBUG_TOOLS_ENABLED ? (
            <TokenTools
              token={token}
              onTokenChange={setToken}
              onCopy={() => {
                void navigator.clipboard?.writeText(session.access_token);
                setStatus("Session token copied.");
                recordLocal("token_copy", "success", "Session token copied.");
              }}
            />
          ) : null}
          <AuditPanel
            events={auditEvents}
            onRefresh={() => {
              void requireToken().then((requestToken) => (requestToken ? syncAudit(requestToken) : undefined));
            }}
          />
          <DangerZone busy={busy === "delete"} onDelete={() => void deleteMyData()} />
        </>
      ) : null}
    </section>
  );
}
