/** Mirrors supabase/config.toml (minimum_password_length, password_requirements) and the worker gateway. */
export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordCheckResult {
  ok: boolean;
  score: number;
  reason: string;
}

export function checkPasswordStrength(password: string): PasswordCheckResult {
  const rules: Array<[boolean, string]> = [
    [password.length >= PASSWORD_MIN_LENGTH, `at least ${PASSWORD_MIN_LENGTH} characters`],
    [/[a-z]/.test(password), "include a lowercase letter"],
    [/[A-Z]/.test(password), "include an uppercase letter"],
    [/[0-9]/.test(password), "include a number"],
    [/[^A-Za-z0-9]/.test(password), "include a special character"]
  ];
  const missing = rules.filter(([passed]) => !passed).map(([, label]) => label);
  return {
    ok: missing.length === 0,
    score: rules.length - missing.length,
    reason: missing.length > 0 ? `Password must ${missing.join(", ")}.` : "Password strength is good."
  };
}
