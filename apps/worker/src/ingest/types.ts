import type { IngestQueueMessage } from "../types";

export const ALLOWED_INGEST_JOBS: IngestQueueMessage["job"][] = [
  "INGEST_GDELT",
  "INGEST_SEC",
  "INGEST_MACRO",
  "RECOMPUTE_DERIVED"
];

