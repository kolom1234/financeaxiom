import { gateG_secDeclaredUserAgent } from "../compliance/gates";
import { assertSecUserAgentConfigured } from "../services/sec";

export interface SecFilingInput {
  accession: string;
  company: string;
  form_type: string;
  sec_url: string;
}

export function validateSecConfig(userAgent: string | undefined): void {
  if (!gateG_secDeclaredUserAgent(userAgent)) {
    throw new Error("SEC User-Agent must contain company name and contact email.");
  }
}

export function buildSecHeadline(input: SecFilingInput): string {
  return `[Filing] ${input.company} ${input.form_type} filed`;
}

export function assertSecPolicyReady(userAgent: string | undefined): void {
  assertSecUserAgentConfigured({ SEC_USER_AGENT: userAgent });
}

