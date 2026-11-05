import type { FormEvent } from "react";
import { PasswordHint } from "./PasswordHint";

interface CredentialsProps {
  email: string;
  password: string;
  busy: boolean;
  lockMessage: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onNavigate: (path: string) => void;
}

export function LoginForm(props: CredentialsProps): JSX.Element {
  return (
    <section className="glass-panel card-stack auth-form">
      <h2>Sign in</h2>
      {props.lockMessage ? <p className="muted-copy">{props.lockMessage}</p> : null}
      <form onSubmit={props.onSubmit} className="card-stack">
        <label>
          Email
          <input type="email" autoComplete="email" value={props.email} onChange={(event) => props.onEmailChange(event.target.value)} disabled={props.busy} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={props.password}
            onChange={(event) => props.onPasswordChange(event.target.value)}
            disabled={props.busy}
          />
        </label>
        <div className="row-actions">
          <button type="submit" className="btn btn-primary" disabled={props.busy}>
            {props.busy ? "Logging in..." : "Login"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => props.onNavigate("/signup")} disabled={props.busy}>
            Create account
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => props.onNavigate("/forgot-password")} disabled={props.busy}>
            Forgot password
          </button>
        </div>
      </form>
    </section>
  );
}

export function SignupForm(
  props: CredentialsProps & { passwordConfirm: string; onPasswordConfirmChange: (value: string) => void }
): JSX.Element {
  return (
    <section className="glass-panel card-stack auth-form">
      <h2>Sign up</h2>
      {props.lockMessage ? <p className="muted-copy">{props.lockMessage}</p> : null}
      <form onSubmit={props.onSubmit} className="card-stack">
        <label>
          Email
          <input type="email" autoComplete="email" value={props.email} onChange={(event) => props.onEmailChange(event.target.value)} disabled={props.busy} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            value={props.password}
            onChange={(event) => props.onPasswordChange(event.target.value)}
            disabled={props.busy}
          />
        </label>
        <PasswordHint password={props.password} label="Password strength" />
        <label>
          Confirm Password
          <input
            type="password"
            autoComplete="new-password"
            value={props.passwordConfirm}
            onChange={(event) => props.onPasswordConfirmChange(event.target.value)}
            disabled={props.busy}
          />
        </label>
        <div className="row-actions">
          <button type="submit" className="btn btn-primary" disabled={props.busy}>
            {props.busy ? "Creating account..." : "Create account"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => props.onNavigate("/login")} disabled={props.busy}>
            Already have an account?
          </button>
        </div>
      </form>
    </section>
  );
}

export function ResetForm(props: Omit<CredentialsProps, "password" | "onPasswordChange" | "lockMessage">): JSX.Element {
  return (
    <section className="glass-panel card-stack auth-form">
      <h2>Forgot password</h2>
      <form onSubmit={props.onSubmit} className="card-stack">
        <label>
          Email
          <input type="email" autoComplete="email" value={props.email} onChange={(event) => props.onEmailChange(event.target.value)} disabled={props.busy} />
        </label>
        <div className="row-actions">
          <button type="submit" className="btn btn-primary" disabled={props.busy}>
            {props.busy ? "Sending reset email..." : "Send reset link"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => props.onNavigate("/login")} disabled={props.busy}>
            Back to login
          </button>
        </div>
      </form>
    </section>
  );
}

export function ChangePasswordForm(props: {
  newPassword: string;
  newPasswordConfirm: string;
  busy: boolean;
  onNewPasswordChange: (value: string) => void;
  onNewPasswordConfirmChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}): JSX.Element {
  return (
    <section className="glass-panel card-stack auth-form">
      <h2>Change password</h2>
      <form onSubmit={props.onSubmit} className="card-stack">
        <label>
          New Password
          <input
            type="password"
            autoComplete="new-password"
            value={props.newPassword}
            onChange={(event) => props.onNewPasswordChange(event.target.value)}
            disabled={props.busy}
          />
        </label>
        <PasswordHint password={props.newPassword} label="Password strength" />
        <label>
          Confirm New Password
          <input
            type="password"
            autoComplete="new-password"
            value={props.newPasswordConfirm}
            onChange={(event) => props.onNewPasswordConfirmChange(event.target.value)}
            disabled={props.busy}
          />
        </label>
        <div className="row-actions">
          <button type="submit" className="btn btn-primary" disabled={props.busy}>
            {props.busy ? "Updating password..." : "Update password"}
          </button>
        </div>
      </form>
    </section>
  );
}
