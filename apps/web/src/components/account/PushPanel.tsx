import type { PushStatus } from "../../lib/pushClient";

const STATUS_TEXT: Record<PushStatus, string> = {
  unsupported: "This browser does not support push notifications.",
  disabled_on_server: "Push notifications are not enabled on this deployment yet.",
  denied: "Notifications are blocked for this site in your browser settings.",
  subscribed: "Notifications are enabled on this device.",
  not_subscribed: "Notifications are off on this device."
};

export function PushPanel({
  status,
  busy,
  onEnable,
  onDisable
}: {
  status: PushStatus | null;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}): JSX.Element {
  return (
    <section className="glass-panel card-stack">
      <h2>Push notifications</h2>
      <p className="muted-copy">{status ? STATUS_TEXT[status] : "Checking notification status…"}</p>
      <p className="muted-copy">Alerts match your rules above; at most 10 notifications per hour, one per item.</p>
      <div className="row-actions">
        {status === "subscribed" ? (
          <button type="button" className="btn btn-ghost" onClick={onDisable} disabled={busy}>
            Disable notifications
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onEnable}
            disabled={busy || status === "unsupported" || status === "denied"}
          >
            Enable notifications
          </button>
        )}
      </div>
    </section>
  );
}
