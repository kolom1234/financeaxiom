import type { AccountAuditEvent } from "../../lib/accountApi";

const SOURCE_LABEL: Record<AccountAuditEvent["source"], string> = {
  server: "recorded by server",
  client: "reported by a browser",
  local: "this browser"
};

export function AuditPanel({ events, onRefresh }: { events: AccountAuditEvent[]; onRefresh: () => void }): JSX.Element {
  return (
    <section className="glass-panel card-stack">
      <h2>Account activity</h2>
      {events.length === 0 ? (
        <p className="muted-copy">No account activity recorded yet.</p>
      ) : (
        <ul className="card-stack">
          {events.slice(0, 10).map((entry) => (
            <li key={entry.id}>
              <p className="muted-copy">
                {new Date(entry.at).toLocaleString()} · {entry.action} · {entry.outcome} · {SOURCE_LABEL[entry.source] ?? entry.source}
              </p>
              {entry.details ? <p className="muted-copy">{entry.details}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="row-actions">
        <button type="button" className="btn btn-ghost" onClick={onRefresh}>
          Refresh account activity
        </button>
      </div>
    </section>
  );
}
