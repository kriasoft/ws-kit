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
      maxInflightPerSocket: 1000,
      idleTimeoutMs: 5000,
    });
    rpcManager.start();
  });

  afterEach(() => {
    rpcManager.stop();

    // Verify no RPC state leaked from test
    // Check statesByClient map to ensure all clients were cleaned up after disconnect/terminal
    const internalStates = (rpcManager as any).statesByClient as Map<
      string,
      Map<string, unknown>
    >;
    if (internalStates && internalStates.size > 0) {
      throw new Error(
        `RpcManager leaked RPC state: ${internalStates.size} clients still have active state after test`,
      );
    }
  });

  describe("Basic Request Lifecycle", () => {
    it("should track request on onRequest", () => {
      const accepted = rpcManager.onRequest("client-1", "req-1");
      expect(accepted).toBe(true);
      // Clean up
      rpcManager.onTerminal("client-1", "req-1");
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

  describe("Memory Management & Cleanup", () => {
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

    it("should enforce MAX_RECENTLY_TERMINATED with FIFO eviction", () => {
      // The limit is 10,000 (internal constant)
      // Mark more than limit
      for (let i = 0; i < 10050; i++) {
        rpcManager.onRequest("client-1", `req-${i}`);
        rpcManager.onTerminal("client-1", `req-${i}`);
      }

      // Recent entries should still be tracked
      expect(rpcManager.isTerminal("client-1", "req-10049")).toBe(true);
      expect(rpcManager.isTerminal("client-1", "req-10048")).toBe(true);

      // Very old entries MUST be evicted (FIFO guarantee)
      // First entry should be gone (evicted to maintain 10K limit)
      expect(rpcManager.isTerminal("client-1", "req-0")).toBe(false);
      expect(rpcManager.isTerminal("client-1", "req-1")).toBe(false);
      expect(rpcManager.isTerminal("client-1", "req-49")).toBe(false);
    });

    it("should prune and stop tracking active RPC state after terminal", () => {
      // Create and terminate an RPC
      rpcManager.onRequest("client-1", "req-lifecycle");
      const signal = rpcManager.getAbortSignal("client-1", "req-lifecycle");

      // Before terminal, RPC state exists (signal available)
      expect(signal instanceof AbortSignal).toBe(true);
      expect(signal.aborted).toBe(false);

      // After terminal, state is pruned from active tracking
      rpcManager.onTerminal("client-1", "req-lifecycle");

      // But still in recently-terminated for duplicate detection
      expect(rpcManager.isTerminal("client-1", "req-lifecycle")).toBe(true);

      // Getting signal for terminated RPC returns pre-aborted signal
      const secondSignal = rpcManager.getAbortSignal(
        "client-1",
        "req-lifecycle",
      );
      expect(secondSignal.aborted).toBe(true);
    });

    it("should clean up idle RPCs after rpcIdleTimeoutMs", async () => {
      const idleManager = new RpcManager({
        maxInflightPerSocket: 100,
        idleTimeoutMs: 100,
        cleanupCadenceMs: 50, // Check frequently
      });
      idleManager.start();

      try {
        // Create an idle RPC
        idleManager.onRequest("client-1", "req-idle");
        const signal = idleManager.getAbortSignal("client-1", "req-idle");
        expect(signal.aborted).toBe(false);

        // Poll for cleanup with a reasonable timeout
        // Idle timeout: 100ms, cleanup interval: 50ms, plus buffer for system variance
        let attempts = 0;
        const maxAttempts = 50; // Up to 500ms total (50 * 10ms)
        while (!signal.aborted && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          attempts++;
        }

        // RPC should be cleaned up: signal aborted
        expect(signal.aborted).toBe(true);
        expect(attempts).toBeLessThan(maxAttempts); // Verify it cleaned up before timeout
      } finally {
        idleManager.stop();
      }
    });

    it("should NOT clean up active RPCs that are regularly updated", async () => {
      const idleManager = new RpcManager({
        maxInflightPerSocket: 100,
        idleTimeoutMs: 100,
        cleanupCadenceMs: 50,
      });
      idleManager.start();

      try {
        idleManager.onRequest("client-1", "req-active");
        const signal = idleManager.getAbortSignal("client-1", "req-active");

        // Send progress updates to keep RPC alive every 40ms
        // This is faster than the 100ms idle timeout, so RPC stays alive
        const progressInterval = setInterval(() => {
          idleManager.onProgress("client-1", "req-active");
        }, 40);

        try {
          // Wait for a period longer than idle timeout with regular updates
          // With updates every 40ms and idle timeout of 100ms, RPC should survive
          await new Promise((resolve) => setTimeout(resolve, 250));

          // RPC should still be alive due to activity
          expect(signal.aborted).toBe(false);
        } finally {
          clearInterval(progressInterval);
          // Clean up
          idleManager.onTerminal("client-1", "req-active");
        }
      } finally {
        idleManager.stop();
      }
    });

    it("should clean up TTL-expired entries from recently-terminated", async () => {
      const ttlManager = new RpcManager({
        maxInflightPerSocket: 100,
        cleanupCadenceMs: 50,
        dedupWindowMs: 100, // Short TTL for testing
      });
      ttlManager.start();

      try {
        // Create and immediately terminate an RPC
        ttlManager.onRequest("client-1", "req-ttl");
        ttlManager.onTerminal("client-1", "req-ttl");

        // Entry should be in recently-terminated immediately after terminal
        expect(ttlManager.isTerminal("client-1", "req-ttl")).toBe(true);

        // Poll for TTL cleanup with reasonable timeout
        // TTL: 100ms, cleanup interval: 50ms, plus buffer for system variance
        let attempts = 0;
        const maxAttempts = 50; // Up to 500ms total (50 * 10ms)
        while (
          ttlManager.isTerminal("client-1", "req-ttl") &&
          attempts < maxAttempts
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          attempts++;
        }

        // Entry should now be removed from recently-terminated
        // Subsequent isTerminal calls will return false (not in the map)
        expect(ttlManager.isTerminal("client-1", "req-ttl")).toBe(false);
        expect(attempts).toBeLessThan(maxAttempts); // Verify it cleaned up before timeout
      } finally {
        ttlManager.stop();
      }
    });
  });

  describe("Inflight Request Limits", () => {
    it("should reject request if inflight limit exceeded", () => {
      const maxInflight = 10;
      const limited = new RpcManager({ maxInflightPerSocket: maxInflight });

      try {
        // Create maxInflight requests
        for (let i = 0; i < maxInflight; i++) {
          const accepted = limited.onRequest("client-1", `req-${i}`);
          expect(accepted).toBe(true);
        }

        // Next request should be rejected
        const rejected = limited.onRequest("client-1", `req-${maxInflight}`);
        expect(rejected).toBe(false);
      } finally {
        // Clean up all in-flight RPCs
        for (let i = 0; i < maxInflight; i++) {
          limited.onTerminal("client-1", `req-${i}`);
        }
      }
    });

    it("should allow new request after terminal frees slot", () => {
      const maxInflight = 5;
      const limited = new RpcManager({ maxInflightPerSocket: maxInflight });

      try {
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

        // Clean up remaining requests
        for (let i = 1; i < maxInflight; i++) {
          limited.onTerminal("client-1", `req-${i}`);
        }
        limited.onTerminal("client-1", "req-new");
      } finally {
        // Ensure cleanup even if test fails
      }
    });

    it("should track inflight per socket independently", () => {
      const maxInflight = 5;
      const limited = new RpcManager({ maxInflightPerSocket: maxInflight });

      try {
        // Fill client-1
        for (let i = 0; i < maxInflight; i++) {
          limited.onRequest("client-1", `req-${i}`);
        }

        // client-1 should be at limit
        expect(limited.onRequest("client-1", "req-extra")).toBe(false);

        // But client-2 should still accept
        expect(limited.onRequest("client-2", "req-1")).toBe(true);

        // Clean up all requests from both clients
        for (let i = 0; i < maxInflight; i++) {
          limited.onTerminal("client-1", `req-${i}`);
        }
        limited.onTerminal("client-2", "req-1");
      } finally {
        // Ensure cleanup even if test fails
      }
    });
  });

  describe("AbortSignal Management", () => {
    it("should provide AbortSignal for active RPC", () => {
      rpcManager.onRequest("client-1", "req-1");
      const signal = rpcManager.getAbortSignal("client-1", "req-1");

      expect(signal instanceof AbortSignal).toBe(true);
      expect(signal.aborted).toBe(false);
      // Clean up
      rpcManager.onTerminal("client-1", "req-1");
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
      // Clean up (onAbort doesn't call onTerminal, so we do it manually)
      rpcManager.onTerminal("client-1", "req-1");
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
      // Clean up
      rpcManager.onTerminal("client-1", "req-1");
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
      // Clean up
      rpcManager.onTerminal("client-1", "req-1");
    });

    it("should fire multiple callbacks on abort", () => {
      rpcManager.onRequest("client-1", "req-1");

      let count = 0;
      rpcManager.onCancel("client-1", "req-1", () => count++);
      rpcManager.onCancel("client-1", "req-1", () => count++);
      rpcManager.onCancel("client-1", "req-1", () => count++);

      rpcManager.onAbort("client-1", "req-1");

      expect(count).toBe(3);
      // Clean up
      rpcManager.onTerminal("client-1", "req-1");
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
      // Clean up
      rpcManager.onTerminal("client-1", "req-1");
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

      // Clean up
      rpcManager.onTerminal("client-1", "req-1");
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

      // Clean up the new request
      rpcManager.onTerminal("client-1", "req-2");
    });

    it("should abort signals for all in-flight on disconnect", () => {
      rpcManager.onRequest("client-1", "req-1");
      const signal = rpcManager.getAbortSignal("client-1", "req-1");

      expect(signal.aborted).toBe(false);

      rpcManager.onDisconnect("client-1");

      expect(signal.aborted).toBe(true);
    });
  });
});
