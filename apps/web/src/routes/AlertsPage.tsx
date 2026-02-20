import type { Session } from "@supabase/supabase-js";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { API_BASE } from "../lib/apiBase";
import { extractAuthTokenFromGateway } from "../lib/authGateway";
import {
  loginViaGateway,
  logoutViaGateway,
  passwordChangeViaGateway,
  passwordResetViaGateway,
  signupViaGateway
} from "../lib/authGateway";
import { getSupabaseClient } from "../lib/supabase";

interface AlertRule {
  rule_id: string;
  rule_type: string;
  enabled: boolean;
  rule: Record<string, unknown>;
}

interface PasswordCheckResult {
  ok: boolean;
  score: number;
  reason: string;
}

type FeedbackTone = "success" | "error" | "info";

interface AuthFeedbackState {
  tone: FeedbackTone;
  message: string;
}

type AuthBusyAction = "login" | "signup" | "reset" | "password_change" | null;

type AlertsView = "alerts" | "login" | "signup" | "reset";

interface AlertsPageProps {
  view?: AlertsView;
}

type AuditAction =
  | "signup"
  | "login"
  | "logout"
  | "password_reset_request"
  | "password_change"
  | "rules_load"
  | "rule_add"
  | "token_copy"
  | "token_view";

type AuditOutcome = "success" | "failure";

interface AuthFailureState {
  failures: number;
  lockedUntil: number | null;
  lastFailureAt?: number;
}

interface AccountAuditEvent {
  id: string;
  at: string;
  action: AuditAction;
  outcome: AuditOutcome;
  details?: string;
  email?: string;
  source: "local" | "server";
}

const AUTH_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
const MAX_AUTH_FAILURES = 5;
const AUTH_FAILURE_STORE_KEY = "ofp_auth_failures_v1";
const ACCOUNT_AUDIT_STORE_KEY = "ofp_account_audit_v1";
const AUDIT_LIMIT = 20;
const TOKEN_DEBUG_TOOLS_ENABLED = import.meta.env.VITE_TOKEN_DEBUG_TOOLS === "1";

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function getFailureStore(): Record<string, AuthFailureState> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(AUTH_FAILURE_STORE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, AuthFailureState>;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // Ignore corrupted state and recreate.
  }
  return {};
}

function saveFailureStore(store: Record<string, AuthFailureState>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(AUTH_FAILURE_STORE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort storage; keep UX working even when blocked.
  }
}

function getFailureState(email: string): AuthFailureState {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) {
    return { failures: 0, lockedUntil: null };
  }
  const current = getFailureStore()[normalized];
  if (!current) {
    return { failures: 0, lockedUntil: null };
  }

  if (current.lockedUntil && current.lockedUntil <= Date.now()) {
    return { failures: 0, lockedUntil: null };
  }

  const lastFailureAt = current.lastFailureAt;
  if (lastFailureAt && Date.now() - lastFailureAt > AUTH_LOCKOUT_WINDOW_MS) {
    return { failures: 0, lockedUntil: null };
  }

  return current;
}

function setFailureState(email: string, state: AuthFailureState): void {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) {
    return;
  }
  const store = getFailureStore();
  const now = Date.now();

  if (state.lockedUntil && state.lockedUntil <= now) {
    state.lockedUntil = null;
    state.failures = 0;
  }

  if (state.failures <= 0) {
    delete store[normalized];
  } else {
    store[normalized] = state;
  }
  saveFailureStore(store);
}

function getAuthLockoutRemainingMs(email: string): number {
  const state = getFailureState(email);
  if (!state.lockedUntil) {
    return 0;
  }
  const remaining = state.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function clearAuthFailureState(email: string): void {
  setFailureState(normalizeEmailAddress(email), { failures: 0, lockedUntil: null });
}

function recordAuthFailure(email: string): { failures: number; isLocked: boolean; remainingMs: number } {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) {
    return { failures: 0, isLocked: false, remainingMs: 0 };
  }
  const state = getFailureState(normalized);
  state.failures += 1;
  state.lastFailureAt = Date.now();
  if (state.failures >= MAX_AUTH_FAILURES) {
    state.lockedUntil = Date.now() + AUTH_LOCKOUT_WINDOW_MS;
  }
  setFailureState(normalized, state);
  const remainingMs = getAuthLockoutRemainingMs(normalized);
  return {
    failures: state.failures,
    isLocked: !!state.lockedUntil && state.lockedUntil > Date.now(),
    remainingMs
  };
}

