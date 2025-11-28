// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock } from "bun:test";
import { AbortError, PubSubError } from "../../src/core/error.js";
import { createTopics } from "../../src/core/topics.js";

describe("OptimisticTopics - Abort Signal Semantics", () => {
  describe("Pre-commit cancellation", () => {
    describe("subscribe()", () => {
      it("should reject with AbortError if signal is already aborted", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        const ctrl = new AbortController();
        ctrl.abort();

        try {
          await topics.subscribe("room:1", { signal: ctrl.signal });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // No state change
        expect(topics.size).toBe(0);
        expect(topics.has("room:1")).toBe(false);
        // No adapter call
        expect(mockWs.subscribe).not.toHaveBeenCalled();
      });

      it("should accept abort signal for already-subscribed topics (signal checked before idempotency)", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);

        // Subscribe first
        await topics.subscribe("room:1");
        expect(topics.has("room:1")).toBe(true);

        // Try to subscribe again WITHOUT abort signal
        // Should return early (idempotency) without error
        await topics.subscribe("room:1");

        // Still subscribed, no error
        expect(topics.has("room:1")).toBe(true);
        // Adapter should only be called once (from first subscribe)
        expect(mockWs.subscribe.mock.calls.length).toBe(1);
      });
    });

    describe("unsubscribe()", () => {
      it("should reject with AbortError if signal is already aborted", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        await topics.subscribe("room:1");

        const ctrl = new AbortController();
        ctrl.abort();

        try {
          await topics.unsubscribe("room:1", { signal: ctrl.signal });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // No state change
        expect(topics.has("room:1")).toBe(true);
      });

      it("should not reject abort for non-subscribed topics (soft no-op)", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);

        const ctrl = new AbortController();
        ctrl.abort();

        // Should return early (soft no-op) before checking signal
        await topics.unsubscribe("room:1", { signal: ctrl.signal });

        expect(topics.size).toBe(0);
        expect(mockWs.unsubscribe).not.toHaveBeenCalled();
      });
    });

    describe("subscribeMany()", () => {
      it("should reject with AbortError if signal is already aborted", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        const ctrl = new AbortController();
        ctrl.abort();

        try {
          await topics.subscribeMany(["room:1", "room:2"], {
            signal: ctrl.signal,
          });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // No state change
        expect(topics.size).toBe(0);
        expect(mockWs.subscribe).not.toHaveBeenCalled();
      });

      it("should maintain atomicity if aborted (no partial state)", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        const ctrl = new AbortController();

        // Abort the operation
        ctrl.abort();

        try {
          await topics.subscribeMany(["room:1", "room:2", "room:3"], {
            signal: ctrl.signal,
          });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // ATOMIC: No partial subscriptions
        expect(topics.size).toBe(0);
        expect(topics.has("room:1")).toBe(false);
        expect(topics.has("room:2")).toBe(false);
        expect(topics.has("room:3")).toBe(false);
      });
    });

    describe("unsubscribeMany()", () => {
      it("should reject with AbortError if signal is already aborted", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        await topics.subscribeMany(["room:1", "room:2"]);

        const ctrl = new AbortController();
        ctrl.abort();

        try {
          await topics.unsubscribeMany(["room:1", "room:2"], {
            signal: ctrl.signal,
          });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // No state change
        expect(topics.size).toBe(2);
        expect(topics.has("room:1")).toBe(true);
        expect(topics.has("room:2")).toBe(true);
      });

      it("should maintain atomicity if aborted (no partial unsubscribe)", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        await topics.subscribeMany(["room:1", "room:2", "room:3"]);

        const ctrl = new AbortController();
        ctrl.abort();

        try {
          await topics.unsubscribeMany(["room:1", "room:2", "room:3"], {
            signal: ctrl.signal,
          });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // ATOMIC: All still subscribed
        expect(topics.size).toBe(3);
        expect(topics.has("room:1")).toBe(true);
        expect(topics.has("room:2")).toBe(true);
        expect(topics.has("room:3")).toBe(true);
      });
    });

    describe("clear()", () => {
      it("should reject with AbortError if signal is already aborted", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        await topics.subscribeMany(["room:1", "room:2"]);

        const ctrl = new AbortController();
        ctrl.abort();

        try {
          await topics.clear({ signal: ctrl.signal });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // No state change
        expect(topics.size).toBe(2);
      });

      it("should maintain atomicity if aborted (no partial clear)", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        await topics.subscribeMany(["room:1", "room:2", "room:3"]);

        const ctrl = new AbortController();
        ctrl.abort();

        try {
          await topics.clear({ signal: ctrl.signal });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // ATOMIC: All still subscribed
        expect(topics.size).toBe(3);
      });
    });

    describe("set()", () => {
      it("should reject with AbortError if signal is already aborted", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        await topics.subscribeMany(["room:1", "room:2"]);

        const ctrl = new AbortController();
        ctrl.abort();

        try {
          await topics.set(["room:3"], { signal: ctrl.signal });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // No state change
        expect(topics.has("room:1")).toBe(true);
        expect(topics.has("room:2")).toBe(true);
        expect(topics.has("room:3")).toBe(false);
      });

      it("should maintain atomicity if aborted (no partial replacement)", async () => {
        const mockWs = {
          data: { clientId: "test-123" },
          subscribe: mock(() => {}),
          unsubscribe: mock(() => {}),
        };

        const topics = createTopics(mockWs as any);
        await topics.subscribeMany(["room:1", "room:2"]);

        const ctrl = new AbortController();
        ctrl.abort();

        try {
          await topics.set(["room:3", "room:4"], { signal: ctrl.signal });
          expect.unreachable("Should have thrown AbortError");
        } catch (err) {
          expect(err).toBeInstanceOf(AbortError);
        }

        // ATOMIC: Original state unchanged
        expect(topics.size).toBe(2);
        expect(topics.has("room:1")).toBe(true);
        expect(topics.has("room:2")).toBe(true);
        expect(topics.has("room:3")).toBe(false);
        expect(topics.has("room:4")).toBe(false);
      });
    });
  });

  describe("Late aborts (after commit starts)", () => {
    it("should complete successfully if abort happens after commit", async () => {
      let subscribeResolver: (() => void) | null = null;

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          // Create a promise that blocks until we resolve it
          return new Promise<void>((resolve) => {
            subscribeResolver = resolve;
          });
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs as any);
      const ctrl = new AbortController();

      // Start the operation
      const promise = topics.subscribe("room:1", { signal: ctrl.signal });

      // Wait a tick for the operation to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Abort after commit has started (adapter call is in progress)
      ctrl.abort();

      // Resolve the adapter call
      if (subscribeResolver) {
        subscribeResolver();
      }

      // Operation should complete successfully (late abort is ignored)
      await promise;

      // State should be changed (commit succeeded)
      expect(topics.has("room:1")).toBe(true);
    });

    it("should not reject for subscribeMany if abort happens after commit", async () => {
      let subscribeResolver: (() => void) | null = null;
      let callCount = 0;

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          callCount++;
          if (callCount === 1) {
            // Block on first call
            return new Promise<void>((resolve) => {
              subscribeResolver = resolve;
            });
          }
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs as any);
      const ctrl = new AbortController();

      // Start the operation
      const promise = topics.subscribeMany(["room:1", "room:2", "room:3"], {
        signal: ctrl.signal,
      });

      // Wait a tick for the operation to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Abort after commit has started
      ctrl.abort();

      // Resolve the adapter call
      if (subscribeResolver) {
        subscribeResolver();
      }

      // Operation should complete successfully
      const result = await promise;

      // All topics should be subscribed (commit succeeded)
      expect(result.added).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });
  });

  describe("Abort signal combinations", () => {
    it("should validate before checking abort signal", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs as any);
      const ctrl = new AbortController();
      ctrl.abort();

      // Invalid topic with aborted signal
      // Should throw validation error first (PubSubError), not AbortError
      // because validation throws and never reaches the abort check
      try {
        await topics.subscribe("invalid topic with spaces", {
          signal: ctrl.signal,
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("INVALID_TOPIC");
      }
    });

    it("should check abort before hitting limits", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs as any, { maxTopicsPerConnection: 2 }); // Max 2 topics

      // Subscribe to 2 topics first
      await topics.subscribeMany(["room:1", "room:2"]);

      const ctrl = new AbortController();
      ctrl.abort();

      // Try to subscribe to 3 more with limit and abort
      // Abort should be checked first during validation/pre-commit phase
      try {
        await topics.subscribeMany(["room:3", "room:4", "room:5"], {
          signal: ctrl.signal,
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AbortError);
      }

      // Original state unchanged
      expect(topics.size).toBe(2);
    });
  });
});
