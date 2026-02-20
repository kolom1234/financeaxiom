# Privacy Policy

Effective date: 2026-02-20.

## Data We Process

- Account identity and session state via Supabase Auth.
- Web Push subscription data for alert delivery:
  - endpoint (stored as hash + encrypted value)
  - key material (`p256dh`, `auth`) encrypted with AES-GCM.
- Consent state for analytics/ads categories in browser local storage.
- Account activity audit records (action, outcome, details, optional email) for account-security telemetry.

## Why We Process It

- Authentication and account protection.
- Delivery of user-configured push alerts.
- Compliance with regional consent requirements for ad loading.
- Abuse prevention and security auditing.

## Retention

- Account activity audit events: up to 30 days server-side.
- Browser-side account activity cache: up to 20 events in local storage.
- Consent preference cache: persisted in browser until user resets decision.

## Ads and Consent

- In EU/UK/CH, ad scripts are not loaded before consent.
- EU/UK/CH ad loading requires a valid TCF consent signal.
- In US state privacy jurisdictions, ad loading requires a valid GPP/USP privacy signal.
- Personalized ads require explicit consent and applicable CMP signaling.
- Users can update or reset consent decisions from the `/privacy` page.

## Security

- Push endpoints and keys are encrypted at rest.
- JWT is verified via Supabase JWKS in Worker APIs.
- Public and auth routes are rate-limited.

## Disclaimer

This site is not endorsed by any data provider. Information only; not investment advice.

## Data Rights Requests

For data rights requests (access, correction, deletion, objection, consent withdrawal), contact:

- contact@financeaxiom.com

We may request account verification before fulfilling sensitive requests.
