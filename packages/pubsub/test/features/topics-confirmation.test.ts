// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { TopicsImpl } from "../../src/core/topics.js";
import { AbortError, PubSubError } from "../../src/core/error.js";

describe("TopicsImpl - Confirmation Semantics", () => {
  describe("subscribe() with confirm option", () => {
    it("should subscribe with confirm='settled' and wait for settlement", async () => {
      let adapterCalled = false;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          adapterCalled = true;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe with confirmation
      await topics.subscribe("room:1", { confirm: "settled" });

      // Adapter should have been called before returning
      expect(adapterCalled).toBe(true);
      expect(topics.has("room:1")).toBe(true);
    });

    it("should return quickly when subscribing to already-settled topic with confirm='settled'", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // First subscription
      await topics.subscribe("room:1");
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // Second subscription with confirm='settled' on already-settled topic
      // should be fast (no wait needed)
      const startTime = Date.now();
      await topics.subscribe("room:1", { confirm: "settled" });
      const elapsed = Date.now() - startTime;

      // Should be very quick (settled idempotency)
      expect(elapsed).toBeLessThan(100); // Generous threshold
      // No additional adapter calls
      expect(mockWs.subscribe.mock.calls.length).toBe(1);
    });

    it("should complete successfully with confirm='settled' and normal adapter", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          // Synchronous adapter (typical)
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe with confirmation
      const result = await topics.subscribe("room:1", {
        confirm: "settled",
        timeoutMs: 5000,
      });

      // Should complete successfully
      expect(result).toBe(undefined); // subscribe returns void
      expect(topics.has("room:1")).toBe(true);
      expect(mockWs.subscribe).toHaveBeenCalledWith("room:1");
    });

    it("should respect pre-aborted signal with confirm='settled'", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);
      const ac = new AbortController();

      // Pre-abort the signal
      ac.abort();

      try {
        await topics.subscribe("room:1", {
          confirm: "settled",
          signal: ac.signal,
        });
        expect.unreachable("Should have thrown AbortError");
      } catch (err) {
        // Check for either our custom AbortError or native DOMException AbortError
        const isAbortError =
          err instanceof AbortError ||
          (err instanceof Error && err.name === "AbortError");
        expect(isAbortError).toBe(true);
      }

      // No state mutation on pre-aborted signal
      expect(topics.has("room:1")).toBe(false);
    });

    it("should throw adapter error when adapter fails with confirm='settled'", async () => {
      const adapterError = new Error("Adapter failed");
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          throw adapterError;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      try {
        await topics.subscribe("room:1", { confirm: "settled" });
        expect.unreachable("Should have thrown PubSubError");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }
    });
  });

  describe("unsubscribe() with confirm option", () => {
    it("should unsubscribe with confirm='settled' and wait for settlement", async () => {
      let adapterCalled = false;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {
          adapterCalled = true;
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe first
      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);

      // Unsubscribe with confirmation
      adapterCalled = false;
      await topics.unsubscribe("room:1", { confirm: "settled" });

      expect(adapterCalled).toBe(true);
      expect(topics.has("room:1")).toBe(false);
    });

    it("should complete unsubscribe with confirm option", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe first
      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);

      // Unsubscribe with confirm
      await topics.unsubscribe("room:1", { confirm: "settled" });

      expect(topics.has("room:1")).toBe(false);
      expect(mockWs.unsubscribe).toHaveBeenCalledWith("room:1");
    });
  });

  describe("subscribeMany() with confirm option", () => {
    it("should accept confirm option (already atomic by nature)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe many with confirmation
      const result = await topics.subscribeMany(["room:1", "room:2"], {
        confirm: "settled",
      });

      expect(result.added).toBe(2);
      expect(result.total).toBe(2);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
    });

    it("should throw validation error with confirm='settled'", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      try {
        await topics.subscribeMany(["room:1", ""], { confirm: "settled" });
        expect.unreachable("Should have thrown PubSubError");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("INVALID_TOPIC");
      }
    });
  });

  describe("unsubscribeMany() with confirm option", () => {
    it("should accept confirm option and validate", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe first
      await topics.subscribeMany(["room:1", "room:2"]);

      // Unsubscribe many with confirmation
      const result = await topics.unsubscribeMany(["room:1", "room:2"], {
        confirm: "settled",
      });

      expect(result.removed).toBe(2);
      expect(result.total).toBe(0);
    });
  });

  describe("set() with confirm option", () => {
    it("should accept confirm option (already atomic by nature)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Set with confirmation
      const result = await topics.set(["room:1", "room:2"], {
        confirm: "settled",
      });

      expect(result.added).toBe(2);
      expect(result.removed).toBe(0);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
    });

    it("should support replace operation with confirm", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
        replace: mock(async (topics: string[]) => {
          // Simulate adapter replace
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Initial set
      await topics.set(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Replace with confirmation
      const result = await topics.set(["room:1", "room:3"], {
        confirm: "settled",
      });

      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
      expect(topics.has("room:2")).toBe(false);
    });
  });

  describe("clear() with confirm option", () => {
    it("should clear all subscriptions with confirm", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to some topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Clear with confirmation
      const result = await topics.clear({ confirm: "settled" });

      expect(result.removed).toBe(3);
      expect(topics.size).toBe(0);
    });
  });

  describe("update() with confirm option", () => {
    it("should update with confirm option", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to initial topics
      await topics.subscribeMany(["room:1", "room:2"]);

      // Update with confirmation
      const result = await topics.update(
        (draft) => {
          draft.add("room:3");
          draft.delete("room:1");
        },
        { confirm: "settled" },
      );

      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);
      expect(topics.has("room:1")).toBe(false);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });
  });

  describe("settle() with timeout and signal options", () => {
    it("should settle with timeout", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async () => {
          await new Promise((r) => setTimeout(r, 50));
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start subscribe (will be in-flight)
      const promise = topics.subscribe("room:1");

      // Settle with timeout (should succeed)
      await topics.settle("room:1", { timeoutMs: 200 });

      // Wait for subscribe to complete
      await promise;
      expect(topics.has("room:1")).toBe(true);
    });

    it("should settle a completed operation successfully", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe
      await topics.subscribe("room:1");

      // Settle should complete immediately (operation already settled)
      await topics.settle("room:1", { timeoutMs: 5000 });

      expect(topics.has("room:1")).toBe(true);
    });

    it("should respect pre-aborted signal in settle", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      const ac = new AbortController();
      ac.abort(); // Pre-abort

      try {
        await topics.settle("room:1", { signal: ac.signal });
        expect.unreachable("Should have thrown AbortError");
      } catch (err) {
        // Check for either our custom AbortError or native DOMException AbortError
        const isAbortError =
          err instanceof AbortError ||
          (err instanceof Error && err.name === "AbortError");
        expect(isAbortError).toBe(true);
      }
    });

    it("should settle all in-flight operations with timeout", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async () => {
          await new Promise((r) => setTimeout(r, 50));
        }),
        unsubscribe: mock(async () => {
          await new Promise((r) => setTimeout(r, 50));
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Start multiple in-flight operations
      const sub1 = topics.subscribe("room:1");
      const sub2 = topics.subscribe("room:2");

      // Settle all with timeout
      await topics.settle(undefined, { timeoutMs: 200 });

      // All should be settled
      await Promise.all([sub1, sub2]);
      expect(topics.size).toBe(2);
    });
  });

  describe("confirm option with default ('optimistic') behavior", () => {
    it("should work as before when confirm option is omitted", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe without confirm option (default behavior)
      await topics.subscribe("room:1");

      expect(topics.has("room:1")).toBe(true);
      expect(mockWs.subscribe).toHaveBeenCalled();
    });

    it("should maintain backward compatibility", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // All these should work as before
      await topics.subscribe("room:1");
      await topics.subscribeMany(["room:2", "room:3"]);
      const result = await topics.set(["room:1", "room:4"]);

      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:4")).toBe(true);
      expect(result.total).toBe(2);
    });
  });

  describe("Error handling with confirm option", () => {
    it("should propagate validation errors with confirm='settled'", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      try {
        // Invalid topic name
        await topics.subscribe("", { confirm: "settled" });
        expect.unreachable("Should have thrown PubSubError");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("INVALID_TOPIC");
      }
    });

    it("should not mutate state on adapter error with confirm='settled'", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          throw new Error("Adapter unavailable");
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      try {
        await topics.subscribe("room:1", { confirm: "settled" });
        expect.unreachable("Should have thrown");
      } catch {
        // Expected
      }

      // State should not be mutated
      expect(topics.has("room:1")).toBe(false);
    });
  });

  describe("Concurrent operations with confirm", () => {
    it("should handle concurrent settled subscribes to different topics", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async () => {
          await new Promise((r) => setTimeout(r, 10));
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to multiple topics concurrently with confirmation
      await Promise.all([
        topics.subscribe("room:1", { confirm: "settled" }),
        topics.subscribe("room:2", { confirm: "settled" }),
        topics.subscribe("room:3", { confirm: "settled" }),
      ]);

      expect(topics.size).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });

    it("should serialize per-topic operations even with confirm", async () => {
      const callOrder: string[] = [];
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {
          callOrder.push(`subscribe:${topic}`);
        }),
        unsubscribe: mock((topic: string) => {
          callOrder.push(`unsubscribe:${topic}`);
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Start subscribe (will be in-flight)
      const sub = topics.subscribe("room:1", { confirm: "settled" });

      // Try to unsubscribe while subscribe is in-flight
      // This should wait for subscribe to complete first
      const unsub = topics.unsubscribe("room:1", { confirm: "settled" });

      await Promise.all([sub, unsub]);

      // Subscribe should complete before unsubscribe starts
      expect(callOrder).toEqual(["subscribe:room:1", "unsubscribe:room:1"]);
    });
  });
});
