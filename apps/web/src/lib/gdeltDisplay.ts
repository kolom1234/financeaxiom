import type { FeedItemPayload } from "@ofp/shared";

export interface GdeltDisplayMeta {
  title: string;
  mentionCount: number | null;
  sourceCount: number | null;
  mentionLabel: string;
  sourceLabel: string;
  compactMeta: string;
}

const MENTION_COUNT_REGEX = /:\s*([0-9]+(?:\.[0-9]+)?)\s+mentions/i;
const TITLE_REGEX = /^(.*?)\s+(?:index\s+activity|mentions\s+spike)\b/i;

function toSafeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isGdeltSignal(item: FeedItemPayload): boolean {
  return item.item_type === "gdelt_link";
}

function extractTitle(item: FeedItemPayload): string {
  const fromMeta =
    typeof item.meta?.query === "string" && item.meta.query.trim().length > 0 ? item.meta.query.trim() : "";
  if (fromMeta) {
    return `${fromMeta} Index Signal`;
  }

  const fromHeadline = item.headline?.trim() ?? "";
  const titleMatch = TITLE_REGEX.exec(fromHeadline);
  if (titleMatch?.[1]?.trim()) {
    return `${titleMatch[1].trim()} Index Signal`;
  }

  const firstEntity = item.entities.find((candidate) => candidate.name.trim().length > 0);
  if (firstEntity?.name) {
    return `${firstEntity.name} Index Signal`;
  }

  return "Index Signal";
}

function extractMentionCount(item: FeedItemPayload): number | null {
  const fromMeta = toSafeNumber(item.meta?.mention_count);
  if (fromMeta !== null) {
    return Math.round(fromMeta);
  }

  const headlineMatch = MENTION_COUNT_REGEX.exec(item.headline);
  if (headlineMatch?.[1]) {
    const parsed = Number(headlineMatch[1]);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }

  return null;
}

function extractSourceCount(item: FeedItemPayload): number | null {
  const fromMeta = toSafeNumber(item.meta?.source_count);
  if (fromMeta !== null) {
    return Math.round(fromMeta);
  }

  const fromMetaSources = toSafeNumber(item.meta?.sources_count);
  return fromMetaSources === null ? null : Math.round(fromMetaSources);
}

function formatCountLabel(count: number | null, fallback: string): string {
  if (count === null) {
    return fallback;
  }

  return count.toLocaleString("en-US");
}

export function buildGdeltDisplayMeta(item: FeedItemPayload): GdeltDisplayMeta {
  if (!isGdeltSignal(item)) {
    return {
      title: item.headline,
      mentionCount: null,
      sourceCount: null,
      mentionLabel: "N/A",
      sourceLabel: "N/A",
      compactMeta: "Metadata available on source card."
    };
  }

  const title = extractTitle(item);
  const mentionCount = extractMentionCount(item);
  const sourceCount = extractSourceCount(item);

  const mentionText = `count ${formatCountLabel(mentionCount, "n/a")}`;
  const sourceText = `sources ${formatCountLabel(sourceCount, "n/a")}`;

  return {
    title,
    mentionCount,
    sourceCount,
    mentionLabel: mentionText,
    sourceLabel: sourceText,
    compactMeta: `${mentionText} / ${sourceText}`
  };
}


