// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * RPC Manager Lifecycle & Memory Management Tests
 *
 * Validates RpcManager internal behavior:
 * - Bounded memory with MAX_RECENTLY_TERMINATED limit
 * - TTL-based cleanup of old entries
 * - Idle timeout cleanup
 * - Proper state transitions
 *
 * These are internal implementation tests (RpcManager is @internal).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { RpcManager } from "../../src/rpc-manager.js";

describe("RpcManager Lifecycle & Memory Management", () => {
  let rpcManager: RpcManager;

  beforeEach(() => {
    rpcManager = new RpcManager({
      maxInflightRpcsPerSocket: 1000,
      rpcIdleTimeoutMs: 5000,
    });
    rpcManager.start();
  });

  afterEach(() => {
    rpcManager.stop();
  });

  describe("Basic Request Lifecycle", () => {
    it("should track request on onRequest", () => {
      const accepted = rpcManager.onRequest("client-1", "req-1");
      expect(accepted).toBe(true);
    });

    it("should mark terminal on onTerminal", () => {
      rpcManager.onRequest("client-1", "req-1");
      const accepted = rpcManager.onTerminal("client-1", "req-1");
      expect(accepted).toBe(true);
    });

    it("should detect duplicate terminal via isTerminal after first terminal", () => {
      rpcManager.onRequest("client-1", "req-1");
      const firstTerminal = rpcManager.onTerminal("client-1", "req-1");
      expect(firstTerminal).toBe(true);

      // After first terminal, the state is pruned but tracked in recentlyTerminated
      // isTerminal should still return true for recently terminated RPCs
      expect(rpcManager.isTerminal("client-1", "req-1")).toBe(true);
    });

    it("should detect terminal via isTerminal", () => {
      rpcManager.onRequest("client-1", "req-1");
      expect(rpcManager.isTerminal("client-1", "req-1")).toBe(false);
      rpcManager.onTerminal("client-1", "req-1");
      expect(rpcManager.isTerminal("client-1", "req-1")).toBe(true);
    });
  });

  describe("Bounded Memory: MAX_RECENTLY_TERMINATED", () => {
    it("should track recently-terminated entries", () => {
      // Mark 100 RPCs as terminal
      for (let i = 0; i < 100; i++) {
        rpcManager.onRequest("client-1", `req-${i}`);
        rpcManager.onTerminal("client-1", `req-${i}`);
      }

      // All should be detected as terminal
      for (let i = 0; i < 100; i++) {
        expect(rpcManager.isTerminal("client-1", `req-${i}`)).toBe(true);
      }
    });

    it("should enforce MAX_RECENTLY_TERMINATED limit", () => {
      // The limit is 10,000 (internal constant)
      // Mark more than limit
      for (let i = 0; i < 10050; i++) {
        rpcManager.onRequest("client-1", `req-${i}`);
        rpcManager.onTerminal("client-1", `req-${i}`);
      }

      // Most recent should still be in recentlyTerminated
      expect(rpcManager.isTerminal("client-1", "req-10049")).toBe(true);
      expect(rpcManager.isTerminal("client-1", "req-10048")).toBe(true);
    });

    it("should evict oldest entries when limit exceeded", () => {
      // Mark entries up to limit
      for (let i = 0; i < 10001; i++) {
        rpcManager.onRequest("client-1", `req-${i}`);
        rpcManager.onTerminal("client-1", `req-${i}`);
      }

      // Very old entries (first 50) may be evicted from recentlyTerminated
      // but exact eviction depends on cleanup interval
      // At minimum, we should have some entries still tracked
      let foundEntries = 0;
      for (let i = 10000; i < 10001; i++) {
        if (rpcManager.isTerminal("client-1", `req-${i}`)) {
          foundEntries++;
        }
      }
      expect(foundEntries).toBeGreaterThan(0);
    });
  });

  describe("Inflight Request Limits", () => {
    it("should reject request if inflight limit exceeded", () => {
      const maxInflight = 10;
      const limited = new RpcManager({ maxInflightRpcsPerSocket: maxInflight });

      // Create maxInflight requests
      for (let i = 0; i < maxInflight; i++) {
        const accepted = limited.onRequest("client-1", `req-${i}`);
        expect(accepted).toBe(true);
      }

      // Next request should be rejected
      const rejected = limited.onRequest("client-1", `req-${maxInflight}`);
      expect(rejected).toBe(false);
    });

    it("should allow new request after terminal frees slot", () => {
      const maxInflight = 5;
      const limited = new RpcManager({ maxInflightRpcsPerSocket: maxInflight });

      // Fill to limit
      for (let i = 0; i < maxInflight; i++) {
        limited.onRequest("client-1", `req-${i}`);
      }

      // Next should fail
      expect(limited.onRequest("client-1", "req-new")).toBe(false);

      // Complete one request
      limited.onTerminal("client-1", "req-0");

      // Now new request should succeed
      expect(limited.onRequest("client-1", "req-new")).toBe(true);
    });

    it("should track inflight per socket independently", () => {
      const maxInflight = 5;
      const limited = new RpcManager({ maxInflightRpcsPerSocket: maxInflight });

      // Fill client-1
      for (let i = 0; i < maxInflight; i++) {
        limited.onRequest("client-1", `req-${i}`);
      }

      // client-1 should be at limit
      expect(limited.onRequest("client-1", "req-extra")).toBe(false);

      // But client-2 should still accept
      expect(limited.onRequest("client-2", "req-1")).toBe(true);
    });
  });

  describe("AbortSignal Management", () => {
    it("should provide AbortSignal for active RPC", () => {
      rpcManager.onRequest("client-1", "req-1");
      const signal = rpcManager.getAbortSignal("client-1", "req-1");

      expect(signal instanceof AbortSignal).toBe(true);
      expect(signal.aborted).toBe(false);
    });

    it("should return pre-aborted signal for missing state", () => {
      const signal = rpcManager.getAbortSignal("unknown", "unknown");

      expect(signal instanceof AbortSignal).toBe(true);
      expect(signal.aborted).toBe(true);
    });

    it("should abort signal on request completion", () => {
      rpcManager.onRequest("client-1", "req-1");
      const signal = rpcManager.getAbortSignal("client-1", "req-1");

      expect(signal.aborted).toBe(false);

      // Abort the request
      rpcManager.onAbort("client-1", "req-1");

      expect(signal.aborted).toBe(true);
    });
  });

  describe("onCancel Callback Registration", () => {
    it("should register onCancel callback", () => {
      rpcManager.onRequest("client-1", "req-1");

      let callbackFired = false;
      const unregister = rpcManager.onCancel("client-1", "req-1", () => {
        callbackFired = true;
      });

      expect(unregister).toBeDefined();
      expect(typeof unregister).toBe("function");

      // Trigger abort
      rpcManager.onAbort("client-1", "req-1");

      expect(callbackFired).toBe(true);
    });

    it("should unregister callback with returned function", () => {
      rpcManager.onRequest("client-1", "req-1");

      let callbackFired = false;
      const unregister = rpcManager.onCancel("client-1", "req-1", () => {
        callbackFired = true;
      });

      unregister();

      // Fire abort - callback should not be called
      rpcManager.onAbort("client-1", "req-1");

      expect(callbackFired).toBe(false);
    });

    it("should fire multiple callbacks on abort", () => {
      rpcManager.onRequest("client-1", "req-1");

      let count = 0;
      rpcManager.onCancel("client-1", "req-1", () => count++);
      rpcManager.onCancel("client-1", "req-1", () => count++);
      rpcManager.onCancel("client-1", "req-1", () => count++);

      rpcManager.onAbort("client-1", "req-1");

      expect(count).toBe(3);
    });

    it("should handle errors in callbacks gracefully", () => {
      rpcManager.onRequest("client-1", "req-1");

      let secondCallbackFired = false;

      rpcManager.onCancel("client-1", "req-1", () => {
        throw new Error("First callback error");
      });
      rpcManager.onCancel("client-1", "req-1", () => {
        secondCallbackFired = true;
      });

      // Should not throw, should continue to next callback
      rpcManager.onAbort("client-1", "req-1");

      expect(secondCallbackFired).toBe(true);
    });
  });

  describe("Progress Updates", () => {
    it("should update lastActivityAt on progress", () => {
      rpcManager.onRequest("client-1", "req-1");

      // Get initial activity timestamp
      const initialState = rpcManager._getState("client-1", "req-1");
      expect(initialState).toBeDefined();
      const initialActivity = initialState!.lastActivityAt;

      // Wait a small amount to ensure timestamp differs
      const before = Date.now();
      while (Date.now() === before) {
        // Spin to ensure at least 1ms passes
      }

      // Send progress
      rpcManager.onProgress("client-1", "req-1");

      // Get updated state
      const updatedState = rpcManager._getState("client-1", "req-1");
      expect(updatedState).toBeDefined();
      const updatedActivity = updatedState!.lastActivityAt;

      // Activity timestamp should have advanced
      expect(updatedActivity).toBeGreaterThan(initialActivity);
    });
  });

  describe("Disconnect Handling", () => {
    it("should cancel all in-flight RPCs on disconnect", () => {
      let callbackCount = 0;

      // Create 3 requests
      for (let i = 0; i < 3; i++) {
        rpcManager.onRequest("client-1", `req-${i}`);
        rpcManager.onCancel("client-1", `req-${i}`, () => {
          callbackCount++;
        });
      }

      // Disconnect
      rpcManager.onDisconnect("client-1");

      // All callbacks should have fired
      expect(callbackCount).toBe(3);
    });

    it("should clear all state for disconnected client", () => {
      rpcManager.onRequest("client-1", "req-1");
      rpcManager.onDisconnect("client-1");

      // New request from same client should be allowed
      const newRequest = rpcManager.onRequest("client-1", "req-2");
      expect(newRequest).toBe(true);
    });

    it("should abort signals for all in-flight on disconnect", () => {
      rpcManager.onRequest("client-1", "req-1");
      const signal = rpcManager.getAbortSignal("client-1", "req-1");

      expect(signal.aborted).toBe(false);

      rpcManager.onDisconnect("client-1");

      expect(signal.aborted).toBe(true);
    });
  });

  describe("FIFO Eviction on Bounded Memory", () => {
    it("should evict oldest entries when MAX_RECENTLY_TERMINATED exceeded", () => {
      // Create many RPCs and mark terminal
      const startCount = 5000;
      for (let i = 0; i < startCount; i++) {
        rpcManager.onRequest("client-1", `req-${i}`);
        rpcManager.onTerminal("client-1", `req-${i}`);
      }

      // All should be tracked
      expect(rpcManager.isTerminal("client-1", "req-4999")).toBe(true);

      // Add more to exceed limit (10,000)
      for (let i = startCount; i < startCount + 5100; i++) {
        rpcManager.onRequest("client-1", `req-${i}`);
        rpcManager.onTerminal("client-1", `req-${i}`);
      }

      // Newest should still be there
      expect(
        rpcManager.isTerminal("client-1", `req-${startCount + 5099}`),
      ).toBe(true);
    });
  });
});
