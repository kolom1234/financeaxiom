import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { FeedItemPayload } from "@ofp/shared";
import { getFeed, getIndicators, type FeedTab } from "../lib/api";
import { AdSlot } from "../components/AdSlot";
import { IndicatorMatrix } from "../components/IndicatorMatrix";
import { LicenseBadge } from "../components/LicenseBadge";
import { RightPanelIndicators } from "../components/RightPanelIndicators";
import { SourceBadge } from "../components/SourceBadge";
import { buildGdeltDisplayMeta } from "../lib/gdeltDisplay";
import { buildGdeltSourcePreviewUrl, resolveOpenSourceUrl } from "../lib/feedLinks";

const tabs: readonly FeedTab[] = ["breaking", "filings", "macro", "newsindex"];

type Tab = (typeof tabs)[number];
type IndicatorCard = {
  series_id: string;
  title: string;
  latest_value: number;
  period: string;
  yoy: number;
  sparkline: number[];
  source: { name: string; policy_url?: string };
  license: { code?: string; attribution_text: string };
};

type FeedByTab = Record<Tab, FeedItemPayload[]>;

const TAB_LABEL: Record<Tab, string> = {
  breaking: "Breaking",
  filings: "Filings",
  macro: "Macro",
  newsindex: "News Index"
};

const ITEM_TYPE_LABEL: Record<FeedItemPayload["item_type"], string> = {
  gdelt_link: "Index Signal",
  sec_filing: "SEC Filing",
  macro_update: "Macro Update",
  fact_flash: "Fact Flash",
  analysis: "Analysis"
};
const FEED_ITEMS_PER_PAGE = 10;
const MAX_PAGINATION_LINKS = 7;

function createEmptyFeedByTab(): FeedByTab {
  return {
    breaking: [],
    filings: [],
    macro: [],
    newsindex: []
  };
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return "just now";
  }

  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) {
    return "n/a";
  }

  const deltaMs = target - Date.now();
  const abs = Math.abs(deltaMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (abs < 60_000) {
    return rtf.format(Math.round(deltaMs / 1000), "second");
  }
  if (abs < 3_600_000) {
    return rtf.format(Math.round(deltaMs / 60_000), "minute");
  }
  if (abs < 86_400_000) {
    return rtf.format(Math.round(deltaMs / 3_600_000), "hour");
  }
  return rtf.format(Math.round(deltaMs / 86_400_000), "day");
}

