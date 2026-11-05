/**
 * Structured JSON logging (one object per line) so Workers Logs / Logpush can
 * index fields. Never pass secrets, tokens, passwords or raw e-mail addresses.
 */
type Level = "info" | "warn" | "error";

export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return {
      error_name: error.name,
      error_message: error.message,
      ...(cause instanceof Error ? { cause_name: cause.name, cause_message: cause.message } : {})
    };
  }
  return { error_message: String(error) };
}

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
