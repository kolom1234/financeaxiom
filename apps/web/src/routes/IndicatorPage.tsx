import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getSeries } from "../lib/api";
import { LicenseBadge } from "../components/LicenseBadge";
import { SourceBadge } from "../components/SourceBadge";

type Observation = {
  obs_date: string;
  value_raw: string;
  value_num: number | null;
};

type SeriesPayload = {
  series_id: string;
  title: string;
  mode: "raw" | "derived";
  units: string;
  raw_locked: boolean;
  source: { name: string; policy_url?: string };
  license: {
    code: string;
    commercial_status: "allowed" | "conditional" | "disallowed";
    attribution_text: string;
  };
  observations: Observation[];
};

interface ChartPoint {
  x: number;
  y: number;
  value: number;
}

interface Scale {
  min: number;
  max: number;
}

const CHART_WIDTH = 860;
const CHART_HEIGHT = 280;
const CHART_PAD_X = 24;
const CHART_PAD_Y = 18;
const GRID_TICK_COUNT = 5;

function parseSeriesPayload(input: Record<string, unknown>): SeriesPayload | null {
  if (typeof input.series_id !== "string" || typeof input.title !== "string" || !Array.isArray(input.observations)) {
    return null;
  }

  const obs = input.observations
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const obsDate = typeof row.obs_date === "string" ? row.obs_date : null;
      const raw = typeof row.value_raw === "string" ? row.value_raw : null;
      const value = row.value_num;
      if (!obsDate || !raw) {
        return null;
      }
      return {
        obs_date: obsDate,
        value_raw: raw,
        value_num: typeof value === "number" && Number.isFinite(value) ? value : null
      };
    })
    .filter((entry): entry is Observation => entry !== null);

  return {
    series_id: input.series_id,
    title: input.title,
    mode: input.mode === "derived" ? "derived" : "raw",
    units: typeof input.units === "string" ? input.units : "",
    raw_locked: Boolean(input.raw_locked),
    source:
      typeof input.source === "object" && input.source !== null
        ? {
            name: typeof (input.source as Record<string, unknown>).name === "string" ? String((input.source as Record<string, unknown>).name) : "Unknown",
            policy_url:
              typeof (input.source as Record<string, unknown>).policy_url === "string"
                ? String((input.source as Record<string, unknown>).policy_url)
                : undefined
          }
        : { name: "Unknown" },
    license:
      typeof input.license === "object" && input.license !== null
        ? {
            code:
              typeof (input.license as Record<string, unknown>).code === "string"
                ? String((input.license as Record<string, unknown>).code)
                : "UNKNOWN",
            commercial_status:
              (input.license as Record<string, unknown>).commercial_status === "allowed" ||
              (input.license as Record<string, unknown>).commercial_status === "disallowed"
                ? ((input.license as Record<string, unknown>).commercial_status as "allowed" | "disallowed")
                : "conditional",
            attribution_text:
              typeof (input.license as Record<string, unknown>).attribution_text === "string"
                ? String((input.license as Record<string, unknown>).attribution_text)
                : ""
          }
        : {
            code: "UNKNOWN",
            commercial_status: "conditional",
            attribution_text: ""
          },
    observations: obs
  };
}

