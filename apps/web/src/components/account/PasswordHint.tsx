import { useMemo } from "react";
import { checkPasswordStrength } from "../../lib/passwordPolicy";

export function PasswordHint({ password, label }: { password: string; label: string }): JSX.Element {
  const status = useMemo(() => checkPasswordStrength(password), [password]);
  const strength = status.score >= 5 ? "Strong" : status.score >= 3 ? "Medium" : status.score > 0 ? "Weak" : "Empty";
  return (
    <p className="muted-copy">
      {label}: {strength}
      {!status.ok ? ` (${status.reason})` : ""}
    </p>
  );
}
