import { useState } from "react";

/** Developer-only tooling, compiled in only when VITE_TOKEN_DEBUG_TOOLS=1. */
export function TokenTools({ token, onTokenChange, onCopy }: { token: string; onTokenChange: (value: string) => void; onCopy: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <section className="glass-panel card-stack">
      <button type="button" className="btn btn-ghost" onClick={() => setOpen((previous) => !previous)}>
        {open ? "Hide API token tools" : "Show API token tools"}
      </button>
      {open ? (
        <div className="card-stack">
          <p className="muted-copy">Advanced only: use the session token for local development and debugging only. Never share it.</p>
          <label>
            Bearer Token
            <input value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder="Session token (debug)" />
          </label>
          <button type="button" className="btn btn-ghost" onClick={onCopy}>
            Copy Session Token
          </button>
        </div>
      ) : null}
    </section>
  );
}
