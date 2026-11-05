export interface SecFilingInput {
  accession: string;
  company: string;
  form_type: string;
  sec_url: string;
}

/** Self-generated, fact-only headline (no filing text is reproduced). */
export function buildSecHeadline(input: SecFilingInput): string {
  return `[Filing] ${input.company} ${input.form_type} filed`;
}
