import { Client } from "pg";
import type { Env } from "../types";

export type PgClient = InstanceType<typeof Client>;

/**
 * Raised when the persistent store cannot be used (not configured, connect
 * failure, or a query error). Routes let it propagate; the top-level handler
 * maps it to 503. "Not found" is never an error: data functions return `null`
 * (or an empty list) for that, so callers can answer 404 correctly.
 */
export class DbUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "DbUnavailableError";
  }
}

export function connectionString(env: Env): string | null {
  const fromHyperdrive = (env.HYPERDRIVE as { connectionString?: string } | undefined)?.connectionString;
  return fromHyperdrive ?? env.DATABASE_URL ?? null;
}

export function hasDatabase(env: Env): boolean {
  return connectionString(env) !== null;
}

/**
 * True for errors raised by Postgres or the driver: a server error carries a
 * 5-character SQLSTATE `code`; a dropped connection has no code but a known message.
 */
export function isDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    return true;
  }
  const message = String((error as { message?: unknown }).message ?? "");
  return /connection terminated|connection ended|ECONNRESET|ECONNREFUSED|Client has encountered a connection error/i.test(message);
}

/**
 * Runs `fn` with a connected client and always closes it.
 * Throws DbUnavailableError if the database is not configured or unreachable,
 * or if a query fails; the original error is kept in `cause` for logging.
 * Non-database errors thrown by `fn` are re-thrown as-is.
 */
export async function withDb<T>(env: Env, fn: (client: PgClient) => Promise<T>): Promise<T> {
  const url = connectionString(env);
  if (!url) {
    throw new DbUnavailableError("Database is not configured.");
  }

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    throw new DbUnavailableError("Database connection failed.", error);
  }

  try {
    return await fn(client);
  } catch (error) {
    // Only database failures become DbUnavailableError; errors raised by the
    // callback itself (e.g. an upstream API failure during ingest) propagate unchanged.
    if (error instanceof DbUnavailableError || !isDatabaseError(error)) {
      throw error;
    }
    throw new DbUnavailableError("Database query failed.", error);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Runs `fn` inside a transaction on an existing client. */
export async function inTransaction<T>(client: PgClient, fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

/** Escapes LIKE/ILIKE wildcards so user input matches literally. */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}