function formatSyncClock(iso: string | null): string {
  if (!iso) {
    return "not yet synced";
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return "not yet synced";
  }
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function shorten(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setParallax(event: PointerEvent<HTMLElement>): void {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  event.currentTarget.style.setProperty("--tilt-x", String(x * 8));
  event.currentTarget.style.setProperty("--tilt-y", String(y * -8));
}

function clearParallax(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.style.setProperty("--tilt-x", "0");
  event.currentTarget.style.setProperty("--tilt-y", "0");
}

export function HomePage(): JSX.Element {
  const [tab, setTab] = useState<Tab>("breaking");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [feedPage, setFeedPage] = useState(1);

  const [feedByTab, setFeedByTab] = useState<FeedByTab>(createEmptyFeedByTab);
  const [activeFeed, setActiveFeed] = useState<FeedItemPayload[]>([]);
  const [loadingActive, setLoadingActive] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(true);

  const [indicatorCards, setIndicatorCards] = useState<IndicatorCard[]>([]);
  const [indicatorGeneratedAt, setIndicatorGeneratedAt] = useState<string | null>(null);
  const [indicatorsStale, setIndicatorsStale] = useState(false);

  const [activeFeedStale, setActiveFeedStale] = useState(false);
  const [overviewStale, setOverviewStale] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 240);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const timer = window.setInterval(() => {
      setRefreshSignal((current) => current + 1);
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefresh]);

  useEffect(() => {
    let active = true;
    setLoadingOverview(true);

    void Promise.all([
      getFeed("breaking"),
      getFeed("filings"),
      getFeed("macro"),
      getFeed("newsindex"),
      getIndicators()
    ]).then(([breaking, filings, macro, newsindex, indicators]) => {
      if (!active) {
        return;
      }

      setFeedByTab({
        breaking: breaking.items,
        filings: filings.items,
        macro: macro.items,
        newsindex: newsindex.items
      });

      setOverviewStale(breaking.stale || filings.stale || macro.stale || newsindex.stale);
      setIndicatorCards(indicators.cards);
      setIndicatorGeneratedAt(indicators.meta.generated_at ?? null);
      setIndicatorsStale(indicators.stale);
      setLastSyncedAt(new Date().toISOString());
      setLoadingOverview(false);
    });

    return () => {
      active = false;
    };
  }, [refreshSignal]);

  useEffect(() => {
    let active = true;
    setLoadingActive(true);

    void getFeed(tab, { query: debouncedQuery }).then((result) => {
      if (!active) {
        return;
      }

      setActiveFeed(result.items);
      setActiveFeedStale(result.stale);
      setLastSyncedAt(new Date().toISOString());
      setLoadingActive(false);
    });

    return () => {
      active = false;
    };
  }, [tab, debouncedQuery, refreshSignal]);

  const allItems = useMemo(() => {
    const merged = [...tabs.flatMap((entry) => feedByTab[entry]), ...activeFeed];
    const byId = new Map<string, FeedItemPayload>();

    for (const item of merged) {
      const existing = byId.get(item.item_id);
      if (!existing || item.event_time > existing.event_time) {
        byId.set(item.item_id, item);
      }
    }

    return [...byId.values()].sort((left, right) => right.event_time.localeCompare(left.event_time));
  }, [activeFeed, feedByTab]);

  const tickerItems = useMemo(() => allItems.slice(0, 16), [allItems]);

  const sourceDigest = useMemo(() => {
    const digest = new Map<
      string,
      {
        sourceName: string;
        count: number;
        latestEvent: string;
        tabs: Set<Tab>;
      }
    >();

    for (const currentTab of tabs) {
      for (const item of feedByTab[currentTab]) {
        const key = item.source.name;
        const existing = digest.get(key);
        if (!existing) {
          digest.set(key, {
            sourceName: item.source.name,
            count: 1,
            latestEvent: item.event_time,
            tabs: new Set<Tab>([currentTab])
          });
          continue;
        }

        existing.count += 1;
        if (item.event_time > existing.latestEvent) {
          existing.latestEvent = item.event_time;
        }
        existing.tabs.add(currentTab);
      }
    }

    return [...digest.values()]
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return right.latestEvent.localeCompare(left.latestEvent);
      })
      .map((entry) => ({
        ...entry,
        tabLabels: [...entry.tabs].map((tabName) => TAB_LABEL[tabName]).join(" / ")
      }));
  }, [feedByTab]);

  const feedStats = useMemo(() => {
    const indicatorCount = indicatorCards.length;
    const avgYoy =
      indicatorCount === 0
        ? 0
        : indicatorCards.reduce((sum, card) => sum + Number(card.yoy || 0), 0) / Math.max(indicatorCount, 1);
    const positiveRatio =
      indicatorCount === 0
        ? 0
        : (indicatorCards.filter((card) => Number(card.yoy) >= 0).length / indicatorCount) * 100;

    return {
      totalEvents: allItems.length,
      sourceCount: sourceDigest.length,
      filingCount: allItems.filter((item) => item.item_type === "sec_filing" || item.item_type === "fact_flash").length,
      macroCount: allItems.filter((item) => item.item_type === "macro_update").length,
      avgYoy,
      positiveRatio
    };
  }, [allItems, indicatorCards, sourceDigest.length]);

  const precisionStats = useMemo(() => {
    const latestEventIso = allItems[0]?.event_time ?? null;
    const latestEventMs = latestEventIso ? new Date(latestEventIso).getTime() : Number.NaN;
    const syncMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : Number.NaN;

    const freshnessMinutes =
      Number.isFinite(latestEventMs) && Number.isFinite(syncMs)
        ? Math.max(0, (syncMs - latestEventMs) / 60_000)
        : Number.NaN;
    const freshnessScore = Number.isFinite(freshnessMinutes)
      ? clamp(100 - freshnessMinutes * 6, 8, 100)
      : 42;

    const licensedCount = allItems.filter((item) => item.license.commercial_status === "allowed").length;
    const complianceRatio = allItems.length > 0 ? (licensedCount / allItems.length) * 100 : 100;

    const sourceEntropyBase = sourceDigest.reduce((sum, entry) => sum + entry.count, 0);
    const sourceConcentration =
      sourceEntropyBase > 0
        ? sourceDigest.reduce((sum, entry) => {
            const p = entry.count / sourceEntropyBase;
            return sum + p * p;
          }, 0)
        : 1;
    const diversityScore = clamp((1 - sourceConcentration) * 160, 6, 100);

    const cadenceMinutes =
      allItems.length >= 2
        ? Math.max(
            0,
            (new Date(allItems[0]?.event_time ?? 0).getTime() - new Date(allItems[1]?.event_time ?? 0).getTime()) / 60_000
          )
        : Number.NaN;
    const cadenceScore = Number.isFinite(cadenceMinutes) ? clamp(100 - cadenceMinutes * 8, 10, 100) : 36;

    return {
      freshnessScore,
      complianceRatio,
      diversityScore,
      cadenceScore,
      freshnessMinutes
    };
  }, [allItems, lastSyncedAt, sourceDigest]);

  const tabCards = useMemo(
    () =>
      tabs.map((entry) => {
        const items = feedByTab[entry];
        const latest = items[0];
        const latestGdelt = latest?.item_type === "gdelt_link" ? buildGdeltDisplayMeta(latest) : null;
        return (
          <article key={entry} className="coverage-card glass-panel reveal-item">
            <p className="coverage-kicker">{TAB_LABEL[entry]}</p>
            <p className="coverage-value">{items.length}</p>
            <p className="coverage-meta">{latest ? formatRelativeTime(latest.event_time) : "No recent events"}</p>
            <p className="coverage-headline">
              {latest
                ? latestGdelt
                  ? shorten(latestGdelt.title, 52)
                  : shorten(latest.headline, 86)
                : "Awaiting first update."}
            </p>
            {latestGdelt ? <p className="coverage-meta">{latestGdelt.compactMeta}</p> : null}
          </article>
        );
      }),
    [feedByTab]
  );

  const tabButtons = useMemo(
    () =>
      tabs.map((item) => (
        <button key={item} type="button" className={`tab-btn ${item === tab ? "active" : ""}`} onClick={() => setTab(item)}>
          <span>{TAB_LABEL[item]}</span>
          <span className="tab-count">{feedByTab[item].length}</span>
        </button>
      )),
    [feedByTab, tab]
  );

  const inFallbackMode = activeFeedStale || overviewStale || indicatorsStale;

  const totalFeedPages = useMemo(
    () => Math.max(1, Math.ceil(activeFeed.length / FEED_ITEMS_PER_PAGE)),
    [activeFeed.length]
  );

  useEffect(() => {
    setFeedPage(1);
  }, [tab, debouncedQuery]);

  useEffect(() => {
    if (feedPage > totalFeedPages) {
      setFeedPage(1);
    }
  }, [feedPage, totalFeedPages]);

  const paginatedActiveFeed = useMemo(() => {
    const start = (feedPage - 1) * FEED_ITEMS_PER_PAGE;
    return activeFeed.slice(start, start + FEED_ITEMS_PER_PAGE);
  }, [activeFeed, feedPage]);

  const pageRangeStart = (feedPage - 1) * FEED_ITEMS_PER_PAGE + 1;
  const pageRangeEnd = Math.min(feedPage * FEED_ITEMS_PER_PAGE, activeFeed.length);

  const handlePageChange = (page: number) => {
    setFeedPage((current) => {
      if (page < 1) {
        return 1;
      }
      if (page > totalFeedPages) {
        return totalFeedPages;
      }
      if (page === current) {
        return current;
      }
      return page;
    });
  };

  const pageButtons = useMemo<(number | "...")[]>(() => {
    if (totalFeedPages <= MAX_PAGINATION_LINKS) {
      return Array.from({ length: totalFeedPages }, (_, index) => index + 1);
    }

    const buttons: (number | "...")[] = [1];
    const start = Math.max(2, Math.min(feedPage - 2, totalFeedPages - MAX_PAGINATION_LINKS + 1));
    const end = Math.min(totalFeedPages - 1, start + 3);

    if (start > 2) {
      buttons.push("...");
    }

    for (let i = start; i <= end; i += 1) {
      buttons.push(i);
    }

    if (end < totalFeedPages - 1) {
      buttons.push("...");
    }

    buttons.push(totalFeedPages);
    return buttons;
  }, [feedPage, totalFeedPages]);

  return (
    <section className="home-grid home-grid-premium">
      <article className="feed-column">
        <header className="feed-header glass-panel premium-shell reveal-item">
          <div className="feed-header-top">
            <div>
              <h1>Market Pulse Feed</h1>
              <p className="muted-copy">Live, license-safe market intelligence from filings, macro releases, and index signals.</p>
            </div>
            <div className="header-actions">
              <button type="button" className="btn btn-primary" onClick={() => setRefreshSignal((current) => current + 1)}>
                Refresh Now
              </button>
              <label className="auto-refresh-toggle">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(event) => setAutoRefresh(event.target.checked)}
                  aria-label="Enable 60-second auto refresh"
                />
                Auto 60s
              </label>
            </div>
          </div>

          <div className="status-ribbon" aria-live="polite">
            <span className={`live-chip ${inFallbackMode ? "degraded" : "live"}`}>
              {inFallbackMode ? "Fallback Snapshot" : "Live API Sync"}
            </span>
            <span className="status-pill">Last sync {formatSyncClock(lastSyncedAt)}</span>
            <span className="status-pill">View {activeFeed.length} events</span>
            <span className="status-pill">Indicators {indicatorCards.length}</span>
          </div>

          <div className="feed-controls">
            <label className="search-shell" htmlFor="feedSearchInput">
              <span className="search-label">Search headlines</span>
              <input
                id="feedSearchInput"
                className="search-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by entity, source, or topic"
              />
            </label>
            <div className="tab-row" role="tablist" aria-label="Feed tabs">
              {tabButtons}
            </div>
          </div>
        </header>

        {inFallbackMode ? (
          <aside className="system-banner glass-panel" aria-live="polite">
            Live API is temporarily unavailable. Rendering validated fallback snapshots until connectivity recovers.
          </aside>
        ) : null}

        <section className="ticker-shell glass-panel" aria-label="Real-time headline ticker">
          {tickerItems.length > 0 ? (
            <div className="ticker-track">
              {[...tickerItems, ...tickerItems].map((item, index) => (
                <span key={`${item.item_id}-${index}`} className="ticker-item">
                  <strong>{item.source.name}</strong>
                  <span>{item.item_type === "gdelt_link" ? buildGdeltDisplayMeta(item).title : item.headline}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="muted-copy">Waiting for realtime signals.</p>
          )}
        </section>

        <section className="coverage-grid" aria-label="Coverage snapshot">
          {tabCards}
        </section>

        <section className="precision-deck glass-panel reveal-item" aria-label="Signal precision dashboard">
          <header className="precision-header">
            <div>
              <p className="panel-kicker">Precision Layer</p>
              <h2>Realtime Integrity Surface</h2>
            </div>
            <p className="muted-copy">
              Freshness{" "}
              {Number.isFinite(precisionStats.freshnessMinutes)
                ? `${precisionStats.freshnessMinutes.toFixed(1)}m lag`
                : "n/a"}
            </p>
          </header>
          <div className="precision-grid">
            <article className="precision-card">
              <div className="precision-ring" style={{ "--ring-progress": `${precisionStats.freshnessScore}%` } as CSSProperties}>
                <span>{precisionStats.freshnessScore.toFixed(0)}</span>
              </div>
              <h3>Freshness</h3>
              <p className="muted-copy">Weighted from event lag and sync latency.</p>
            </article>
            <article className="precision-card">
              <div className="precision-ring" style={{ "--ring-progress": `${precisionStats.complianceRatio}%` } as CSSProperties}>
                <span>{precisionStats.complianceRatio.toFixed(0)}</span>
              </div>
              <h3>License Safety</h3>
              <p className="muted-copy">Allowed-license ratio in current visible stream.</p>
            </article>
            <article className="precision-card">
              <div className="precision-ring" style={{ "--ring-progress": `${precisionStats.diversityScore}%` } as CSSProperties}>
                <span>{precisionStats.diversityScore.toFixed(0)}</span>
              </div>
              <h3>Source Diversity</h3>
              <p className="muted-copy">Distribution quality across active source mix.</p>
            </article>
            <article className="precision-card">
              <div className="precision-ring" style={{ "--ring-progress": `${precisionStats.cadenceScore}%` } as CSSProperties}>
                <span>{precisionStats.cadenceScore.toFixed(0)}</span>
              </div>
              <h3>Update Cadence</h3>
              <p className="muted-copy">Recency pace between top-ranked events.</p>
            </article>
          </div>
        </section>

        <IndicatorMatrix cards={indicatorCards} stale={indicatorsStale} />

        {loadingActive ? <p className="muted-copy">Loading feed...</p> : null}

        {!loadingActive && activeFeed.length === 0 ? (
          <article className="glass-panel empty-feed-state">
            <h2>No events matched this view.</h2>
            <p className="muted-copy">Try another tab or clear the search filter.</p>
          </article>
        ) : null}

        <ul className="feed-list" aria-label="Feed list">
          {paginatedActiveFeed.map((item, index) => (
            <li
              key={item.item_id}
              className="feed-card glass-panel reveal-item"
              style={{ "--stagger-index": index } as CSSProperties}
              onPointerMove={setParallax}
              onPointerLeave={clearParallax}
            >
              <div className="feed-topline">
                <SourceBadge source={item.source} />
                <LicenseBadge license={item.license} />
                <span className="type-chip">{ITEM_TYPE_LABEL[item.item_type]}</span>
                <time className="event-clock" dateTime={item.event_time}>
                  {formatRelativeTime(item.event_time)}
                </time>
              </div>
              {(() => {
                if (item.item_type === "gdelt_link") {
                  const gdeltMeta = buildGdeltDisplayMeta(item);
                  return (
                    <>
                      <h2 className="feed-headline">{gdeltMeta.title}</h2>
                      <p className="feed-summary gdelt-summary">{gdeltMeta.compactMeta}</p>
                    </>
                  );
                }

                return (
                  <>
                    <h2 className="feed-headline">{item.headline}</h2>
                    <p className="feed-summary">
                      {item.summary ?? "Metadata update available. Open source for full context."}
                    </p>
                  </>
                );
              })()}

              {item.entities.length > 0 ? (
                <ul className="entity-chip-row" aria-label="Related entities">
                  {item.entities.map((entity) => (
                    <li key={`${item.item_id}-${entity.slug}`} className="entity-chip">
                      {entity.name}
                      {entity.primary_ticker ? <span className="entity-ticker">{entity.primary_ticker}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {(() => {
                const openSourceUrl =
                  item.item_type === "gdelt_link" ? buildGdeltSourcePreviewUrl(item) : resolveOpenSourceUrl(item);
                if (openSourceUrl) {
                  return (
                    <a href={openSourceUrl} target="_blank" rel="noopener noreferrer" className="external-link">
                      Open source
                    </a>
                  );
                }
                return <span className="external-link disabled">Open source unavailable</span>;
              })()}
              <p className="feed-footnote">{item.license.attribution_text}</p>
            </li>
          ))}
        </ul>
        {!loadingActive && activeFeed.length > FEED_ITEMS_PER_PAGE ? (
          <nav className="feed-pagination" aria-label="Feed pages">
            <button
              type="button"
              className="pagination-btn"
              onClick={() => handlePageChange(feedPage - 1)}
              disabled={feedPage === 1}
              aria-label="Previous page"
            >
              ◀ Prev
            </button>
            <div className="pagination-pages">
              {pageButtons.map((page, index) => (
                page === "..."
                  ? (
                    <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                      …
                    </span>
                  )
                  : (
                    <button
                      key={page}
                      type="button"
                      className={`pagination-btn ${page === feedPage ? "is-active" : ""}`}
                      onClick={() => handlePageChange(page)}
                      aria-current={page === feedPage ? "page" : undefined}
                    >
                      {page}
                    </button>
                  )
              ))}
            </div>
            <button
              type="button"
              className="pagination-btn"
              onClick={() => handlePageChange(feedPage + 1)}
              disabled={feedPage === totalFeedPages}
              aria-label="Next page"
            >
              Next ▶
            </button>
          </nav>
        ) : null}

        {activeFeed.length > 0 ? (
          <p className="muted-copy">
            Showing {pageRangeStart}-{pageRangeEnd} / {activeFeed.length}
          </p>
        ) : null}

        <AdSlot slotId="home-inline-1" />
      </article>

      <aside className="insight-column">
        <RightPanelIndicators cards={indicatorCards} generatedAt={indicatorGeneratedAt} stale={indicatorsStale} />

        <article className="source-intel glass-panel reveal-item" style={{ "--stagger-index": 1 } as CSSProperties}>
          <header className="source-intel-header">
            <h2>Source Coverage</h2>
            <p className="muted-copy">Live source mix across tabs</p>
          </header>
          <ul className="source-intel-list">
            {sourceDigest.slice(0, 8).map((entry) => (
              <li key={entry.sourceName} className="source-intel-item">
                <div>
                  <p className="source-name">{entry.sourceName}</p>
                  <p className="source-tabs">{entry.tabLabels}</p>
                </div>
                <div className="source-metrics">
                  <span>{entry.count}</span>
                  <span>{formatRelativeTime(entry.latestEvent)}</span>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="signal-board glass-panel reveal-item" style={{ "--stagger-index": 2 } as CSSProperties}>
          <header>
            <h2>Signal Diagnostics</h2>
            <p className="muted-copy">Realtime pulse from current API snapshot</p>
          </header>
          <dl className="signal-grid">
            <div>
              <dt>Total Events</dt>
              <dd>{feedStats.totalEvents}</dd>
            </div>
            <div>
              <dt>Active Sources</dt>
              <dd>{feedStats.sourceCount}</dd>
            </div>
            <div>
              <dt>Filing Signals</dt>
              <dd>{feedStats.filingCount}</dd>
            </div>
            <div>
              <dt>Macro Signals</dt>
              <dd>{feedStats.macroCount}</dd>
            </div>
            <div>
              <dt>Avg YoY</dt>
              <dd>{feedStats.avgYoy.toFixed(2)}%</dd>
            </div>
            <div>
              <dt>Positive Share</dt>
              <dd>{feedStats.positiveRatio.toFixed(0)}%</dd>
            </div>
          </dl>
        </article>

        {loadingOverview ? <p className="muted-copy">Syncing overview panels...</p> : null}
      </aside>
    </section>
  );
}