function withPaddedScale(min: number, max: number): Scale {
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

function valueToY(value: number, scale: Scale, height: number, padY: number): number {
  const span = Math.max(scale.max - scale.min, 0.000001);
  const ratio = (value - scale.min) / span;
  return height - padY - ratio * (height - padY * 2);
}

function buildPoints(values: number[], width: number, height: number, padX: number, padY: number, scale: Scale): ChartPoint[] {
  return values.map((value, index) => {
    const ratioX = index / Math.max(values.length - 1, 1);
    return {
      x: padX + ratioX * (width - padX * 2),
      y: valueToY(value, scale, height, padY),
      value
    };
  });
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

function buildXAxisIndexes(pointCount: number): number[] {
  if (pointCount <= 1) {
    return [0];
  }
  const raw = [0, pointCount - 1];
  if (pointCount > 2) {
    raw.push(Math.floor((pointCount - 1) / 2));
  }
  if (pointCount > 4) {
    raw.push(Math.floor((pointCount - 1) / 4));
    raw.push(Math.floor(((pointCount - 1) * 3) / 4));
  }
  const unique = [...new Set(raw)];
  return unique.sort((left, right) => left - right);
}

function formatAxisValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  if (abs <= 5) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDateTick(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "n/a";
  }
  return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit" }).format(date);
}

export function IndicatorPage(): JSX.Element {
  const { seriesId = "" } = useParams();
  const [mode, setMode] = useState<"raw" | "derived">("raw");
  const [payload, setPayload] = useState<SeriesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorText(null);
    void getSeries(seriesId, mode).then((data) => {
      if (!active) {
        return;
      }
      const parsed = parseSeriesPayload(data);
      if (!parsed) {
        setPayload(null);
        setErrorText("No structured series payload returned.");
        setLoading(false);
        return;
      }
      setPayload(parsed);
      setLoading(false);
    });
    return () => {
      if (active) {
        active = false;
      }
    };
  }, [seriesId, mode]);

  const numericRows = useMemo(() => (payload?.observations ?? []).filter((row) => row.value_num !== null), [payload]);
  const chartValues = useMemo(() => numericRows.map((row) => row.value_num ?? 0), [numericRows]);
  const latest = numericRows[numericRows.length - 1] ?? null;
  const previous = numericRows[numericRows.length - 2] ?? null;
  const minValue = chartValues.length > 0 ? Math.min(...chartValues) : null;
  const maxValue = chartValues.length > 0 ? Math.max(...chartValues) : null;
  const changePct =
    latest && previous && Math.abs(previous.value_num ?? 0) > 0.000001
      ? (((latest.value_num ?? 0) - (previous.value_num ?? 0)) / Math.abs(previous.value_num ?? 0)) * 100
      : null;

  const gridTicks = useMemo(
    () => (minValue === null || maxValue === null ? [] : buildGridTicks(minValue, maxValue, GRID_TICK_COUNT)),
    [minValue, maxValue]
  );
  const pointCount = numericRows.length;
  const xTicks = useMemo(() => buildXAxisIndexes(pointCount), [pointCount]);
  const scale = useMemo(() => {
    if (minValue === null || maxValue === null) {
      return { min: 0, max: 1 };
    }
    return withPaddedScale(minValue, maxValue);
  }, [minValue, maxValue]);

  const chartPoints = useMemo(
    () => buildPoints(chartValues, CHART_WIDTH, CHART_HEIGHT, CHART_PAD_X, CHART_PAD_Y, scale),
    [chartValues, scale]
  );
  const trendLine = useMemo(() => smoothLinePath(chartPoints), [chartPoints]);
  const area = useMemo(() => areaPath(chartPoints, trendLine, CHART_HEIGHT, CHART_PAD_Y), [chartPoints, trendLine]);
  const movingLine = useMemo(() => {
    if (chartValues.length === 0) {
      return "";
    }
    const ma = movingAverage(chartValues, Math.max(6, Math.round(Math.min(8, Math.max(3, chartValues.length / 4)))));
    const maPoints = buildPoints(ma, CHART_WIDTH, CHART_HEIGHT, CHART_PAD_X, CHART_PAD_Y, scale);
    return smoothLinePath(maPoints);
  }, [chartValues, scale]);

  const pointHighlights = useMemo(() => {
    if (chartPoints.length === 0) {
      return chartPoints;
    }
    const step = Math.max(1, Math.round(chartPoints.length / 8));
    return chartPoints.filter((_, index) => index === 0 || index === chartPoints.length - 1 || index % step === 0);
  }, [chartPoints]);
  const zeroY = scale.min <= 0 && scale.max >= 0 ? valueToY(0, scale, CHART_HEIGHT, CHART_PAD_Y) : null;

  const latestRows = [...(payload?.observations ?? [])].reverse().slice(0, 14);

  return (
    <section className="page-wrap">
      <header className="glass-panel page-header">
        <h1>Indicator: {seriesId}</h1>
        <p className="muted-copy">Mode switch keeps raw and derived series separated for compliance-safe analytics.</p>
        <div className="tab-row">
          <button className={`tab-btn ${mode === "raw" ? "active" : ""}`} onClick={() => setMode("raw")} type="button">
            raw
          </button>
          <button
            className={`tab-btn ${mode === "derived" ? "active" : ""}`}
            onClick={() => setMode("derived")}
            type="button"
          >
            derived
          </button>
        </div>
      </header>

      {loading ? <p className="muted-copy">Loading indicator series...</p> : null}
      {errorText ? <p className="muted-copy">{errorText}</p> : null}

      {payload ? (
        <>
          <article className="glass-panel indicator-detail-hero">
            <div className="indicator-detail-head">
              <div>
                <h2>{payload.title}</h2>
                <p className="muted-copy">
                  {payload.mode.toUpperCase()} mode | {payload.units || "unitless"} | {payload.observations.length} observations
                </p>
              </div>
              <div className="indicator-detail-badges">
                <SourceBadge source={{ name: payload.source.name }} />
                <LicenseBadge
                  license={{ code: payload.license.code, commercial_status: payload.license.commercial_status }}
                />
              </div>
            </div>

            <div className="indicator-detail-stats">
              <div>
                <p>Latest</p>
                <strong>{latest?.value_num?.toLocaleString("en-US") ?? "n/a"}</strong>
                <span>{latest?.obs_date ?? "n/a"}</span>
              </div>
              <div>
                <p>Change</p>
                <strong>{changePct === null ? "n/a" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`}</strong>
                <span>vs previous point</span>
              </div>
              <div>
                <p>Range</p>
                <strong>
                  {minValue === null || maxValue === null ? "n/a" : `${minValue.toLocaleString("en-US")} - ${maxValue.toLocaleString("en-US")}`}
                </strong>
                <span>current sample window</span>
              </div>
            </div>

            <div className="indicator-detail-chart">
              <svg viewBox="0 0 860 280" className="detail-chart-svg" role="img" aria-label={`${payload.title} detail chart`}>
                <defs>
                  <linearGradient id="detail-area-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-neon)" stopOpacity="0.36" />
                    <stop offset="100%" stopColor="var(--accent-neon)" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                <g className="detail-grid">
                  {gridTicks.map((tickValue, index) => {
                    const y = valueToY(tickValue, scale, CHART_HEIGHT, CHART_PAD_Y);
                    return (
                      <g key={`detail-y-${tickValue}-${index}`}>
                        <line
                          x1={CHART_PAD_X}
                          y1={y}
                          x2={CHART_WIDTH - CHART_PAD_X}
                          y2={y}
                          className="detail-grid-line"
                        />
                        <text x={CHART_PAD_X - 4} y={y + 3} className="chart-axis-label">
                          {formatAxisValue(tickValue)}
                        </text>
                      </g>
                    );
                  })}
                  {zeroY !== null ? <line x1={CHART_PAD_X} y1={zeroY} x2={CHART_WIDTH - CHART_PAD_X} y2={zeroY} className="detail-baseline" /> : null}
                  {xTicks.map((rowIndex) => {
                    const row = numericRows[rowIndex];
                    if (!row) {
                      return null;
                    }
                    const x = CHART_PAD_X + (rowIndex / Math.max(pointCount - 1, 1)) * (CHART_WIDTH - CHART_PAD_X * 2);
                    return (
                      <text key={`detail-x-${rowIndex}`} x={x} y={CHART_HEIGHT - 6} className="chart-axis-label chart-axis-label-x">
                        {formatDateTick(row.obs_date)}
                      </text>
                    );
                  })}
                </g>
                <path className="detail-area" d={area} fill="url(#detail-area-gradient)" />
                {movingLine ? <path className="detail-ma-line" d={movingLine} /> : null}
                <path className="detail-line" d={trendLine} />
                {pointHighlights.map((point, index) => {
                  const isLatest = index === pointHighlights.length - 1;
                  return (
                    <circle
                      key={`${payload.series_id}-${index}-${point.x}`}
                      cx={point.x}
                      cy={point.y}
                      r={isLatest ? "3.4" : "2.2"}
                      className={isLatest ? "detail-point detail-point-highlight" : "detail-point"}
                    >
                      <title>{`${payload.title}: ${point.value.toLocaleString("en-US")}`}</title>
                    </circle>
                  );
                })}
              </svg>
            </div>

            <p className="indicator-foot">
              Source: {payload.source.name}. {payload.license.attribution_text}
            </p>
          </article>

          <article className="glass-panel indicator-detail-table">
            <header>
              <h3>Latest Observations</h3>
              <p className="muted-copy">Most recent 14 points (newest first)</p>
            </header>
            <ul>
              {latestRows.map((row) => (
                <li key={`${row.obs_date}-${row.value_raw}`}>
                  <span>{row.obs_date}</span>
                  <strong>{row.value_num === null ? row.value_raw : row.value_num.toLocaleString("en-US")}</strong>
                </li>
              ))}
            </ul>
          </article>
        </>
      ) : null}
    </section>
  );
}
