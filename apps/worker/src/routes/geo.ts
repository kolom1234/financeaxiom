import type { RegionPolicy } from "@ofp/shared";
import { okJson } from "./utils";
import type { Env } from "../types";

/** EU member states plus the other EEA states (IS, LI, NO), where the GDPR and TCF apply. */
const EEA_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT",
  "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO"
]);
const UK_AND_SWITZERLAND = new Set(["GB", "CH"]);

/**
 * US states whose comprehensive consumer-privacy statutes are in force
 * (opt-out of targeted advertising / sale required). Review when new state
 * laws take effect.
 */
const US_STATE_PRIVACY_CODES = new Set([
  "CA", "CO", "CT", "DE", "IA", "IN", "KY", "MD", "MN", "MT", "NE", "NH", "NJ", "OR", "RI", "TN", "TX", "UT", "VA"
]);

/** Cloudflare special codes: XX = unknown, T1 = Tor exit node. */
const UNKNOWN_COUNTRY_CODES = new Set(["XX", "T1", ""]);

interface CfGeo {
  country?: string;
  regionCode?: string;
}

function readGeo(request: Request): { country: string; regionCode: string | null } {
  const cf = (request as Request & { cf?: CfGeo }).cf;
  const country = (cf?.country ?? request.headers.get("cf-ipcountry") ?? "").trim().toUpperCase();
  const regionCode = (cf?.regionCode ?? request.headers.get("cf-region-code") ?? "").trim().toUpperCase();
  return { country, regionCode: regionCode || null };
}

export function classifyRegion(country: string, regionCode: string | null): {
  region_policy: RegionPolicy;
  us_state_privacy_required: boolean;
  location_known: boolean;
} {
  // Fail closed: if we cannot tell where the visitor is, apply the strictest policy.
  if (UNKNOWN_COUNTRY_CODES.has(country)) {
    return { region_policy: "EU_UK_CH", us_state_privacy_required: false, location_known: false };
  }
  if (EEA_COUNTRIES.has(country) || UK_AND_SWITZERLAND.has(country)) {
    return { region_policy: "EU_UK_CH", us_state_privacy_required: false, location_known: true };
  }
  if (country === "US") {
    // Without a state we cannot rule out a privacy-law state, so require the US privacy signal.
    const stateRequired = regionCode === null || US_STATE_PRIVACY_CODES.has(regionCode);
    return {
      region_policy: stateRequired ? "US_STATE_PRIVACY" : "NON_EU",
      us_state_privacy_required: stateRequired,
      location_known: regionCode !== null
    };
  }
  return { region_policy: "NON_EU", us_state_privacy_required: false, location_known: true };
}

export async function handleGeo(request: Request, env: Env): Promise<Response> {
  const { country, regionCode } = readGeo(request);
  const classification = classifyRegion(country, regionCode);
  const response = okJson(request, env, {
    country: country || "XX",
    us_state_code: country === "US" ? regionCode : null,
    ...classification
  });
  // Per-visitor answer: must never be cached by shared caches.
  response.headers.set("cache-control", "private, no-store");
  return response;
}
