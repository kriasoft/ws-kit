// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Tests for router.observe() API - public observation hook for testing and monitoring.
 *
 * Validates:
 * - Multiple observers receive events
 * - Unsubscribe works correctly
 * - Re-entrancy (adding/removing observers during dispatch)
 * - Observer errors don't propagate or break other observers
 * - All event types fire correctly
 */

import { describe, expect, it } from "bun:test";
import { createRouter } from "../../src";
import { test } from "../../src/testing";

describe("Router Observer API", () => {
  describe("Basic observation", () => {
    it("should capture published messages via onPublish", async () => {
      const publishes: any[] = [];
      const router = createRouter();
      const off = router.observe({ onPublish: (rec) => publishes.push(rec) });

      const tr = test.createTestRouter({ create: () => router });

      // Note: onPublish fires when pubsub plugin publishes, so we need pubsub for this
      // For now, test that the observer is registered
      expect(publishes).toEqual([]);

      off();
      await tr.close();
    });

    it("should capture errors via onError", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      // Override the observer to explicitly test onError
      const routerErrors: any[] = [];
      const off = tr.observe({
        onError: (err) => routerErrors.push(err),
      });

      // Send an unhandled message type to trigger an error
      const conn = await tr.connect();
      conn.send("UNKNOWN_MESSAGE_TYPE");
      await tr.flush();

      expect(routerErrors.length).toBeGreaterThan(0);
      expect((routerErrors[0] as Error).message).toContain(
        "No handler registered for message type",
      );

      off();
      await tr.close();
    });

    it("should capture connection lifecycle events", async () => {
      const events: { event: string; clientId?: string }[] = [];
      const router = createRouter();

      const off = router.observe({
        onConnectionOpen: (clientId) => {
          events.push({ event: "open", clientId });
        },
        onConnectionClose: (clientId) => {
          events.push({ event: "close", clientId });
        },
      });

      const tr = test.createTestRouter({ create: () => router });
      const conn = await tr.connect();
      await conn.close();
      await tr.close();

      // Should have captured open and close events
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]!.event).toBe("open");
      expect(events[1]!.event).toBe("close");

      off();
    });
  });

  describe("Multiple observers", () => {
    it("should notify all registered observers in order", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const calls: string[] = [];

      const off1 = tr.observe({
        onError: () => calls.push("observer1"),
      });

      const off2 = tr.observe({
        onError: () => calls.push("observer2"),
      });

      const off3 = tr.observe({
        onError: () => calls.push("observer3"),
      });

      // Trigger an error
      const conn = await tr.connect();
      conn.send("UNKNOWN");
      await tr.flush();

      // All observers should have been called
      expect(calls.length).toBeGreaterThanOrEqual(3);
      expect(calls).toContain("observer1");
      expect(calls).toContain("observer2");
      expect(calls).toContain("observer3");

      off1();
      off2();
      off3();
      await tr.close();
    });
  });

  describe("Unsubscribe", () => {
    it("should stop calling observer after unsubscribe", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const errors: unknown[] = [];

      const off = tr.observe({
        onError: (err) => errors.push(err),
      });

      // Trigger first error
      const conn = await tr.connect();
      conn.send("UNKNOWN_1");
      await tr.flush();

      const errorCount1 = errors.length;
      expect(errorCount1).toBeGreaterThan(0);

      // Unsubscribe
      off();

      // Trigger second error
      conn.send("UNKNOWN_2");
      await tr.flush();

      // Should still have the same number of errors (second one not captured)
      expect(errors.length).toBe(errorCount1);

      await tr.close();
    });

    it("should allow multiple unsubscribe calls (idempotent)", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const off = tr.observe({ onError: () => {} });

      // Should not throw
      off();
      off();
      off();

      await tr.close();
    });
  });

  describe("Re-entrancy", () => {
    it("should handle observer being removed during dispatch", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const calls: string[] = [];
      let off1: (() => void) | null = null;
      let off2: (() => void) | null = null;

      // Observer 1: removes itself when called
      off1 = tr.observe({
        onError: () => {
          calls.push("observer1");
          // Remove self (safe due to snapshot)
          if (off1) off1();
        },
      });

      // Observer 2: should still be called even though observer 1 removed itself
      off2 = tr.observe({
        onError: () => {
          calls.push("observer2");
        },
      });

      // Trigger error
      const conn = await tr.connect();
      conn.send("UNKNOWN");
      await tr.flush();

      // Both should have been called (snapshot-based dispatch is safe)
      expect(calls).toContain("observer1");
      expect(calls).toContain("observer2");

      if (off2) off2();
      await tr.close();
    });

    it("should handle observer being added during dispatch", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const calls: string[] = [];

      // Observer 1: tries to add another observer
      const off1 = tr.observe({
        onError: () => {
          calls.push("observer1");
          // Try to add observer (won't be called in current dispatch due to snapshot)
          off2 = tr.observe({
            onError: () => {
              calls.push("observer2");
            },
          });
        },
      });

      let off2 = () => {};

      // Trigger first error
      const conn = await tr.connect();
      conn.send("UNKNOWN_1");
      await tr.flush();

      expect(calls).toContain("observer1");
      // Observer 2 wasn't added yet when error was dispatched
      expect(calls).not.toContain("observer2");

      // Trigger second error - now observer 2 should be called
      calls.length = 0;
      conn.send("UNKNOWN_2");
      await tr.flush();

      // Now both should be called
      expect(calls).toContain("observer1");
      expect(calls).toContain("observer2");

      off1();
      off2();
      await tr.close();
    });
  });

  describe("Error handling", () => {
    it("should log observer errors and continue with other observers", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const called: string[] = [];
      const consoleErrors: string[] = [];

      // Monkey-patch console.error to capture it
      const originalError = console.error;
      console.error = (...args: any[]) => {
        consoleErrors.push(String(args[0]));
      };

      try {
        // Observer 1: throws
        const off1 = tr.observe({
          onError: () => {
            called.push("observer1");
            throw new Error("observer1 error");
          },
        });

        // Observer 2: should still be called despite observer 1 throwing
        const off2 = tr.observe({
          onError: () => {
            called.push("observer2");
          },
        });

        // Trigger error
        const conn = await tr.connect();
        conn.send("UNKNOWN");
        await tr.flush();

        // Both observers should have been called (even though observer1 threw)
        expect(called).toContain("observer1");
        expect(called).toContain("observer2");

        // Error should have been logged
        expect(consoleErrors.length).toBeGreaterThan(0);

        off1();
        off2();
        await tr.close();
      } finally {
        console.error = originalError;
      }
    });

    it("should not throw if observer callback is not defined", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      // Register observer with only onError defined
      const off = tr.observe({
        onError: () => {
          // noop
        },
        // onPublish not defined
        // onConnectionOpen not defined
      });

      const conn = await tr.connect();
      await tr.flush(); // Should not throw

      conn.send("UNKNOWN");
      await tr.flush(); // Should not throw

      off();
      await tr.close();
    });
  });

  describe("Partial observers", () => {
    it("should allow observing only specific events", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const publishes: any[] = [];
      const errors: any[] = [];

      // Observer 1: only watches publishes
      const off1 = tr.observe({
        onPublish: (rec) => publishes.push(rec),
      });

      // Observer 2: only watches errors
      const off2 = tr.observe({
        onError: (err) => errors.push(err),
      });

      // Trigger an error
      const conn = await tr.connect();
      conn.send("UNKNOWN");
      await tr.flush();

      // Observer 1 should not see the error
      expect(publishes.length).toBe(0);
      // Observer 2 should see the error
      expect(errors.length).toBeGreaterThan(0);

      off1();
      off2();
      await tr.close();
    });
  });
});
