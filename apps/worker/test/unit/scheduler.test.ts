import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { CRON, buildScheduledMessages } from "../../src/ingest/schedule";
import { createMockEnv } from "../helpers/mockEnv";
import type { Env, IngestQueueMessage, PushQueueMessage } from "../../src/types";
import { readFileSync } from "node:fs";

class MockQueue<T> {
  readonly messages: T[] = [];
  async sendBatch(batch: Array<{ body: T }>): Promise<void> {
    this.messages.push(...batch.map((entry) => entry.body));
  }
}

function controller(cron: string): any {
  return { cron, scheduledTime: Date.now(), noRetry: () => undefined };
}

describe("scheduled cron dispatch", () => {
  it("enqueues SEC jobs for tracked issuers on the 2-minute cron only", async () => {
    const ingest = new MockQueue<IngestQueueMessage>();
    const push = new MockQueue<PushQueueMessage>();
    const env = createMockEnv({ INGEST_QUEUE: ingest as unknown as Env["INGEST_QUEUE"], PUSH_QUEUE: push as unknown as Env["PUSH_QUEUE"] });
    await worker.scheduled(controller(CRON.sec), env);
    expect(ingest.messages).toEqual([expect.objectContaining({ job: "INGEST_SEC", params: { cik: "0001045810" } })]);
    expect(push.messages).toHaveLength(0);
  });

  it("enqueues one paced GDELT job and the push fanout on the 5-minute cron", async () => {
    const ingest = new MockQueue<IngestQueueMessage>();
    const push = new MockQueue<PushQueueMessage>();
    const env = createMockEnv({ INGEST_QUEUE: ingest as unknown as Env["INGEST_QUEUE"], PUSH_QUEUE: push as unknown as Env["PUSH_QUEUE"] });
    await worker.scheduled(controller(CRON.gdeltAndPush), env);
    expect(ingest.messages.map((message) => message.job)).toEqual(["INGEST_GDELT"]);
    expect(push.messages.map((message) => message.job)).toEqual(["PUSH_FANOUT_BREAKING"]);
  });

  it("enqueues one message per macro source on the 3-hour cron (no retired RECOMPUTE_DERIVED)", async () => {
    const { ingest } = buildScheduledMessages(CRON.macro, "run");
    expect(ingest.map((message) => message.params.source)).toEqual(["BLS", "EIA", "ECB", "FRB", "BEA", "EUROSTAT", "OECD", "WORLD_BANK"]);
    expect(ingest.every((message) => message.job === "INGEST_MACRO")).toBe(true);
  });

  it("enqueues retention maintenance on the daily cron", () => {
    expect(buildScheduledMessages(CRON.retention, "run").ingest.map((message) => message.job)).toEqual(["MAINTENANCE_RETENTION"]);
  });

  it("uses exactly the cron expressions declared in wrangler.toml", () => {
    const toml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
    const declared = /crons\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1]?.match(/"([^"]+)"/g)?.map((value) => value.slice(1, -1)) ?? [];
    expect([...declared].sort()).toEqual(Object.values(CRON).sort());
  });
});
