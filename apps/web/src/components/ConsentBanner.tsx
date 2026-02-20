import { useConsent } from "../state/consent";

export function ConsentBanner(): JSX.Element | null {
  const { regionPolicy, country, usStateCode, hasDecision, acceptAll, rejectAds } = useConsent();

  if ((regionPolicy !== "EU_UK_CH" && regionPolicy !== "US_STATE_PRIVACY") || hasDecision) {
    return null;
  }

  const locationLabel =
    regionPolicy === "US_STATE_PRIVACY" && usStateCode ? `${country}-${usStateCode}` : country;

  return (
    <section className="consent-banner glass-panel" aria-live="polite">
      <div className="consent-copy">
        <strong>Consent required in {locationLabel}</strong>
        <p>Ads scripts stay disabled until you grant consent preferences.</p>
      </div>
      <div className="consent-actions">
        <button type="button" className="btn btn-primary" onClick={acceptAll}>
          Accept All
        </button>
        <button type="button" className="btn btn-ghost" onClick={rejectAds}>
          Reject Ads
        </button>
      </div>
    </section>
  );
}
