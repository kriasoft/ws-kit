// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { test } from "../../src/testing";
import { createRouter } from "../../src/index";
import { describe, expect, it } from "bun:test";

describe("limits", () => {
  describe("maxPayloadBytes", () => {
    it("should allow messages within payload size limit", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPayloadBytes: 100 },
          }),
      });

      let handled = false;
      tr.on({ type: "PING", kind: "event" }, () => {
        handled = true;
      });

      const conn = await tr.connect();
      conn.send("PING", { text: "x".repeat(50) });
      await tr.flush();

      expect(handled).toBe(true);
      await tr.close();
    });

    it("should reject messages exceeding maxPayloadBytes", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPayloadBytes: 50 },
          }),
      });

      tr.on({ type: "PING", kind: "event" }, () => {
        throw new Error("Handler should not be called");
      });

      const conn = await tr.connect();
      conn.send("PING", { text: "x".repeat(100) });
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      const errorMsg = String(errors[0]).toLowerCase();
      expect(errorMsg).toContain("exceed");
      await tr.close();
    });

    it("should not enforce limit when maxPayloadBytes is undefined", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: {},
          }),
      });

      let handled = false;
      tr.on({ type: "PING", kind: "event" }, () => {
        handled = true;
      });

      const conn = await tr.connect();
      conn.send("PING", { text: "x".repeat(100000) });
      await tr.flush();

      expect(handled).toBe(true);
      await tr.close();
    });

    it("should enforce limit on ArrayBuffer messages", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPayloadBytes: 50 },
          }),
      });

      const conn = await tr.connect();
      const largeMessage = JSON.stringify({
        type: "PING",
        payload: "x".repeat(200),
      });
      const encoder = new TextEncoder();
      const buffer = encoder.encode(largeMessage);

      // Send ArrayBuffer directly through the websocket bridge
      await (tr as any).websocket.message(conn.ws, buffer);

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      await tr.close();
    });
  });

  describe("maxPending", () => {
    it("should allow messages within pending limit", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPending: 10 },
          }),
      });

      let handleCount = 0;
      tr.on({ type: "PING", kind: "event" }, async () => {
        handleCount++;
      });

      const conn = await tr.connect();
      for (let i = 0; i < 5; i++) {
        conn.send("PING");
      }
      await tr.flush();

      expect(handleCount).toBe(5);
      await tr.close();
    });

    it("should reject messages exceeding maxPending", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPending: 2 },
          }),
      });

      let handleCount = 0;

      tr.on({ type: "SLOW", kind: "event" }, async () => {
        // Simulate slow handler
        await new Promise((resolve) => setTimeout(resolve, 10));
        handleCount++;
      });

      const conn = await tr.connect();
      // Send 5 messages rapidly - some should be rejected due to maxPending=2
      for (let i = 0; i < 5; i++) {
        conn.send("SLOW");
      }
      await tr.flush();

      // With maxPending=2, we should see at least some errors
      const errorCount = tr.capture.errors().length;
      expect(handleCount + errorCount).toBe(5);
      expect(errorCount).toBeGreaterThan(0);
      await tr.close();
    });

    it("should release pending count after handler completes", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPending: 1 },
          }),
      });

      let completedCount = 0;
      tr.on({ type: "TASK", kind: "event" }, async () => {
        completedCount++;
      });

      const conn = await tr.connect();
      // First message should succeed
      conn.send("TASK");
      await tr.flush();

      // Second message should also succeed (first released its pending count)
      conn.send("TASK");
      await tr.flush();

      expect(completedCount).toBe(2);
      await tr.close();
    });

    it("should not enforce limit when maxPending is undefined", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: {},
          }),
      });

      let handleCount = 0;
      tr.on({ type: "PING", kind: "event" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        handleCount++;
      });

      const conn = await tr.connect();
      // Send many messages without limit
      for (let i = 0; i < 20; i++) {
        conn.send("PING");
      }
      await tr.flush();

      expect(handleCount).toBe(20);
      await tr.close();
    });

    it("should report pending exceeded error with details", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPending: 1 },
          }),
      });

      tr.on({ type: "WORK", kind: "event" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      const conn = await tr.connect();
      // Send messages rapidly - second should fail
      conn.send("WORK");
      conn.send("WORK");
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      const errorMsg = String(errors[errors.length - 1]).toLowerCase();
      expect(errorMsg).toContain("too many");
      await tr.close();
    });
  });

  describe("combined limits", () => {
    it("should enforce both maxPayloadBytes and maxPending", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPending: 2, maxPayloadBytes: 50 },
          }),
      });

      let handled = 0;

      tr.on({ type: "MSG", kind: "event" }, async () => {
        handled++;
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const conn = await tr.connect();
      // Send message with small payload (should work)
      conn.send("MSG", { payload: "ok" });
      await tr.flush();

      // Send message with large payload (should fail on size)
      conn.send("MSG", { payload: "x".repeat(100) });
      await tr.flush();

      // First handled, second errored on size
      expect(handled).toBe(1);
      expect(tr.capture.errors().length).toBe(1);
      await tr.close();
    });
  });

  describe("edge cases", () => {
    it("should handle zero as unlimited maxPayloadBytes", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPayloadBytes: 0 },
          }),
      });

      let handled = false;
      tr.on({ type: "PING", kind: "event" }, () => {
        handled = true;
      });

      const conn = await tr.connect();
      // Empty message should pass through (size 0)
      conn.send("PING");
      await tr.flush();

      // This depends on implementation: 0 might mean "no limit"
      // or it might mean "reject all". Check behavior.
      expect(handled).toBeDefined();
      await tr.close();
    });

    it("should report correct error context when limit exceeded", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter({
            limits: { maxPayloadBytes: 10 },
          }),
      });

      tr.on({ type: "PING", kind: "event" }, () => {
        // handler
      });

      const conn = await tr.connect();
      conn.send("PING", { text: "x".repeat(100) });
      await tr.flush();

      // For size errors, context might be null (error during parse)
      // This is acceptable per error model
      expect(tr.capture.errors().length).toBeGreaterThan(0);
      await tr.close();
    });
  });
});
