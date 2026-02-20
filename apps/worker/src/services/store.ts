import type {
  AlertRuleRecord,
  EntityRecord,
  FilingRecord,
  InternalContentItem,
  KeyIndicatorCard,
  LicenseRecord,
  NotificationEventRecord,
  PushSubscriptionRecord,
  SeriesRecord,
  SourceRecord
} from "../types";
import type { FeedItemPayload } from "@ofp/shared";

function nowIso(): string {
  return new Date().toISOString();
}

function uuidLike(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const MAX_FALLBACK_CONTENT_ITEMS = 500;
const MAX_FALLBACK_PUSH_SUBSCRIPTIONS = 2000;
const MAX_FALLBACK_ALERT_RULES = 2000;
const MAX_FALLBACK_NOTIFICATION_EVENTS = 5000;

function trimToMax<T>(list: T[], max: number): void {
  if (list.length <= max) {
    return;
  }
  list.splice(0, list.length - max);
}

export class MemoryStore {
  private static singleton?: MemoryStore;

  readonly licenses: LicenseRecord[];
  readonly sources: SourceRecord[];
  readonly entities: EntityRecord[];
  readonly contentItems: InternalContentItem[];
  readonly keyIndicators: KeyIndicatorCard[];
  readonly series: SeriesRecord[];
  readonly filings: FilingRecord[];
  readonly pushSubscriptions: PushSubscriptionRecord[] = [];
  readonly alertRules: AlertRuleRecord[] = [];
  readonly notificationEvents: NotificationEventRecord[] = [];

  static get(): MemoryStore {
    if (!MemoryStore.singleton) {
      MemoryStore.singleton = new MemoryStore();
    }
    return MemoryStore.singleton;
  }

  private constructor() {
    const lastReviewed = "2026-02-16T00:00:00Z";
    this.licenses = [
      {
        code: "GDELT",
        name: "GDELT Project Terms",
        policy_url: "https://www.gdeltproject.org/about.html",
        commercial_status: "allowed",
        attribution_text: "Index data: GDELT (citation + link).",
        disclaimer_text: "Publisher content is not hosted on this site.",
        last_reviewed_at: lastReviewed
      },
      {
        code: "SEC_EDGAR",
        name: "SEC EDGAR Fair Access",
        policy_url: "https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data",
        commercial_status: "allowed",
        attribution_text: "Source: SEC EDGAR (official).",
        disclaimer_text: "Open SEC.gov for official filing text.",
        last_reviewed_at: lastReviewed
      },
      {
        code: "ECB_STATS",
        name: "ECB Statistics Reuse Policy",
        policy_url: "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html",
        commercial_status: "allowed",
        attribution_text: "Source: ECB statistics.",
        disclaimer_text: "Raw series are unmodified; derived values are separate.",
        last_reviewed_at: lastReviewed
      },
      {
        code: "EUROSTAT_CONDITIONAL",
        name: "Eurostat Conditional",
        policy_url: "https://ec.europa.eu/eurostat/help/copyright-notice",
        commercial_status: "conditional",
        attribution_text: "Source: Eurostat (subject to exceptions).",
        disclaimer_text: "Not shown in production until geo/license gates pass.",
        last_reviewed_at: lastReviewed
      },
      {
        code: "OECD_CONDITIONAL",
        name: "OECD Conditional",
        policy_url: "https://www.oecd.org/en/about/terms-conditions.html",
        commercial_status: "conditional",
        attribution_text: "Source: OECD (license review required).",
        disclaimer_text: "Blocked from production unless cleared.",
        last_reviewed_at: lastReviewed
      },
      {
        code: "WORLD_BANK_CONDITIONAL",
        name: "World Bank Conditional",
        policy_url: "https://datacatalog.worldbank.org/public-licenses",
        commercial_status: "conditional",
        attribution_text: "Source: World Bank Data (license review required).",
        disclaimer_text: "Blocked from production unless cleared.",
        last_reviewed_at: lastReviewed
      },
      {
        code: "FRED_DISALLOWED",
        name: "FRED Disallowed",
        policy_url: "https://fred.stlouisfed.org/legal/",
        commercial_status: "disallowed",
        attribution_text: "View on FRED",
        disclaimer_text: "FRED data is blocked in production.",
        last_reviewed_at: lastReviewed
      }
    ];

    this.sources = [
      {
        source_id: "src-gdelt",
        name: "GDELT",
        policy_url: "https://www.gdeltproject.org/about.html",
        default_license_code: "GDELT"
      },
      {
        source_id: "src-sec",
        name: "SEC EDGAR",
        policy_url: "https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data",
        default_license_code: "SEC_EDGAR"
      },
      {
        source_id: "src-ecb",
        name: "ECB",
        policy_url: "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html",
        default_license_code: "ECB_STATS"
      }
    ];

    this.entities = [
      {
        entity_id: "ent-nvda",
        slug: "nvidia",
        entity_type: "company",
        name: "NVIDIA",
        primary_ticker: "NVDA"
      },
      {
        entity_id: "ent-sec",
        slug: "sec",
        entity_type: "agency",
        name: "U.S. Securities and Exchange Commission",
        primary_ticker: null
      },
      {
        entity_id: "ent-ecb",
        slug: "ecb",
        entity_type: "agency",
        name: "European Central Bank",
        primary_ticker: null
      }
    ];

    const now = Date.now();
    this.contentItems = [
      {
        item_id: "itm-gdelt-1",
        item_type: "gdelt_link",
        event_time: new Date(now - 1000 * 60 * 10).toISOString(),
        headline_generated: "NVIDIA index activity (10-minute): 84 mentions",
        summary_generated: "Detected via index metadata. Open original sources for full coverage.",
        external_url: "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5",
        source_name: "GDELT",
        source_policy_url: "https://www.gdeltproject.org/about.html",
        license_code: "GDELT",
        commercial_status: "allowed",
        attribution_text: "Index data: GDELT (citation + link).",
        disclaimer_text: "Publisher content is not hosted on this site.",
        entity_slugs: ["nvidia"],
        is_breaking: true,
        region: "GLOBAL",
        meta: {
          query: "NVIDIA",
          mention_count: 84,
          source_count: 3,
          window: "6h",
          score: 0.84
        }
      },
      {
        item_id: "itm-sec-1",
        item_type: "sec_filing",
        event_time: new Date(now - 1000 * 60 * 30).toISOString(),
        headline_generated: "[Filing] NVIDIA 8-K filed",
        summary_generated: "Filed recently. Open SEC.gov for the official document.",
        external_url:
          "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/nvda-20260216x8k.htm",
        source_name: "SEC EDGAR",
        source_policy_url: "https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data",
        license_code: "SEC_EDGAR",
        commercial_status: "allowed",
        attribution_text: "Source: SEC EDGAR (official).",
        disclaimer_text: "Open SEC.gov for official filing text.",
        entity_slugs: ["nvidia", "sec"],
        is_breaking: true,
        region: "US",
        meta: { form_type: "8-K", accession: "0001045810-26-000010" }
      },
      {
        item_id: "itm-macro-1",
        item_type: "macro_update",
        event_time: new Date(now - 1000 * 60 * 90).toISOString(),
        headline_generated: "Euro area HICP YoY updated",
        summary_generated: "Derived YoY value updated from ECB raw series.",
        external_url: "https://www.ecb.europa.eu/stats/",
        source_name: "ECB",
        source_policy_url: "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html",
        license_code: "ECB_STATS",
        commercial_status: "allowed",
        attribution_text: "Source: ECB statistics.",
        disclaimer_text: "Raw series are unmodified; derived values are separate.",
        entity_slugs: ["ecb"],
        is_breaking: false,
        region: "EU",
        meta: { series: "EU_HICP_YOY", raw_locked: true }
      }
    ];

    this.keyIndicators = [
      {
        series_id: "US_CPI_YOY",
        title: "US CPI YoY",
        latest_value: 2.7,
        period: "2026-01",
        yoy: 2.7,
        sparkline: [2.5, 2.4, 2.6, 2.8, 2.7, 2.7],
        source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
        license: {
          code: "BLS_PUBLIC",
          commercial_status: "allowed",
          attribution_text: "Source: BLS.",
          disclaimer_text: "Official source data."
        }
      },
      {
        series_id: "US_UNEMPLOYMENT_RATE",
        title: "US Unemployment Rate",
        latest_value: 3.9,
        period: "2026-01",
        yoy: -0.2,
        sparkline: [4.1, 4.0, 4.0, 3.9, 3.9, 3.9],
        source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
        license: {
          code: "BLS_PUBLIC",
          commercial_status: "allowed",
          attribution_text: "Source: BLS.",
          disclaimer_text: "Official source data."
        }
      },
      {
        series_id: "US_NONFARM_PAYROLLS",
        title: "US Nonfarm Payrolls",
        latest_value: 159820,
        period: "2026-01",
        yoy: 1.2,
        sparkline: [158920, 159040, 159180, 159410, 159620, 159820],
        source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
        license: {
          code: "BLS_PUBLIC",
          commercial_status: "allowed",
          attribution_text: "Source: BLS.",
          disclaimer_text: "Official source data."
        }
      },
      {
        series_id: "US_AVG_HOURLY_EARNINGS",
        title: "US Avg Hourly Earnings",
        latest_value: 35.5,
        period: "2026-01",
        yoy: 3.2,
        sparkline: [34.6, 34.8, 35, 35.1, 35.3, 35.5],
        source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
        license: {
          code: "BLS_PUBLIC",
          commercial_status: "allowed",
          attribution_text: "Source: BLS.",
          disclaimer_text: "Official source data."
        }
      },
      {
        series_id: "US_GDP_QOQ",
        title: "US GDP QoQ",
        latest_value: 0.6,
        period: "2025-Q4",
        yoy: 2.1,
        sparkline: [0.2, 0.3, 0.5, 0.7, 0.6, 0.6],
        source: { name: "BEA", policy_url: "https://apps.bea.gov/API/docs/index.htm" },
        license: {
          code: "BEA_PUBLIC",
          commercial_status: "allowed",
          attribution_text: "Source: BEA.",
          disclaimer_text: "Official source data."
        }
      },
      {
        series_id: "US_EIA_CRUDE_STOCKS",
        title: "US Crude Stocks",
        latest_value: 430.5,
        period: "2026-W06",
        yoy: 1.3,
        sparkline: [427, 428, 426, 429, 431, 430.5],
        source: { name: "EIA", policy_url: "https://www.eia.gov/opendata/" },
        license: {
          code: "EIA_PUBLIC",
          commercial_status: "allowed",
          attribution_text: "Source: EIA.",
          disclaimer_text: "Official source data."
        }
      },
      {
        series_id: "US_TREASURY_10Y",
        title: "US 10Y Treasury Yield",
        latest_value: 4.1,
        period: "2026-02",
        yoy: -0.4,
        sparkline: [4.6, 4.5, 4.4, 4.3, 4.2, 4.1],
        source: {
          name: "Federal Reserve Board",
          policy_url: "https://www.federalreserve.gov/releases/h15/"
        },
        license: {
          code: "FRB_PUBLIC",
          commercial_status: "allowed",
          attribution_text: "Source: Federal Reserve Board.",
          disclaimer_text: "Official source data."
        }
      },
      {
        series_id: "EU_HICP_YOY",
        title: "EU HICP YoY",
        latest_value: 2.3,
        period: "2026-01",
        yoy: 2.3,
        sparkline: [2.8, 2.7, 2.6, 2.5, 2.4, 2.3],
        source: {
          name: "ECB",
          policy_url: "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html"
        },
        license: {
          code: "ECB_STATS",
          commercial_status: "allowed",
          attribution_text: "Source: ECB statistics.",
          disclaimer_text: "Raw series are unmodified; derived values are separate."
        }
      }
    ];

    this.series = [
      {
        series_id: "EU_HICP_RAW",
        title: "EU HICP Raw",
        source: {
          name: "ECB",
          policy_url: "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html"
        },
        license: {
          code: "ECB_STATS",
          commercial_status: "allowed",
          attribution_text: "Source: ECB statistics."
        },
        units: "index",
        is_derived: false,
        raw_locked: true,
        observations: [
          { obs_date: "2025-11-01", value_raw: "121.1", value_num: 121.1, source_hash: "h1" },
          { obs_date: "2025-12-01", value_raw: "121.4", value_num: 121.4, source_hash: "h2" },
          { obs_date: "2026-01-01", value_raw: "121.8", value_num: 121.8, source_hash: "h3" }
        ]
      },
      {
        series_id: "EU_HICP_YOY",
        title: "EU HICP YoY",
        source: {
          name: "ECB",
          policy_url: "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html"
        },
        license: {
          code: "ECB_STATS",
          commercial_status: "allowed",
          attribution_text: "Source: ECB statistics."
        },
        units: "%",
        is_derived: true,
        raw_locked: false,
        observations: [
          { obs_date: "2025-11-01", value_raw: "2.8", value_num: 2.8 },
          { obs_date: "2025-12-01", value_raw: "2.5", value_num: 2.5 },
          { obs_date: "2026-01-01", value_raw: "2.3", value_num: 2.3 }
        ]
      }
    ];

    this.filings = [
      {
        accession: "0001045810-26-000010",
        cik: "0001045810",
        company_name: "NVIDIA CORP",
        form_type: "8-K",
        filed_at: "2026-02-16T01:15:00Z",
        accepted_at: "2026-02-16T01:22:00Z",
        sec_url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/",
        meta: {
          primary_document:
            "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/nvda-20260216x8k.htm"
        }
      }
    ];
  }

  mapToFeedPayload(item: InternalContentItem): FeedItemPayload {
    const relatedEntities = this.entities.filter((entity) => item.entity_slugs.includes(entity.slug));
    return {
      item_id: item.item_id,
      item_type: item.item_type,
      event_time: item.event_time,
      headline: item.headline_generated,
      summary: item.summary_generated ?? null,
      meta: item.meta,
      external_url: item.external_url ?? null,
      entities: relatedEntities.map((entity) => ({
        slug: entity.slug,
        name: entity.name,
        primary_ticker: entity.primary_ticker ?? undefined
      })),
      source: {
        name: item.source_name,
        policy_url: item.source_policy_url
      },
      license: {
        code: item.license_code,
        commercial_status: item.commercial_status,
        attribution_text: item.attribution_text,
        disclaimer_text: item.disclaimer_text
      }
    };
  }

  listFeed(tab: "breaking" | "filings" | "macro" | "newsindex", query?: string, region?: string): FeedItemPayload[] {
    const byTab = this.contentItems.filter((item) => {
      switch (tab) {
        case "breaking":
          return item.is_breaking;
        case "filings":
          return item.item_type === "sec_filing" || item.item_type === "fact_flash";
        case "macro":
          return item.item_type === "macro_update";
        case "newsindex":
          return item.item_type === "gdelt_link";
      }
    });

    const byRegion = byTab.filter((item) => {
      if (!region || region === "GLOBAL") {
        return true;
      }
      return item.region === region || item.region === "GLOBAL";
    });

    const needle = query?.trim().toLowerCase() ?? "";
    const byQuery = byRegion.filter((item) => {
      if (!needle) {
        return true;
      }
      const entityMatched = item.entity_slugs.some((slug) => {
        const entity = this.entities.find((candidate) => candidate.slug === slug);
        const name = entity?.name.toLowerCase() ?? "";
        const ticker = entity?.primary_ticker?.toLowerCase() ?? "";
        return slug.toLowerCase().includes(needle) || name.includes(needle) || ticker.includes(needle);
      });

      return (
        item.headline_generated.toLowerCase().includes(needle) ||
        (item.summary_generated?.toLowerCase() ?? "").includes(needle) ||
        item.source_name.toLowerCase().includes(needle) ||
        entityMatched
      );
    });

    return byQuery.sort((a, b) => b.event_time.localeCompare(a.event_time)).map((item) => this.mapToFeedPayload(item));
  }

  getEntity(slug: string): EntityRecord | undefined {
    return this.entities.find((entity) => entity.slug === slug);
  }

  listEntityFeed(slug: string): FeedItemPayload[] {
    return this.contentItems
      .filter((item) => item.entity_slugs.includes(slug))
      .sort((a, b) => b.event_time.localeCompare(a.event_time))
      .map((item) => this.mapToFeedPayload(item));
  }

  getSeries(seriesId: string, mode: "raw" | "derived"): SeriesRecord | undefined {
    return this.series.find((series) => series.series_id === seriesId && (mode === "derived" ? series.is_derived : !series.is_derived));
  }

  getFiling(accession: string): FilingRecord | undefined {
    return this.filings.find((filing) => filing.accession === accession);
  }

  upsertPushSubscription(record: Omit<PushSubscriptionRecord, "subscription_id" | "created_at">): PushSubscriptionRecord {
    const existing = this.pushSubscriptions.find(
      (item) => item.user_id === record.user_id && item.endpoint_hash === record.endpoint_hash
    );

    if (existing) {
      existing.endpoint_enc = record.endpoint_enc;
      existing.p256dh_enc = record.p256dh_enc;
      existing.auth_enc = record.auth_enc;
      existing.enc_iv = record.enc_iv;
      existing.filters = record.filters;
      existing.last_seen_at = nowIso();
      return existing;
    }

    const created: PushSubscriptionRecord = {
      subscription_id: uuidLike("sub"),
      created_at: nowIso(),
      ...record
    };
    this.pushSubscriptions.push(created);
    trimToMax(this.pushSubscriptions, MAX_FALLBACK_PUSH_SUBSCRIPTIONS);
    return created;
  }

  removePushSubscription(userId: string, endpointHash: string): boolean {
    const originalLength = this.pushSubscriptions.length;
    const filtered = this.pushSubscriptions.filter(
      (subscription) => !(subscription.user_id === userId && subscription.endpoint_hash === endpointHash)
    );
    this.pushSubscriptions.length = 0;
    this.pushSubscriptions.push(...filtered);
    return filtered.length !== originalLength;
  }

  listPushSubscriptions(userId?: string): PushSubscriptionRecord[] {
    if (!userId) {
      return [...this.pushSubscriptions];
    }
    return this.pushSubscriptions.filter((subscription) => subscription.user_id === userId);
  }

  listPushUserIds(): string[] {
    return [...new Set(this.pushSubscriptions.map((subscription) => subscription.user_id))];
  }

  listAlertRules(userId: string): AlertRuleRecord[] {
    return this.alertRules.filter((rule) => rule.user_id === userId);
  }

  saveAlertRule(
    userId: string,
    input: Pick<AlertRuleRecord, "rule_type" | "rule" | "enabled"> & { rule_id?: string }
  ): AlertRuleRecord {
    const now = nowIso();
    if (input.rule_id) {
      const existing = this.alertRules.find((rule) => rule.rule_id === input.rule_id && rule.user_id === userId);
      if (!existing) {
        throw new Error("Rule not found for user.");
      }
      existing.enabled = input.enabled;
      existing.rule_type = input.rule_type;
      existing.rule = input.rule;
      existing.updated_at = now;
      return existing;
    }

    const created: AlertRuleRecord = {
      rule_id: uuidLike("rule"),
      user_id: userId,
      enabled: input.enabled,
      rule_type: input.rule_type,
      rule: input.rule,
      created_at: now,
      updated_at: now
    };
    this.alertRules.push(created);
    trimToMax(this.alertRules, MAX_FALLBACK_ALERT_RULES);
    return created;
  }

  registerNotificationEvent(userId: string, itemId: string, payload: Record<string, unknown>): NotificationEventRecord | null {
    const duplicated = this.notificationEvents.find((event) => event.user_id === userId && event.item_id === itemId);
    if (duplicated) {
      return null;
    }

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const countLastHour = this.notificationEvents.filter((event) => {
      return event.user_id === userId && new Date(event.created_at).getTime() >= oneHourAgo;
    }).length;

    if (countLastHour >= 10) {
      return null;
    }

    const created: NotificationEventRecord = {
      notification_id: uuidLike("notif"),
      user_id: userId,
      item_id: itemId,
      created_at: nowIso(),
      payload,
      status: "queued"
    };
    this.notificationEvents.push(created);
    trimToMax(this.notificationEvents, MAX_FALLBACK_NOTIFICATION_EVENTS);
    return created;
  }

  setNotificationStatus(notificationId: string, status: NotificationEventRecord["status"]): void {
    const event = this.notificationEvents.find((candidate) => candidate.notification_id === notificationId);
    if (!event) {
      return;
    }
    event.status = status;
  }

  listNotificationEvents(userId?: string): NotificationEventRecord[] {
    if (!userId) {
      return [...this.notificationEvents];
    }
    return this.notificationEvents.filter((event) => event.user_id === userId);
  }

  appendContentItem(item: InternalContentItem): void {
    this.contentItems.push(item);
    trimToMax(this.contentItems, MAX_FALLBACK_CONTENT_ITEMS);
  }
}
