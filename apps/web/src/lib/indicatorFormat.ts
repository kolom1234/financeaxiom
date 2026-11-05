import type { IndicatorCard } from "./api";

export interface IndicatorDelta {
  /** Signed value used for colouring/sorting; null when no comparison is available. */
  value: number | null;
  /** e.g. "+2.41% YoY", "-0.20 pp", "+10 MBBL", or "n/a". */
  label: string;
  direction: "up" | "down" | "flat";
}

function signed(value: number, digits: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

/**
 * Year-over-year % change for level series; for series already expressed in %
 * (rates, YoY derivations) the change vs. the previous observation in
 * percentage points, because a "% change of a percentage" would be misleading.
 */
export function indicatorDelta(card: Pick<IndicatorCard, "yoy" | "change" | "change_unit">): IndicatorDelta {
  if (typeof card.yoy === "number") {
    return { value: card.yoy, label: `${signed(card.yoy, 2)}% YoY`, direction: card.yoy > 0 ? "up" : card.yoy < 0 ? "down" : "flat" };
  }
  if (typeof card.change === "number") {
    const unit = card.change_unit === "pp" ? " pp" : card.change_unit ? ` ${card.change_unit}` : "";
    return { value: card.change, label: `${signed(card.change, 2)}${unit}`, direction: card.change > 0 ? "up" : card.change < 0 ? "down" : "flat" };
  }
  return { value: null, label: "n/a", direction: "flat" };
}
