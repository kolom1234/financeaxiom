import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createMockEnv } from "../helpers/mockEnv";
import type { Env, IngestQueueMessage, PushQueueMessage } from "../../src/types";

class MockQueue<T> {
  readonly messages: T[] = [];

  async send(message: T): Promise<void> {
    this.messages.push(message);
  }
}

function createController(cron: string): any {
  return {
    cron,
    scheduledTime: Date.now(),
    noRetry(): void {
      return;
    }
  };
}

describe("scheduled cron dispatch", () => {
  it("enqueues SEC job on 2-minute cron only", async () => {
    const ingestQueue = new MockQueue<IngestQueueMessage>();
    const pushQueue = new MockQueue<PushQueueMessage>();
    const env = createMockEnv({
      INGEST_QUEUE: ingestQueue as unknown as Env["INGEST_QUEUE"],
      PUSH_QUEUE: pushQueue as unknown as Env["PUSH_QUEUE"]
    });

    await worker.scheduled(createController("*/2 * * * *"), env);

    expect(ingestQueue.messages.map((message) => message.job)).toEqual(["INGEST_SEC"]);
    expect(pushQueue.messages.length).toBe(0);
  });

  it("enqueues GDELT and push fanout on 5-minute cron", async () => {
    const ingestQueue = new MockQueue<IngestQueueMessage>();
    const pushQueue = new MockQueue<PushQueueMessage>();
    const env = createMockEnv({
      INGEST_QUEUE: ingestQueue as unknown as Env["INGEST_QUEUE"],
      PUSH_QUEUE: pushQueue as unknown as Env["PUSH_QUEUE"]
    });

    await worker.scheduled(createController("*/5 * * * *"), env);

    expect(ingestQueue.messages.map((message) => message.job)).toEqual(
      Array.from({ length: 10 }, () => "INGEST_GDELT")
    );
    expect(ingestQueue.messages.map((message) => String(message.params.entity))).toEqual([
      "Microsoft",
      "Apple",
      "NVIDIA",
      "Amazon",
      "Alphabet",
      "Meta",
      "Broadcom",
      "Tesla",
      "Costco",
      "Netflix"
    ]);
    expect(pushQueue.messages.map((message) => message.job)).toEqual(["PUSH_FANOUT_BREAKING"]);
  });

  it("enqueues macro and recompute jobs on 3-hour cron", async () => {
    const ingestQueue = new MockQueue<IngestQueueMessage>();
    const env = createMockEnv({
      INGEST_QUEUE: ingestQueue as unknown as Env["INGEST_QUEUE"]
    });

    await worker.scheduled(createController("0 */3 * * *"), env);

    expect(ingestQueue.messages.map((message) => message.job)).toEqual(["INGEST_MACRO", "RECOMPUTE_DERIVED"]);
  });
});
