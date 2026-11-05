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
  /** Optional secret. Enables deletion of the Supabase Auth user in /api/account/delete. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_JWKS_URL?: string;
  SUPABASE_JWT_AUDIENCE?: string;
  SUPABASE_JWT_ISSUER?: string;
  SUPABASE_JWT_MAX_AGE_SECONDS?: string;
  ALLOWED_ORIGINS?: string;
  AUTH_ALLOWED_REDIRECT_ORIGINS?: string;
  ALLOW_MEMORY_READ_FALLBACK?: string;
  BEA_API_KEY?: string;
  EIA_API_KEY?: string;
  /** Optional BLS registration key (500 queries/day instead of 25). */
  BLS_API_KEY?: string;
  /** VAPID key pair (base64url, raw P-256) and contact for Web Push (RFC 8292). */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Retention windows in days (defaults: 90). */
  GDELT_RETENTION_DAYS?: string;
  NOTIFICATION_RETENTION_DAYS?: string;
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
  /** Stable public identifier usable in /api/series/:id. */
  series_code: string;
  title: string;
  units: string;
  is_derived: boolean;
  latest_value: number;
  /** ISO date (YYYY-MM-DD) of the latest observation. */
  period: string;
  /** % change vs. the observation one year earlier; null for series already expressed in %. */
  yoy: number | null;
  /** Latest minus previous observation, in `change_unit`. */
  change: number | null;
  /** "pp" (percentage points) for % series, otherwise the series units. */
  change_unit: string;
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
  endpoint_hash: string;
  endpoint_enc: string;
  endpoint_iv: string;
  p256dh_enc: string;
  p256dh_iv: string;
  auth_enc: string;
  auth_iv: string;
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

export type MacroSource = "BLS" | "EIA" | "ECB" | "FRB" | "BEA" | "EUROSTAT" | "OECD" | "WORLD_BANK";

export interface IngestQueueMessage {
  /**
   * INGEST_GDELT: all tracked companies, request-paced, in one message.
   * INGEST_SEC: params.cik. INGEST_MACRO: params.source (one source per message).
   * MAINTENANCE_RETENTION: deletes expired index items / notification events.
   * RECOMPUTE_DERIVED is retired (derived series are computed during ingest);
   * messages still in flight are acknowledged as no-ops.
   */
  job: "INGEST_GDELT" | "INGEST_SEC" | "INGEST_MACRO" | "MAINTENANCE_RETENTION" | "RECOMPUTE_DERIVED";
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
