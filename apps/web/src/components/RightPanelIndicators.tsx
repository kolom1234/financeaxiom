import { useEffect, useMemo, useState } from "react";

type SortMode = "momentum" | "value" | "name";

interface IndicatorCard {
  series_id: string;
  title: string;
  latest_value: number;
  period: string;
  yoy: number;
  sparkline: number[];
  source: { name: string };
  license: { attribution_text: string };
}

interface ChartPoint {
  x: number;
  y: number;
  value: number;
}

interface ValueScale {
  min: number;
  max: number;
}

const CHART_WIDTH = 620;
const CHART_HEIGHT = 220;
const CHART_PAD_X = 16;
const CHART_PAD_Y = 18;
const MINI_CHART_WIDTH = 132;
const MINI_CHART_HEIGHT = 32;
const MINI_CHART_PAD = 4;
const GRID_TICK_COUNT = 5;

function normalizeSparkline(values: number[], latestValue: number): number[] {
  const cleaned = values.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  if (cleaned.length >= 2) {
    return cleaned;
  }
  const fallback = Number.isFinite(latestValue) ? latestValue : 0;
  return [fallback, fallback];
}

function withPaddedScale(min: number, max: number): ValueScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }
  const span = max - min;
  if (span === 0) {
    const radius = Math.max(Math.abs(max) * 0.08, 1);
    return { min: min - radius, max: max + radius };
  }
  const pad = span * 0.08;
  return { min: min - pad, max: max + pad };
}

function valueToY(value: number, scale: ValueScale, height: number, padY: number): number {
  const span = Math.max(scale.max - scale.min, 0.000001);
  const ratio = (value - scale.min) / span;
  return height - padY - ratio * (height - padY * 2);
}

function buildPoints(values: number[], width: number, height: number, padX: number, padY: number, scale: ValueScale): ChartPoint[] {
  return values.map((value, index) => ({
    x: padX + (index / Math.max(values.length - 1, 1)) * (width - padX * 2),
    y: valueToY(value, scale, height, padY),
    value
  }));
}

function smoothLinePath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    const only = points[0];
    if (!only) {
      return "";
    }
    return `M ${only.x.toFixed(2)} ${only.y.toFixed(2)}`;
  }

  const first = points[0];
  if (!first) {
    return "";
  }
  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (!current || !next) {
      continue;
    }

    const controlX = ((current.x + next.x) / 2).toFixed(2);
    const controlY = current.y.toFixed(2);
    const endX = next.x.toFixed(2);
    const endY = next.y.toFixed(2);
    path += ` C ${controlX} ${controlY}, ${controlX} ${endY}, ${endX} ${endY}`;
  }

  return path;
}

function areaPath(points: ChartPoint[], line: string, height: number, padY: number): string {
  if (points.length === 0 || !line) {
    return "";
  }
  const bottom = height - padY;
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) {
    return "";
  }
  return `${line} L ${end.x.toFixed(2)} ${bottom.toFixed(2)} L ${start.x.toFixed(2)} ${bottom.toFixed(2)} Z`;
}

function movingAverage(values: number[], window: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const safeWindow = Math.max(2, Math.floor(window));
  return values.map((_, index) => {
    const start = Math.max(0, index - safeWindow + 1);
    const slice = values.slice(start, index + 1);
    const sum = slice.reduce((total, value) => total + value, 0);
    return sum / Math.max(slice.length, 1);
  });
}

function buildGridTicks(min: number, max: number, count: number): number[] {
  const safeCount = Math.max(count, 2);
  const scale = withPaddedScale(min, max);
  const span = scale.max - scale.min;
  return Array.from({ length: safeCount }, (_, index) => scale.max - index * (span / (safeCount - 1)));
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatAxisValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return formatCompact(value);
  }
  if (abs <= 5) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return "not synced";
  }

  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) {
    return "not synced";
  }

  const deltaMs = timestamp - Date.now();
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

