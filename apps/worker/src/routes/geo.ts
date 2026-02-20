import { okJson } from "./utils";
import type { Env } from "../types";

const EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE"
]);

const US_STATE_PRIVACY_CODES = new Set([
  "CA",
  "CO",
  "CT",
  "DE",
  "IA",
  "IN",
  "MT",
  "NE",
  "NH",
  "NJ",
  "OR",
  "TN",
  "TX",
  "UT",
  "VA"
]);

export async function handleGeo(request: Request, env: Env): Promise<Response> {
  const country = (request.headers.get("cf-ipcountry") ?? "US").toUpperCase();
  const usStateCodeRaw = request.headers.get("cf-region-code");
  const us_state_code = usStateCodeRaw ? usStateCodeRaw.toUpperCase() : null;
  const isEuUkCh = EU_COUNTRIES.has(country) || country === "GB" || country === "CH";
  const us_state_privacy_required =
    country === "US" && us_state_code !== null && US_STATE_PRIVACY_CODES.has(us_state_code);
  const region_policy = isEuUkCh ? "EU_UK_CH" : us_state_privacy_required ? "US_STATE_PRIVACY" : "NON_EU";

  return okJson(request, env, {
    country,
    us_state_code,
    us_state_privacy_required,
    region_policy
  });
}
