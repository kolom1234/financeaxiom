export function DangerZone({ busy, onDelete }: { busy: boolean; onDelete: () => void }): JSX.Element {
  return (
    <section className="glass-panel card-stack">
      <h2>Delete my data</h2>
      <p className="muted-copy">
        Permanently deletes your alert rules, push subscriptions, notification history and account activity log. This cannot be undone.
      </p>
      <div className="row-actions">
        <button type="button" className="btn btn-ghost" onClick={onDelete} disabled={busy}>
          Delete my data
        </button>
      </div>
    </section>
  );
}