function buildMiniPoints(values: number[]): ChartPoint[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scale = withPaddedScale(min, max);
  return values.map((value, index) => {
    const x = MINI_CHART_PAD + (index / Math.max(values.length - 1, 1)) * (MINI_CHART_WIDTH - MINI_CHART_PAD * 2);
    return {
      x,
      y: valueToY(value, scale, MINI_CHART_HEIGHT, MINI_CHART_PAD),
      value
    };
  });
}

function miniLinePath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  let path = "";
  points.forEach((point, index) => {
    if (index === 0) {
      path = `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    } else {
      path += ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }
  });
  return path;
}

function miniAreaPath(points: ChartPoint[], line: string): string {
  if (points.length === 0 || !line) {
    return "";
  }
  const baseline = MINI_CHART_HEIGHT - MINI_CHART_PAD;
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) {
    return "";
  }
  return `${line} L ${end.x.toFixed(2)} ${baseline.toFixed(2)} L ${start.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

function sortCards(cards: IndicatorCard[], mode: SortMode): IndicatorCard[] {
  const next = [...cards];
  switch (mode) {
    case "momentum":
      next.sort((left, right) => Math.abs(right.yoy) - Math.abs(left.yoy));
      return next;
    case "value":
      next.sort((left, right) => right.latest_value - left.latest_value);
      return next;
    case "name":
      next.sort((left, right) => left.title.localeCompare(right.title));
      return next;
  }
}

export function RightPanelIndicators({
  cards,
  generatedAt,
  stale
}: {
  cards: IndicatorCard[];
  generatedAt?: string | null;
  stale?: boolean;
}): JSX.Element {
  const normalizedCards = useMemo(
    () =>
      cards.map((card) => ({
        ...card,
        sparkline: normalizeSparkline(card.sparkline, card.latest_value)
      })),
    [cards]
  );

  const [selectedSeriesId, setSelectedSeriesId] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("momentum");

  const sortedCards = useMemo(() => sortCards(normalizedCards, sortMode), [normalizedCards, sortMode]);

  useEffect(() => {
    if (sortedCards.length === 0) {
      setSelectedSeriesId("");
      return;
    }
    const firstCard = sortedCards[0];
    if (!firstCard) {
      return;
    }
    if (!sortedCards.some((card) => card.series_id === selectedSeriesId)) {
      setSelectedSeriesId(firstCard.series_id);
    }
  }, [selectedSeriesId, sortedCards]);

  if (sortedCards.length === 0) {
    return (
      <aside className="indicator-panel">
        <h2 className="panel-title">Key Indicators</h2>
        <p className="muted-copy">No indicators available.</p>
      </aside>
    );
  }

  const selected = sortedCards.find((card) => card.series_id === selectedSeriesId) ?? sortedCards[0];
  if (!selected) {
    return (
      <aside className="indicator-panel">
        <h2 className="panel-title">Key Indicators</h2>
        <p className="muted-copy">No indicators available.</p>
      </aside>
    );
  }

  const minValue = Math.min(...selected.sparkline);
  const maxValue = Math.max(...selected.sparkline);
  const scale = withPaddedScale(minValue, maxValue);
  const gridTicks = buildGridTicks(minValue, maxValue, GRID_TICK_COUNT);

  const points = buildPoints(selected.sparkline, CHART_WIDTH, CHART_HEIGHT, CHART_PAD_X, CHART_PAD_Y, scale);
  const line = smoothLinePath(points);
  const area = areaPath(points, line, CHART_HEIGHT, CHART_PAD_Y);

  const movingPoints = buildPoints(
    movingAverage(selected.sparkline, 6),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PAD_X,
    CHART_PAD_Y,
    scale
  );
  const movingLine = smoothLinePath(movingPoints);

  const selectedPointInterval = Math.max(1, Math.round(points.length / 7));

  const latest = selected.sparkline[selected.sparkline.length - 1] ?? selected.latest_value;
  const baseline = selected.sparkline[0] ?? latest;
  const movement = baseline === 0 ? 0 : ((latest - baseline) / Math.abs(baseline)) * 100;
  const gradientId = `area-gradient-${selected.series_id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const zeroY =
    scale.min <= 0 && scale.max >= 0 ? valueToY(0, scale, CHART_HEIGHT, CHART_PAD_Y) : null;

  const avgYoy = sortedCards.reduce((sum, card) => sum + card.yoy, 0) / Math.max(sortedCards.length, 1);
  const positiveShare =
    (sortedCards.filter((card) => card.yoy >= 0).length / Math.max(sortedCards.length, 1)) * 100;
  const spread = maxValue - minValue;

  return (
    <aside className="indicator-panel">
      <article className="indicator-hero glass-panel">
        <header className="indicator-hero-header">
          <div>
            <p className="panel-kicker">Macro Dashboard</p>
            <h2 className="panel-title">Key Indicators</h2>
            <p className="indicator-sync-line">
              {stale ? "Fallback snapshot" : "Live feed"} - updated {formatRelativeTime(generatedAt ?? null)}
            </p>
          </div>
          <span className={`delta-chip ${movement >= 0 ? "positive" : "negative"}`}>{formatDelta(movement)}</span>
        </header>

        <div className="indicator-stat-strip" aria-label="Indicator quick stats">
          <div>
            <p>Coverage</p>
            <strong>{sortedCards.length}</strong>
          </div>
          <div>
            <p>Avg YoY</p>
            <strong>{avgYoy.toFixed(2)}%</strong>
          </div>
          <div>
            <p>Positive</p>
            <strong>{positiveShare.toFixed(0)}%</strong>
          </div>
          <div>
            <p>Range</p>
            <strong>{spread.toFixed(2)}</strong>
          </div>
        </div>

        <div className="indicator-toolbar" role="tablist" aria-label="Indicator sort mode">
          <button
            type="button"
            className={`sort-chip ${sortMode === "momentum" ? "active" : ""}`}
            onClick={() => setSortMode("momentum")}
          >
            Momentum
          </button>
          <button
            type="button"
            className={`sort-chip ${sortMode === "value" ? "active" : ""}`}
            onClick={() => setSortMode("value")}
          >
            Value
          </button>
          <button
            type="button"
            className={`sort-chip ${sortMode === "name" ? "active" : ""}`}
            onClick={() => setSortMode("name")}
          >
            Name
          </button>
        </div>

        <div className="indicator-hero-main">
          <div className="indicator-primary">
            <h3>{selected.title}</h3>
            <p className="indicator-primary-value">{formatCompact(selected.latest_value)}</p>
            <p className="indicator-meta">Latest: {selected.latest_value.toLocaleString("en-US")} ({selected.period})</p>
            <p className="indicator-meta">YoY: {selected.yoy.toFixed(2)}% (Derived by Open Finance Pulse)</p>
          </div>

          <div className="indicator-chart-shell">
            <svg viewBox="0 0 620 220" className="macro-chart" role="img" aria-label={`${selected.title} trend`}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-neon)" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="var(--accent-neon)" stopOpacity="0.04" />
                </linearGradient>
              </defs>

              <g className="macro-grid">
                {gridTicks.map((tickValue, index) => {
                  const y = valueToY(tickValue, scale, CHART_HEIGHT, CHART_PAD_Y);
                  const isLast = index === gridTicks.length - 1;
                  return (
                    <g key={`${selected.series_id}-${index}`}>
                      <line
                        x1={CHART_PAD_X}
                        y1={y}
                        x2={CHART_WIDTH - CHART_PAD_X}
                        y2={y}
                        className={isLast ? "macro-grid-line dashed" : "macro-grid-line"}
                      />
                      <text x={CHART_PAD_X - 4} y={y + 3} className="chart-axis-label">
                        {formatAxisValue(tickValue)}
                      </text>
                    </g>
                  );
                })}
                {zeroY !== null ? <line x1={CHART_PAD_X} y1={zeroY} x2={CHART_WIDTH - CHART_PAD_X} y2={zeroY} className="macro-baseline" /> : null}
              </g>
              {movingLine ? <path className="macro-moving-line" d={movingLine} /> : null}
              <path className="macro-area" d={area} fill={`url(#${gradientId})`} />
              <path className="macro-line" d={line} />
              {points
                .map((point, index) => ({ point, index }))
                .filter(({ index }) => index === 0 || index === points.length - 1 || index % selectedPointInterval === 0)
                .map(({ point, index }) => {
                  const isLatest = index === points.length - 1;
                  return (
                    <circle
                      key={`${selected.series_id}-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={isLatest ? "3.6" : "2.3"}
                      className={isLatest ? "macro-point highlight" : "macro-point"}
                    >
                      <title>{`${selected.title}: ${point.value.toLocaleString("en-US")}`}</title>
                    </circle>
                  );
                })}
            </svg>
          </div>
        </div>

        <p className="indicator-foot">
          Source: {selected.source.name}. {selected.license.attribution_text}
        </p>
      </article>

      <ul className="indicator-list" aria-label="Indicator quick picks">
        {sortedCards.map((card) => {
          const isActive = card.series_id === selected.series_id;
          const miniPoints = buildMiniPoints(card.sparkline);
          const miniLine = miniLinePath(miniPoints);
          const miniArea = miniAreaPath(miniPoints, miniLine);
          const miniFirst = miniPoints[0];
          const miniLast = miniPoints[miniPoints.length - 1];
          const miniRangeStep = Math.max(1, Math.round(miniPoints.length / 6));

          return (
            <li key={card.series_id}>
              <button
                type="button"
                className={`indicator-card glass-panel ${isActive ? "active" : ""}`}
                onClick={() => setSelectedSeriesId(card.series_id)}
              >
                <span className="mini-title">{card.title}</span>
                <span className="mini-value">{card.latest_value.toLocaleString("en-US")}</span>
                <span className={`mini-yoy ${card.yoy >= 0 ? "up" : "down"}`}>{formatDelta(card.yoy)}</span>
                <svg viewBox="0 0 132 32" className="mini-spark" aria-hidden="true">
                  <g className="mini-spark-grid">
                    <line x1={MINI_CHART_PAD} y1="4" x2={MINI_CHART_WIDTH - MINI_CHART_PAD} y2="4" />
                    <line x1={MINI_CHART_PAD} y1="16" x2={MINI_CHART_WIDTH - MINI_CHART_PAD} y2="16" />
                    <line x1={MINI_CHART_PAD} y1="28" x2={MINI_CHART_WIDTH - MINI_CHART_PAD} y2="28" />
                  </g>
                  <path className="mini-area" d={miniArea} />
                  <path className="mini-line" d={miniLine} />
                  {miniPoints
                    .filter((_, index) => index === 0 || index === miniPoints.length - 1 || index % miniRangeStep === 0)
                    .map((point) => (
                      <circle key={`${card.series_id}-${point.x}-${point.y}`} cx={point.x} cy={point.y} r="1.4" className="mini-point">
                        <title>{`${card.title}: ${point.value.toLocaleString("en-US")}`}</title>
                      </circle>
                    ))}
                  {miniFirst && miniLast && miniFirst.value !== miniLast.value ? (
                    <line
                      x1={miniFirst.x}
                      y1={miniFirst.y}
                      x2={miniLast.x}
                      y2={miniLast.y}
                      className="mini-range-line"
                    />
                  ) : null}
                  {miniLast ? <circle cx={miniLast.x} cy={miniLast.y} r="2" className="mini-point mini-point-accent" /> : null}
                </svg>
                <span className="mini-period">{card.period}</span>
                <span className="mini-meta">{card.source.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

