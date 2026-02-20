export type CommercialStatus = "allowed" | "conditional" | "disallowed";

export type RegionPolicy = "EU_UK_CH" | "NON_EU";

export interface LicensePayload {
  code: string;
  commercial_status: CommercialStatus;
  attribution_text: string;
  disclaimer_text?: string;
}

export interface SourcePayload {
  name: string;
  policy_url: string;
}

export interface EntityPayload {
  slug: string;
  name: string;
  primary_ticker?: string | null;
}

export interface FeedItemPayload {
  item_id: string;
  item_type: "gdelt_link" | "sec_filing" | "macro_update" | "fact_flash" | "analysis";
  event_time: string;
  headline: string;
  summary?: string | null;
  external_url?: string | null;
  meta?: Record<string, unknown>;
  entities: EntityPayload[];
  source: SourcePayload;
  license: LicensePayload;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  meta: {
    generated_at: string;
    cursor: string | null;
    cache: {
      hit: boolean;
      ttl: number;
    };
  };
}

export function envelope<T>(
  data: T,
  options?: Partial<ApiEnvelope<T>["meta"]>
): ApiEnvelope<T> {
  return {
    ok: true,
    data,
    meta: {
      generated_at: new Date().toISOString(),
      cursor: options?.cursor ?? null,
      cache: {
        hit: options?.cache?.hit ?? false,
        ttl: options?.cache?.ttl ?? 0
      }
    }
  };
}

export function notInvestmentAdviceText(): string {
  return "This site is not endorsed by any data provider. Information only; not investment advice.";
}
