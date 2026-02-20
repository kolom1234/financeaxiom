import { useConsent } from "../state/consent";

export function PrivacyPage(): JSX.Element {
  const { regionPolicy, country, usStateCode, consent, hasDecision, acceptAll, rejectAds, clearDecision } = useConsent();
  const adsEnabled = consent.ads_nonpersonalized || consent.ads_personalized;
  const geoLabel = usStateCode ? `${country}-${usStateCode}` : country;

  return (
    <section className="page-wrap">
      <article className="glass-panel card-stack">
        <h1>Privacy</h1>
        <p>Effective date: 2026-02-20.</p>
        <p>
          We process account authentication data through Supabase Auth, encrypted push subscription keys for alerts,
          and consent preferences used for ad loading controls.
        </p>
        <p>Push subscription endpoint/keys are encrypted at rest using AES-GCM before storage.</p>
        <p>Account activity audit events are retained for 30 days server-side and up to 20 events in local browser storage.</p>
        <p>EU/UK/CH ad scripts remain blocked before consent, and US state privacy regions require valid privacy signals.</p>
        <p>
          Data rights requests (access, correction, deletion, objection, consent withdrawal) can be submitted via{" "}
          <a href="mailto:contact@financeaxiom.com">contact@financeaxiom.com</a>.
        </p>
        <p>
          We respond based on applicable law and may request account verification before fulfilling sensitive requests.
        </p>
      </article>

      <article className="glass-panel card-stack">
        <h2>Consent Controls</h2>
        <p>
          Region policy: <strong>{regionPolicy}</strong> ({geoLabel})
        </p>
        <p>
          Current ad consent: <strong>{adsEnabled ? "enabled" : "disabled"}</strong> {hasDecision ? "(saved)" : "(not decided)"}
        </p>
        <div className="consent-actions">
          <button type="button" className="btn btn-primary" onClick={acceptAll}>
            Accept All
          </button>
          <button type="button" className="btn btn-ghost" onClick={rejectAds}>
            Reject Ads
          </button>
          <button type="button" className="btn btn-ghost" onClick={clearDecision}>
            Reset Decision
          </button>
        </div>
        <p className="muted-copy">
          Resetting decision clears stored consent preferences and returns ad script loading to blocked-by-default mode.
        </p>
      </article>
    </section>
  );
}
