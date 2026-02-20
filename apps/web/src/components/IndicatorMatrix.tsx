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

type MiniPoint = {
  x: number;
  y: number;
  value: number;
};

const CHART_WIDTH = 132;
const CHART_HEIGHT = 38;
const PAD_X = 5;
const PAD_Y = 5;

function normalize(values: number[], fallback: number): number[] {
  const cleaned = values.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  if (cleaned.length >= 2) {
    return cleaned;
  }
  return [fallback, fallback];
}

function buildMiniPoints(values: number[]): MiniPoint[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.000001);
  return values.map((value, index) => ({
    x: PAD_X + (index / Math.max(values.length - 1, 1)) * (CHART_WIDTH - PAD_X * 2),
    y: CHART_HEIGHT - PAD_Y - ((value - min) / span) * (CHART_HEIGHT - PAD_Y * 2),
    value
  }));
}

function miniPath(points: MiniPoint[]): string {
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

function miniAreaPath(points: MiniPoint[], line: string): string {
  if (points.length === 0 || !line) {
    return "";
  }
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) {
    return "";
  }
  return `${line} L ${end.x.toFixed(2)} ${CHART_HEIGHT - PAD_Y} L ${start.x.toFixed(2)} ${CHART_HEIGHT - PAD_Y} Z`;
}

function compactFormat(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact"
  }).format(value);
}

function formatDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function IndicatorMatrix({
  cards,
  stale
}: {
  cards: IndicatorCard[];
  stale?: boolean;
}): JSX.Element | null {
  if (cards.length === 0) {
    return null;
  }

  return (
    <section className="indicator-matrix glass-panel reveal-item" aria-label="Expanded indicator coverage">
      <header className="indicator-matrix-header">
        <div>
          <p className="panel-kicker">Expanded Coverage</p>
          <h2>Live Indicator Matrix</h2>
        </div>
        <span className={`live-chip ${stale ? "degraded" : "live"}`}>{stale ? "Fallback" : "Live"}</span>
      </header>

      <ul className="matrix-grid">
        {cards.map((card) => {
          const series = normalize(card.sparkline, card.latest_value);
          const points = buildMiniPoints(series);
          const line = miniPath(points);
          const area = miniAreaPath(points, line);
          const minValue = Math.min(...series);
          const maxValue = Math.max(...series);
          const firstPoint = points[0];
          const lastPoint = points[points.length - 1];
          const minPoint = firstPoint
            ? points.reduce((lowest, point) => (point.value < lowest.value ? point : lowest), firstPoint)
            : null;
          const maxPoint = firstPoint
            ? points.reduce((highest, point) => (point.value > highest.value ? point : highest), firstPoint)
            : null;
          return (
            <li key={card.series_id} className="matrix-card">
              <div className="matrix-topline">
                <p className="matrix-title">{card.title}</p>
                <span className={`mini-yoy ${card.yoy >= 0 ? "up" : "down"}`}>{formatDelta(card.yoy)}</span>
              </div>

              <div className="matrix-value-row">
                <strong>{card.latest_value.toLocaleString("en-US")}</strong>
                <span>{card.period}</span>
              </div>

              <svg viewBox="0 0 132 38" className="mini-spark" aria-hidden="true">
                <g className="mini-spark-grid">
                  <line x1={PAD_X} y1={PAD_Y} x2={CHART_WIDTH - PAD_X} y2={PAD_Y} />
                  <line x1={PAD_X} y1={CHART_HEIGHT / 2} x2={CHART_WIDTH - PAD_X} y2={CHART_HEIGHT / 2} />
                  <line x1={PAD_X} y1={CHART_HEIGHT - PAD_Y} x2={CHART_WIDTH - PAD_X} y2={CHART_HEIGHT - PAD_Y} />
                </g>
                <path className="mini-area" d={area} />
                <path className="mini-line" d={line} />
                {firstPoint ? <circle cx={firstPoint.x} cy={firstPoint.y} r="0.9" className="mini-point" /> : null}
                {lastPoint ? (
                  <circle
                    cx={lastPoint.x}
                    cy={lastPoint.y}
                    r="1.6"
                    className="mini-point mini-point-accent"
                  >
                    <title>{`${card.title}: ${lastPoint.value.toLocaleString("en-US")}`}</title>
                  </circle>
                ) : null}
                {minPoint && maxPoint && minPoint.value !== maxPoint.value ? (
                  <>
                    <line
                      x1={minPoint.x}
                      y1={minPoint.y}
                      x2={maxPoint.x}
                      y2={maxPoint.y}
                      className="mini-range-line"
                    />
                  </>
                ) : null}
              </svg>

              <p className="matrix-meta">{card.source.name}</p>
              <p className="matrix-meta">
                {compactFormat(minValue)} / {compactFormat(maxValue)}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
