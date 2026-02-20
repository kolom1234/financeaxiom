import type { DurableObjectNamespace, KVNamespace, Queue, R2Bucket } from "@cloudflare/workers-types";
import type { CommercialStatus, EntityPayload, FeedItemPayload, LicensePayload, SourcePayload } from "@ofp/shared";

export interface Env {
  OFP_KV?: KVNamespace;
  AUDIT_R2?: R2Bucket;
  HYPERDRIVE?: unknown;
  INGEST_QUEUE?: Queue<IngestQueueMessage>;
  PUSH_QUEUE?: Queue<PushQueueMessage>;
  SEC_LIMITER_DO?: DurableObjectNamespace;
  EVENT_HUB_DO?: DurableObjectNamespace;
  RATE_LIMITER_DO?: DurableObjectNamespace;
  SEC_USER_AGENT?: string;
  EVENT_HUB_INTERNAL_TOKEN?: string;
  PUSH_DATA_ENC_KEY?: string;
  DATABASE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_JWKS_URL?: string;
  SUPABASE_JWT_AUDIENCE?: string;
  SUPABASE_JWT_ISSUER?: string;
  SUPABASE_JWT_MAX_AGE_SECONDS?: string;
  ALLOWED_ORIGINS?: string;
  AUTH_ALLOWED_REDIRECT_ORIGINS?: string;
  ALLOW_MEMORY_READ_FALLBACK?: string;
  ADS_PROVIDER?: string;
  CMP_PROVIDER?: string;
  GDELT_MODE?: string;
  BEA_API_KEY?: string;
  EIA_API_KEY?: string;
  TEST_AUTH_BYPASS?: string;
}

export interface LicenseRecord extends LicensePayload {
  name: string;
  policy_url: string;
  last_reviewed_at: string;
}

export interface SourceRecord extends SourcePayload {
  source_id: string;
  default_license_code: string;
}

export interface InternalContentItem {
  item_id: string;
  item_type: FeedItemPayload["item_type"];
  event_time: string;
  headline_generated: string;
  summary_generated?: string | null;
  external_url?: string | null;
  source_name: string;
  source_policy_url: string;
  license_code: string;
  commercial_status: CommercialStatus;
  attribution_text: string;
  disclaimer_text?: string;
  entity_slugs: string[];
  is_breaking: boolean;
  region: "US" | "EU" | "GLOBAL";
  meta: Record<string, unknown>;
}

export interface KeyIndicatorCard {
  series_id: string;
  title: string;
  latest_value: number;
  period: string;
  yoy: number;
  sparkline: number[];
  source: SourcePayload;
  license: LicensePayload;
}

export interface SeriesObservation {
  obs_date: string;
  value_raw: string;
  value_num: number | null;
  source_hash?: string;
}

export interface SeriesRecord {
  series_id: string;
  title: string;
  source: SourcePayload;
  license: LicensePayload;
  units: string;
  is_derived: boolean;
  raw_locked: boolean;
  observations: SeriesObservation[];
}

export interface FilingRecord {
  accession: string;
  cik: string;
  company_name: string;
  form_type: string;
  filed_at: string;
  accepted_at: string;
  sec_url: string;
  meta: Record<string, unknown>;
}

export interface PushSubscriptionRecord {
  subscription_id: string;
  user_id: string;
  endpoint_enc: string;
  endpoint_hash: string;
  p256dh_enc: string;
  auth_enc: string;
  enc_iv: string;
  filters: Record<string, unknown>;
  created_at: string;
  last_seen_at?: string;
}

export interface AlertRuleRecord {
  rule_id: string;
  user_id: string;
  enabled: boolean;
  rule_type: "breaking" | "entity" | "ticker" | "macro" | "filing_form";
  rule: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NotificationEventRecord {
  notification_id: string;
  user_id: string;
  item_id: string;
  created_at: string;
  payload: Record<string, unknown>;
  status: "queued" | "sent" | "failed";
}

export interface IngestQueueMessage {
  job: "INGEST_GDELT" | "INGEST_SEC" | "INGEST_MACRO" | "RECOMPUTE_DERIVED";
  run_id: string;
  params: Record<string, unknown>;
}

export interface PushQueueMessage {
  job: "PUSH_FANOUT_BREAKING";
  run_id: string;
  params: {
    limit?: number;
  };
}

export interface EntityRecord extends EntityPayload {
  entity_id: string;
  entity_type: "company" | "agency" | "country" | "index" | "topic";
}