function readLocalAuditEvents(): AccountAuditEvent[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(ACCOUNT_AUDIT_STORE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as AccountAuditEvent[];
    if (Array.isArray(parsed)) {
      return parsed.slice(0, AUDIT_LIMIT);
    }
  } catch {
    // Ignore invalid cached audit data.
  }
  return [];
}

function saveLocalAuditEvents(events: AccountAuditEvent[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(ACCOUNT_AUDIT_STORE_KEY, JSON.stringify(events.slice(0, AUDIT_LIMIT)));
  } catch {
    // Continue without local auditing.
  }
}

function formatExpiry(seconds: number | null | undefined): string {
  if (!seconds) {
    return "unknown";
  }
  return new Date(seconds * 1000).toLocaleString();
}

function formatLockoutSeconds(remainingMs: number): string {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return `${seconds}s`;
}

function checkPasswordStrength(password: string): PasswordCheckResult {
  const checks: string[] = [];
  let score = 0;

  if (password.length >= 10) {
    score += 1;
  } else {
    checks.push("at least 10 characters");
  }

  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    checks.push("include a lowercase letter");
  }

  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    checks.push("include an uppercase letter");
  }

  if (/[0-9]/.test(password)) {
    score += 1;
  } else {
    checks.push("include a number");
  }

  if (/[^A-Za-z0-9]/.test(password)) {
    score += 1;
  } else {
    checks.push("include a special character");
  }

  return {
    ok: checks.length === 0,
    score,
    reason: checks.length > 0 ? `Password must ${checks.join(", ")}.` : "Password strength is good."
  };
}

function PasswordHint({ password, label }: { password: string; label: string }): JSX.Element {
  const status = useMemo(() => checkPasswordStrength(password), [password]);
  const strengthLabel =
    status.score >= 4
      ? "Strong"
      : status.score >= 3
        ? "Medium"
        : status.score > 0
          ? "Weak"
          : "Empty";

  return (
    <p className="muted-copy">
      {label}: {strengthLabel}
      {!status.ok ? ` (${status.reason})` : ""}
    </p>
  );
}

