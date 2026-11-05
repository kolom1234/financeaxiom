/** Opaque keyset cursor for feed pagination: base64url("<ISO event_time>|<item_id>"). */
export interface FeedCursor {
  eventTime: string;
  itemId: string;
}

const ITEM_ID_PATTERN = /^[A-Za-z0-9-]{1,80}$/;

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(`${cursor.eventTime}|${cursor.itemId}`, "utf8").toString("base64url");
}

export function decodeFeedCursor(raw: string): FeedCursor | null {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    return null;
  }
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) {
    return null;
  }
  const eventTime = decoded.slice(0, separator);
  const itemId = decoded.slice(separator + 1);
  const parsedTime = Date.parse(eventTime);
  if (Number.isNaN(parsedTime) || !ITEM_ID_PATTERN.test(itemId)) {
    return null;
  }
  return { eventTime: new Date(parsedTime).toISOString(), itemId };
}

/** Sort comparator matching SQL `order by event_time desc, item_id desc`. */
export function compareFeedOrder(
  left: { event_time: string; item_id: string },
  right: { event_time: string; item_id: string }
): number {
  if (left.event_time !== right.event_time) {
    return left.event_time < right.event_time ? 1 : -1;
  }
  if (left.item_id === right.item_id) {
    return 0;
  }
  return left.item_id < right.item_id ? 1 : -1;
}

/** True when `item` sorts strictly after the cursor position (i.e. belongs to the next page). */
export function isAfterCursor(item: { event_time: string; item_id: string }, cursor: FeedCursor): boolean {
  return compareFeedOrder(item, { event_time: cursor.eventTime, item_id: cursor.itemId }) > 0;
}
