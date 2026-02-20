import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getGeo } from "../lib/api";

type ConsentState = {
  essential: true;
  analytics: boolean;
  ads_nonpersonalized: boolean;
  ads_personalized: boolean;
};

export type RegionPolicy = "EU_UK_CH" | "US_STATE_PRIVACY" | "NON_EU";

interface ConsentContextValue {
  regionPolicy: RegionPolicy;
  country: string;
  usStateCode: string | null;
  usStatePrivacyRequired: boolean;
  consent: ConsentState;
  hasDecision: boolean;
  acceptAll: () => void;
  rejectAds: () => void;
  clearDecision: () => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);
const STORAGE_KEY = "ofp_consent_v1";

function normalizeRegionPolicy(input: string | null | undefined): RegionPolicy {
  if (input === "EU_UK_CH" || input === "US_STATE_PRIVACY") {
    return input;
  }
  return "NON_EU";
}

function defaultConsent(): ConsentState {
  return {
    essential: true,
    analytics: false,
    ads_nonpersonalized: false,
    ads_personalized: false
  };
}

export function ConsentProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [regionPolicy, setRegionPolicy] = useState<RegionPolicy>("NON_EU");
  const [country, setCountry] = useState("US");
  const [usStateCode, setUsStateCode] = useState<string | null>(null);
  const [usStatePrivacyRequired, setUsStatePrivacyRequired] = useState(false);
  const [consent, setConsent] = useState<ConsentState>(defaultConsent);
  const [hasDecision, setHasDecision] = useState(false);

  useEffect(() => {
    let active = true;
    void getGeo().then((geo) => {
      if (!active) {
        return;
      }
      setCountry(geo.country);
      setRegionPolicy(normalizeRegionPolicy(geo.region_policy));
      setUsStateCode(typeof geo.us_state_code === "string" ? geo.us_state_code : null);
      setUsStatePrivacyRequired(Boolean(geo.us_state_privacy_required));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { consent: ConsentState };
      setConsent(parsed.consent);
      setHasDecision(true);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (consent.ads_nonpersonalized || consent.ads_personalized) {
      return;
    }
    // Ensure previously loaded ad SDK scripts are removed when consent is withdrawn/reset.
    document.querySelectorAll("script[data-ofp-ad-script='1']").forEach((node) => node.remove());
  }, [consent.ads_nonpersonalized, consent.ads_personalized]);

  const saveDecision = (next: ConsentState): void => {
    setConsent(next);
    setHasDecision(true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ consent: next, at: Date.now() }));
  };

  const value = useMemo<ConsentContextValue>(
    () => ({
      regionPolicy,
      country,
      usStateCode,
      usStatePrivacyRequired,
      consent,
      hasDecision,
      acceptAll: () =>
        saveDecision({
          essential: true,
          analytics: true,
          ads_nonpersonalized: true,
          ads_personalized: true
        }),
      rejectAds: () =>
        saveDecision({
          essential: true,
          analytics: false,
          ads_nonpersonalized: false,
          ads_personalized: false
        }),
      clearDecision: () => {
        setConsent(defaultConsent());
        setHasDecision(false);
        localStorage.removeItem(STORAGE_KEY);
      }
    }),
    [regionPolicy, country, usStateCode, usStatePrivacyRequired, consent, hasDecision]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const context = useContext(ConsentContext);
  if (!context) {
    throw new Error("useConsent must be used inside ConsentProvider.");
  }
  return context;
}