export function AlertsPage({ view = "alerts" }: AlertsPageProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [token, setToken] = useState("");
  const [showTokenTools, setShowTokenTools] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState("Not authenticated");
  const [authFeedback, setAuthFeedback] = useState<AuthFeedbackState | null>(null);
  const [busyAction, setBusyAction] = useState<AuthBusyAction>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [auditEvents, setAuditEvents] = useState<AccountAuditEvent[]>(() => readLocalAuditEvents());

  const normalizedEmail = normalizeEmailAddress(email);
  const lockMs = getAuthLockoutRemainingMs(normalizedEmail);
  const lockMessage = lockMs > 0 ? `Too many failed attempts. Retry in ${formatLockoutSeconds(lockMs)}.` : "";
  const isAuthPage = view !== "alerts";
  const pageTitle = view === "login" ? "Login" : view === "signup" ? "Create Account" : view === "reset" ? "Forgot Password" : "Account & Alerts";
  const loginBusy = busyAction === "login";
  const signupBusy = busyAction === "signup";
  const resetBusy = busyAction === "reset";
  const passwordChangeBusy = busyAction === "password_change";

  const setFeedback = (tone: FeedbackTone, message: string): void => {
    setAuthFeedback({ tone, message });
    setStatus(message);
  };

  const normalizeAuditEventEmail = (): string | undefined => {
    const sessionEmail = normalizeEmailAddress(session?.user?.email ?? "");
    if (sessionEmail) {
      return sessionEmail;
    }
    return normalizedEmail || undefined;
  };

  const appendLocalAuditEvent = (action: AuditAction, outcome: AuditOutcome, details?: string): AccountAuditEvent => {
    const event: AccountAuditEvent = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      at: new Date().toISOString(),
      action,
      outcome,
      details,
      email: normalizeAuditEventEmail(),
      source: "local"
    };
    setAuditEvents((previous) => {
      const next = [event, ...previous].slice(0, AUDIT_LIMIT);
      saveLocalAuditEvents(next);
      return next;
    });
    return event;
  };

  const syncAuditFromServer = async (requestToken: string): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE}/api/account/audit`, {
        headers: { Authorization: `Bearer ${requestToken}` }
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      const remoteEvents = Array.isArray((payload as { data?: { events?: AccountAuditEvent[] } }).data?.events)
        ? (payload as { data: { events: AccountAuditEvent[] } }).data.events
        : [];
      if (remoteEvents.length > 0) {
        setAuditEvents((previous) => {
          const merged = [...remoteEvents, ...previous.filter((item) => item.source === "local")];
          const sorted = merged.sort((left, right) => right.at.localeCompare(left.at));
          const capped = sorted.slice(0, AUDIT_LIMIT);
          saveLocalAuditEvents(capped);
          return capped;
        });
      }
    } catch {
      // Optional server-side log only.
    }
  };

  const reportAudit = async (
    action: AuditAction,
    outcome: AuditOutcome,
    details?: string,
    requestToken?: string
  ): Promise<void> => {
    appendLocalAuditEvent(action, outcome, details);
    if (!requestToken) {
      return;
    }
    try {
      await fetch(`${API_BASE}/api/account/audit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${requestToken}`
        },
        body: JSON.stringify({
          action,
          outcome,
          details,
          email: normalizeAuditEventEmail()
        })
      });
    } catch {
      // Keep local audit entry even if remote fails.
    }
  };

  const validateEmail = (value: string): string | null => {
    const normalized = normalizeEmailAddress(value);
    return normalized.includes("@") && normalized.includes(".") ? normalized : null;
  };

  const ensureNotLocked = (value: string): boolean => {
    const normalized = normalizeEmailAddress(value);
    if (!normalized) {
      return true;
    }
    const remainingMs = getAuthLockoutRemainingMs(normalized);
    if (remainingMs > 0) {
      setFeedback("error", `Action blocked: too many failed attempts. Try again in ${formatLockoutSeconds(remainingMs)}.`);
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      setBusyAction(null);
      return;
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setStatus(`Session check failed: ${error.message}`);
        return;
      }
      if (data.session) {
        setSession(data.session);
        setToken(data.session.access_token ?? "");
        setStatus("Authenticated");
        void syncAuditFromServer(data.session.access_token);
      } else {
        setSession(null);
        setStatus("Not authenticated");
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.access_token) {
        setToken(nextSession.access_token);
        void syncAuditFromServer(nextSession.access_token);
      }
      setStatus(nextSession ? "Authenticated" : "Signed out");
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (isAuthPage && session) {
      navigate("/alerts", { replace: true });
    }
  }, [isAuthPage, navigate, session]);

  useEffect(() => {
    const state = location.state as { flash?: AuthFeedbackState } | null;
    if (!state?.flash?.message) {
      return;
    }
    setFeedback(state.flash.tone, state.flash.message);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const resolveToken = async (): Promise<string | null> => {
    if (token) {
      return token;
    }
    if (!supabase) {
      return null;
    }
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setStatus(`Unable to resolve session token: ${error.message}`);
      return null;
    }
    if (!data.session?.access_token) {
      setStatus("No authenticated session. Please sign in or provide a token.");
      return null;
    }
    setToken(data.session.access_token);
    return data.session.access_token;
  };

  const login = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setAuthFeedback(null);
    setBusyAction("login");
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      setBusyAction(null);
      return;
    }
    const normalized = validateEmail(email);
    if (!normalized) {
      setFeedback("error", "Login failed: enter a valid email.");
      setBusyAction(null);
      return;
    }
    if (!ensureNotLocked(normalized)) {
      setBusyAction(null);
      return;
    }

    const directLogin = async () => {
      const result = await supabase.auth.signInWithPassword({
        email: normalized,
        password
      });
      return {
        data: result.data ? (result.data as Record<string, unknown>) : null,
        error: result.error ? { message: result.error.message } : undefined
      };
    };

    const authResult = await loginViaGateway(supabase, normalized, password, directLogin);

    if (authResult.ok) {
      const { accessToken } = authResult.data ? extractAuthTokenFromGateway(authResult.data) : {};
      if (accessToken) {
        setToken(accessToken);
      }
      clearAuthFailureState(normalized);
      setFeedback("success", "Login successful.");
      await reportAudit("login", "success", "Authenticated successfully.", accessToken);
      if (accessToken) {
        await syncAuditFromServer(accessToken);
      }
      if (isAuthPage) {
        navigate("/alerts", {
          state: {
            flash: {
              tone: "success",
              message: "Logged in successfully. You can now manage your alerts."
            } as AuthFeedbackState
          }
        });
      }
      setBusyAction(null);
      return;
    }

    const failure = recordAuthFailure(normalized);
    const message = authResult.message ?? "unknown error";
    setFeedback("error", `Login failed: ${message}`);
    await reportAudit("login", "failure", `login_failure_${failure.failures}`, token);
    setBusyAction(null);
  };

  const signup = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setAuthFeedback(null);
    setBusyAction("signup");
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      setBusyAction(null);
      return;
    }
    const normalized = validateEmail(email);
    if (!normalized) {
      setFeedback("error", "Sign up failed: enter a valid email.");
      setBusyAction(null);
      return;
    }
    if (!ensureNotLocked(normalized)) {
      setBusyAction(null);
      return;
    }
    const passwordCheck = checkPasswordStrength(password);
    if (!passwordCheck.ok) {
      setFeedback("error", `Sign up failed: ${passwordCheck.reason}`);
      await reportAudit("signup", "failure", `password_weak: ${passwordCheck.reason}`);
      setBusyAction(null);
      return;
    }
    if (password !== passwordConfirm) {
      setFeedback("error", "Sign up failed: Passwords do not match.");
      await reportAudit("signup", "failure", "Password confirmation mismatch.");
      setBusyAction(null);
      return;
    }

    const signupRedirectTo = `${window.location.origin}/alerts`;
    const directSignup = async () => {
      const result = await supabase.auth.signUp({
        email: normalized,
        password,
        options: {
          emailRedirectTo: signupRedirectTo
        }
      });
      return {
        data: result.data ? (result.data as Record<string, unknown>) : null,
        error: result.error ? { message: result.error.message } : undefined
      };
    };

    const authResult = await signupViaGateway(supabase, normalized, password, signupRedirectTo, directSignup);
    if (!authResult.ok) {
      const failure = recordAuthFailure(normalized);
      const message = authResult.message ?? "unknown error";
      setFeedback("error", `Sign up failed: ${message}`);
      await reportAudit("signup", "failure", `signup_failure_${failure.failures}`);
      setBusyAction(null);
      return;
    }

    clearAuthFailureState(normalized);
    const sessionTokens = authResult.data ? extractAuthTokenFromGateway(authResult.data) : {};
    if (sessionTokens.accessToken) {
      setToken(sessionTokens.accessToken);
      await reportAudit("signup", "success", "Signed up and authenticated.", sessionTokens.accessToken);
      await syncAuditFromServer(sessionTokens.accessToken);
      setFeedback("success", "Account created and logged in.");
      if (isAuthPage) {
        navigate("/alerts", {
          state: {
            flash: {
              tone: "success",
              message: "Account created successfully. You are now logged in."
            } as AuthFeedbackState
          }
        });
      }
    } else {
      await reportAudit("signup", "success", "Sign-up request sent.");
      setFeedback("success", "Verification email sent. Open your inbox and click the link to finish sign up.");
    }
    setBusyAction(null);
  };

  const sendPasswordReset = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setAuthFeedback(null);
    setBusyAction("reset");
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      setBusyAction(null);
      return;
    }
    const normalized = validateEmail(email);
    if (!normalized) {
      setFeedback("error", "Password reset request failed: enter a valid email.");
      setBusyAction(null);
      return;
    }
    if (!ensureNotLocked(normalized)) {
      setBusyAction(null);
      return;
    }

    const redirectTo = `${window.location.origin}/alerts`;
    const directReset = async () => {
      const result = await supabase.auth.resetPasswordForEmail(normalized, {
        redirectTo
      });
      return {
        data: result.data ? (result.data as Record<string, unknown>) : null,
        error: result.error ? { message: result.error.message } : undefined
      };
    };

    const authResult = await passwordResetViaGateway(normalized, redirectTo, directReset);
    if (!authResult.ok) {
      const failure = recordAuthFailure(normalized);
      const message = authResult.message ?? "unknown error";
      setFeedback("error", `Password reset request failed: ${message}`);
      await reportAudit("password_reset_request", "failure", `password_reset_failure_${failure.failures}`, token);
      setBusyAction(null);
      return;
    }

    clearAuthFailureState(normalized);
    setFeedback("success", "Password reset email sent. Check your inbox.");
    await reportAudit("password_reset_request", "success", "Password reset email sent.", token);
    setBusyAction(null);
  };

  const updatePassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setAuthFeedback(null);
    setBusyAction("password_change");
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      setBusyAction(null);
      return;
    }
    if (!session) {
      setFeedback("error", "Please sign in before changing your password.");
      await reportAudit("password_change", "failure", "missing_session", token);
      setBusyAction(null);
      return;
    }
    const passwordCheck = checkPasswordStrength(newPassword);
    if (!passwordCheck.ok) {
      setFeedback("error", `Password update failed: ${passwordCheck.reason}`);
      await reportAudit("password_change", "failure", `password_weak: ${passwordCheck.reason}`, session.access_token);
      setBusyAction(null);
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setFeedback("error", "Password update failed: Passwords do not match.");
      await reportAudit("password_change", "failure", "Password confirmation mismatch.", session.access_token);
      setBusyAction(null);
      return;
    }

    const directChange = async () => {
      const result = await supabase.auth.updateUser({
        password: newPassword
      });
      return {
        data: result.data ? (result.data as Record<string, unknown>) : null,
        error: result.error ? { message: result.error.message } : undefined
      };
    };

    const authResult = await passwordChangeViaGateway(session.access_token, newPassword, directChange);
    if (!authResult.ok) {
      const message = authResult.message ?? "unknown error";
      setFeedback("error", `Password update failed: ${message}`);
      await reportAudit("password_change", "failure", message, session.access_token);
      setBusyAction(null);
      return;
    }

    setNewPassword("");
    setNewPasswordConfirm("");
    setFeedback("success", "Password updated.");
    await reportAudit("password_change", "success", "Password changed.", session.access_token);
    setBusyAction(null);
  };

  const logout = async (): Promise<void> => {
    setAuthFeedback(null);
    if (!supabase) {
      setFeedback("error", "Supabase env is not configured.");
      return;
    }
    const accessToken = token;

    const directSignOut = async () => {
      const result = await supabase.auth.signOut();
      return {
        data: null,
        error: result.error ? { message: result.error.message } : undefined
      };
    };

    const authResult = await logoutViaGateway(supabase, accessToken, directSignOut);
    if (!authResult.ok) {
      const message = authResult.message ?? "unknown error";
      setFeedback("error", `Logout failed: ${message}`);
      await reportAudit("logout", "failure", message, accessToken);
      return;
    }

    setSession(null);
    setToken("");
    setFeedback("info", "Signed out successfully.");
    await reportAudit("logout", "success", "Signed out.", accessToken);
  };

  const loadRules = async (): Promise<void> => {
    const requestToken = await resolveToken();
    if (!requestToken) {
      return;
    }
    const response = await fetch(`${API_BASE}/api/alerts/rules`, {
      headers: { Authorization: `Bearer ${requestToken}` }
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Failed to load rules: ${payload.error?.message ?? "unknown"}`);
      await reportAudit("rules_load", "failure", "Unable to load rules.", requestToken);
      return;
    }
    setRules(payload.data.rules as AlertRule[]);
    setStatus("Rules loaded");
    await reportAudit("rules_load", "success", "Rules loaded.", requestToken);
  };

  const addRule = async (): Promise<void> => {
    const requestToken = await resolveToken();
    if (!requestToken) {
      return;
    }
    const response = await fetch(`${API_BASE}/api/alerts/rules`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${requestToken}`
      },
      body: JSON.stringify({
        enabled: true,
        rule_type: "breaking",
        rule: { tab: "breaking" }
      })
    });
    if (!response.ok) {
      const payload = await response.json();
      setStatus(`Create rule failed: ${payload.error?.message ?? "unknown"}`);
      await reportAudit("rule_add", "failure", "Unable to create rule.", requestToken);
      return;
    }
    await loadRules();
    await reportAudit("rule_add", "success", "Rule created.", requestToken);
  };

  return (
    <section className="page-wrap">
      <header className="glass-panel page-header">
        <h1>{pageTitle}</h1>
        <p className="muted-copy">{status}</p>
      </header>

      {authFeedback ? (
        <section className={`glass-panel card-stack auth-feedback auth-feedback-${authFeedback.tone}`} role="status" aria-live="polite">
          <p>{authFeedback.message}</p>
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

      {view === "alerts" && session ? (
        <section className="glass-panel card-stack">
          <h2>Account</h2>
          <p className="muted-copy">Signed in as {session.user.email ?? "a verified user"}</p>
          <p className="muted-copy">
            Session expires: {formatExpiry(session.expires_at)}
          </p>
          <div className="row-actions">
            <button type="button" className="btn btn-ghost" onClick={logout}>
              Logout
            </button>
          </div>
        </section>
      ) : null}

      {view === "signup" ? (
        <section className="glass-panel card-stack auth-form">
          <h2>Sign up</h2>
          {lockMessage ? <p className="muted-copy">{lockMessage}</p> : null}
          <form onSubmit={signup} className="card-stack">
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={signupBusy} />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={signupBusy} />
            </label>
            <PasswordHint password={password} label="Password strength" />
            <label>
              Confirm Password
              <input
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                disabled={signupBusy}
              />
            </label>
            <div className="row-actions">
              <button type="submit" className="btn btn-primary" disabled={signupBusy}>
                {signupBusy ? "Creating account..." : "Create account"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/login")} disabled={signupBusy}>
                Already have an account?
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {view === "login" ? (
        <section className="glass-panel card-stack auth-form">
          <h2>Sign in</h2>
          {lockMessage ? <p className="muted-copy">{lockMessage}</p> : null}
          <form onSubmit={login} className="card-stack">
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={loginBusy} />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={loginBusy} />
            </label>
            <div className="row-actions">
              <button type="submit" className="btn btn-primary" disabled={loginBusy}>
                {loginBusy ? "Logging in..." : "Login"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/signup")} disabled={loginBusy}>
                Create account
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/forgot-password")} disabled={loginBusy}>
                Forgot password
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {view === "reset" ? (
        <section className="glass-panel card-stack auth-form">
          <h2>Forgot password</h2>
          <form onSubmit={sendPasswordReset} className="card-stack">
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={resetBusy} />
            </label>
            <div className="row-actions">
              <button type="submit" className="btn btn-primary" disabled={resetBusy}>
                {resetBusy ? "Sending reset email..." : "Send reset link"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/login")} disabled={resetBusy}>
                Back to login
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {view === "alerts" && session ? (
        <section className="glass-panel card-stack auth-form">
          <h2>Change password</h2>
          <form onSubmit={updatePassword} className="card-stack">
            <label>
              New Password
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={passwordChangeBusy}
              />
            </label>
            <PasswordHint password={newPassword} label="Password strength" />
            <label>
              Confirm New Password
              <input
                type="password"
                value={newPasswordConfirm}
                onChange={(event) => setNewPasswordConfirm(event.target.value)}
                disabled={passwordChangeBusy}
              />
            </label>
            <div className="row-actions">
              <button type="submit" className="btn btn-primary" disabled={passwordChangeBusy}>
                {passwordChangeBusy ? "Updating password..." : "Update password"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {view === "alerts" && session ? (
      <section className="glass-panel card-stack">
        <div className="row-actions">
          {TOKEN_DEBUG_TOOLS_ENABLED ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setShowTokenTools((previous) => !previous);
              }}
            >
              {showTokenTools ? "Hide API token tools" : "Show API token tools"}
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={loadRules}>
            Load Rules
          </button>
          <button type="button" className="btn btn-ghost" onClick={addRule}>
            Add Breaking Rule
          </button>
        </div>
        <p className="muted-copy">
          API rules operations use your logged-in session token automatically.
        </p>
        {TOKEN_DEBUG_TOOLS_ENABLED && showTokenTools ? (
          <div className="card-stack">
            <p className="muted-copy">
              Advanced only: ?좏겙? 媛쒕컻???붾쾭源낆뿉留??ъ슜?섏꽭??
            </p>
            <label>
              Bearer Token
              <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Session token (debug)" />
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                if (!session?.access_token) {
                  setStatus("No session to copy token from.");
                  return;
                }
                await navigator.clipboard?.writeText(session.access_token);
                setStatus("Session token copied.");
                await reportAudit("token_copy", "success", "Session token copied.", session.access_token);
              }}
            >
              Copy Session Token
            </button>
          </div>
        ) : null}
      </section>
      ) : null}

      {view === "alerts" && session ? (
      <section className="glass-panel card-stack">
        <h2>Account activity</h2>
        {auditEvents.length === 0 ? (
          <p className="muted-copy">No account activity recorded yet.</p>
        ) : (
          <ul className="card-stack">
            {auditEvents.slice(0, 10).map((entry) => (
              <li key={entry.id}>
                <p className="muted-copy">
                  {new Date(entry.at).toLocaleString()} 쨌 {entry.action} 쨌 {entry.outcome}
                </p>
                {entry.details ? <p className="muted-copy">{entry.details}</p> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              const requestToken = await resolveToken();
              if (!requestToken) {
                setStatus("No authenticated session to refresh audit log.");
                return;
              }
              await syncAuditFromServer(requestToken);
              await reportAudit("token_view", "success", "Account activity refreshed.", requestToken);
            }}
          >
            Refresh account activity
          </button>
        </div>
      </section>
      ) : null}

      {view === "alerts" && session ? (
        <pre className="json-block glass-panel">{JSON.stringify(rules, null, 2)}</pre>
      ) : null}
    </section>
  );
}

