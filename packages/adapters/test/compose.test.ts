// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { test, describe } from "bun:test";
import { strict as assert } from "assert";
import type {
  PubSubDriver,
  BrokerConsumer,
  PublishEnvelope,
} from "@ws-kit/core/pubsub";
import { withBroker, combineBrokers } from "@ws-kit/adapters/compose";

/**
 * Test suite for composition utilities (withBroker, combineBrokers).
 * Covers lifecycle safety, error handling, and idempotency.
 */

describe("withBroker()", () => {
  test("creates frozen adapter (prevents accidental mutation)", () => {
    const driver: PubSubDriver = {
      publish: async () => ({ ok: true }),
      subscribe: async () => {},
      unsubscribe: async () => {},
      getSubscribers: async function* () {},
    };

    const adapter = withBroker(driver);

    // Object is frozen
    assert.throws(() => {
      (adapter as any).newField = "test";
    }, TypeError);
  });

  test("delegates driver methods correctly", async () => {
    let publishCalled = false;
    let subscribeCalled = false;

    const driver: PubSubDriver = {
      publish: async () => {
        publishCalled = true;
        return { ok: true };
      },
      subscribe: async () => {
        subscribeCalled = true;
      },
      unsubscribe: async () => {},
      getSubscribers: async function* () {},
    };

    const adapter = withBroker(driver);

    await adapter.publish({
      topic: "test",
      payload: { foo: "bar" },
    });
    await adapter.subscribe("client1", "test");

    assert.equal(publishCalled, true);
    assert.equal(subscribeCalled, true);
  });

  test("omits start() when consumer is undefined", () => {
    const driver: PubSubDriver = {
      publish: async () => ({ ok: true }),
      subscribe: async () => {},
      unsubscribe: async () => {},
      getSubscribers: async function* () {},
    };

    const adapter = withBroker(driver);

    assert.equal(adapter.start, undefined);
  });

  test("includes start() when consumer is provided", () => {
    const driver: PubSubDriver = {
      publish: async () => ({ ok: true }),
      subscribe: async () => {},
      unsubscribe: async () => {},
      getSubscribers: async function* () {},
    };

    const consumer: BrokerConsumer = {
      start: async () => async () => {},
    };

    const adapter = withBroker(driver, consumer);

    assert.equal(typeof adapter.start, "function");
  });
});

describe("combineBrokers()", () => {
  test("starts consumers sequentially (default)", async () => {
    const order: string[] = [];

    const consumer1: BrokerConsumer = {
      start: async () => {
        order.push("1-start");
        return async () => {
          order.push("1-stop");
        };
      },
    };

    const consumer2: BrokerConsumer = {
      start: async () => {
        order.push("2-start");
        return async () => {
          order.push("2-stop");
        };
      },
    };

    const combined = combineBrokers(consumer1, consumer2);
    const stop = await Promise.resolve(combined.start(async () => {}));

    assert.deepEqual(order, ["1-start", "2-start"]);

    await stop();

    assert.deepEqual(order, ["1-start", "2-start", "1-stop", "2-stop"]);
  });

  test("rolls back on first failure (sequential)", async () => {
    const order: string[] = [];

    const consumer1: BrokerConsumer = {
      start: async () => {
        order.push("1-start");
        return async () => {
          order.push("1-stop");
        };
      },
    };

    const consumer2: BrokerConsumer = {
      start: async () => {
        order.push("2-start-attempt");
        throw new Error("Consumer 2 failed");
      },
    };

    const combined = combineBrokers(consumer1, consumer2);

    try {
      await Promise.resolve(combined.start(async () => {}));
      assert.fail("Should have thrown");
    } catch (e) {
      assert((e as Error).message.includes("Consumer 2 failed"));
    }

    // Consumer 1 should be rolled back
    assert.deepEqual(order, ["1-start", "2-start-attempt", "1-stop"]);
  });

  test("stop function is idempotent (safe to call multiple times)", async () => {
    let stopCallCount = 0;

    const consumer: BrokerConsumer = {
      start: async () => {
        return () => {
          stopCallCount++;
        };
      },
    };

    const combined = combineBrokers(consumer);
    const stop = await Promise.resolve(combined.start(async () => {}));

    // Call stop multiple times
    await stop();
    await stop();
    await stop();

    // The underlying stop should only be called once (guarded by onceStop)
    assert.equal(stopCallCount, 1);
  });

  test("handles sync stop functions", async () => {
    let syncStopCalled = false;

    const consumer: BrokerConsumer = {
      start: async () => {
        return () => {
          syncStopCalled = true;
        };
      },
    };

    const combined = combineBrokers(consumer);
    const stop = await Promise.resolve(combined.start(async () => {}));

    await stop();

    assert.equal(syncStopCalled, true);
  });

  test("handles async stop functions", async () => {
    let asyncStopCalled = false;

    const consumer: BrokerConsumer = {
      start: async () => {
        return async () => {
          asyncStopCalled = true;
        };
      },
    };

    const combined = combineBrokers(consumer);
    const stop = await Promise.resolve(combined.start(async () => {}));

    await stop();

    assert.equal(asyncStopCalled, true);
  });

  test("handles mixed sync/async stop functions", async () => {
    const stopOrder: string[] = [];

    const consumer1: BrokerConsumer = {
      start: async () => {
        return () => {
          stopOrder.push("sync");
        };
      },
    };

    const consumer2: BrokerConsumer = {
      start: async () => {
        return async () => {
          stopOrder.push("async");
        };
      },
    };

    const combined = combineBrokers(consumer1, consumer2);
    const stop = await Promise.resolve(combined.start(async () => {}));

    await stop();

    // Both should be called despite different types
    assert.equal(stopOrder.length, 2);
    assert(stopOrder.includes("sync"));
    assert(stopOrder.includes("async"));
  });

  test("tolerates undefined/null stop return", async () => {
    const consumer: BrokerConsumer = {
      start: async () => {
        // Returns undefined
        return undefined as any;
      },
    };

    const combined = combineBrokers(consumer);
    const stop = await Promise.resolve(combined.start(async () => {}));

    // Should not throw; stop is treated as no-op
    await stop();
  });

  test("onRemote handler receives all messages", async () => {
    const messages: PublishEnvelope[] = [];

    const consumer: BrokerConsumer = {
      start: async (onRemote) => {
        // Simulate broker messages
        await onRemote({ topic: "msg1", payload: { data: 1 } });
        await onRemote({ topic: "msg2", payload: { data: 2 } });

        return async () => {};
      },
    };

    const combined = combineBrokers(consumer);
    await Promise.resolve(
      combined.start(async (env) => {
        messages.push(env);
      }),
    );

    assert.equal(messages.length, 2);
    assert.equal(messages[0].topic, "msg1");
    assert.equal(messages[1].topic, "msg2");
  });
});
