// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Integration tests for ctx.send() - actually triggers handlers and verifies message sending.
 *
 * Validates fire-and-forget paths:
 * - send() sends message to WebSocket
 * - send() with {meta} merges metadata
 * - send() with {preserveCorrelation} copies correlationId
 * - send() with {signal} cancels gracefully
 * - send() with {waitFor} returns Promise
 *
 * These tests exercise the actual code paths by dispatching messages through the router.
 *
 * Spec: docs/specs/context-methods.md#ctx-send
 */

import { createRouter } from "@ws-kit/core";
import { createDescriptor, test } from "@ws-kit/core/testing";
import { describe, expect, it } from "bun:test";
import { withMessaging } from "../index.js";

const PING = createDescriptor("PING", "event");
const PONG = createDescriptor("PONG", "event");

// Helper to wait for setImmediate to execute (fire-and-forget uses setImmediate)
const waitForImmediate = () => new Promise((r) => setImmediate(r));

describe("withMessaging() - ctx.send() integration", () => {
  describe("fire-and-forget messaging", () => {
    it("sends message to WebSocket", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      tr.on(PING, (ctx: any) => {
        ctx.send(PONG, { reply: "pong" });
      });

      const conn = await tr.connect();
      conn.send("PING", { text: "hello" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      expect(messages.length).toBeGreaterThanOrEqual(1);
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeDefined();
      expect(pong!.payload).toEqual({ reply: "pong" });
    });

    it("omits payload field when payload is undefined", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      tr.on(PING, (ctx: any) => {
        ctx.send(PONG, undefined);
      });

      const conn = await tr.connect();
      conn.send("PING");
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeDefined();
      expect("payload" in pong!).toBe(false);
    });

    it("returns void by default (fire-and-forget)", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      let returnValue: any;
      tr.on(PING, (ctx: any) => {
        returnValue = ctx.send(PONG, { data: "test" });
      });

      const conn = await tr.connect();
      conn.send("PING");
      await tr.flush();

      expect(returnValue).toBeUndefined();
    });
  });

  describe("{meta} option - custom metadata", () => {
    it("merges custom metadata into outgoing message", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      tr.on(PING, (ctx: any) => {
        ctx.send(PONG, { reply: "ok" }, { meta: { traceId: "abc123" } });
      });

      const conn = await tr.connect();
      conn.send("PING");
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeDefined();
      expect(pong!.meta?.traceId).toBe("abc123");
    });

    it("sanitizes metadata - strips reserved keys", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      tr.on(PING, (ctx: any) => {
        ctx.send(
          PONG,
          { reply: "ok" },
          {
            meta: {
              type: "HACKED", // Reserved: should be stripped
              correlationId: "fake", // Reserved: should be stripped
              customField: "preserved", // Non-reserved: should be preserved
            },
          },
        );
      });

      const conn = await tr.connect();
      conn.send("PING");
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeDefined();
      expect(pong!.type).toBe("PONG"); // Not overridden
      expect(pong!.meta?.correlationId).toBeUndefined(); // Not overridden
      expect(pong!.meta?.customField).toBe("preserved");
    });
  });

  describe("{preserveCorrelation} option", () => {
    it("copies correlationId from inbound meta", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      tr.on(PING, (ctx: any) => {
        ctx.send(PONG, { reply: "ok" }, { preserveCorrelation: true });
      });

      const conn = await tr.connect();
      conn.send("PING", { text: "hello" }, { correlationId: "req-123" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeDefined();
      expect(pong!.meta?.correlationId).toBe("req-123");
    });

    it("gracefully skips if no correlationId in inbound meta", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      tr.on(PING, (ctx: any) => {
        ctx.send(PONG, { reply: "ok" }, { preserveCorrelation: true });
      });

      const conn = await tr.connect();
      conn.send("PING", { text: "hello" }); // No correlationId
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeDefined();
      // Should not have correlationId
      expect(pong!.meta?.correlationId).toBeUndefined();
    });

    it("works together with custom {meta}", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      tr.on(PING, (ctx: any) => {
        ctx.send(
          PONG,
          { reply: "ok" },
          {
            preserveCorrelation: true,
            meta: { customField: "value" },
          },
        );
      });

      const conn = await tr.connect();
      conn.send("PING", { text: "hello" }, { correlationId: "req-456" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeDefined();
      expect(pong!.meta?.correlationId).toBe("req-456");
      expect(pong!.meta?.customField).toBe("value");
    });
  });

  describe("{signal} option - cancellation", () => {
    it("gracefully skips send if signal is aborted before enqueue", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      let returnValue: any;
      tr.on(PING, (ctx: any) => {
        const controller = new AbortController();
        controller.abort();
        returnValue = ctx.send(
          PONG,
          { reply: "ok" },
          { signal: controller.signal },
        );
      });

      const conn = await tr.connect();
      conn.send("PING");
      await tr.flush();
      await waitForImmediate();

      expect(returnValue).toBeUndefined();
      // Message should not be sent
      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeUndefined();
    });

    it("returns false with {waitFor} if signal is aborted", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      let returnValue: any;
      tr.on(PING, async (ctx: any) => {
        const controller = new AbortController();
        controller.abort();
        returnValue = await ctx.send(
          PONG,
          { reply: "ok" },
          { waitFor: "drain", signal: controller.signal },
        );
      });

      const conn = await tr.connect();
      conn.send("PING");
      await tr.flush();
      await waitForImmediate();

      expect(returnValue).toBe(false);
      // Message should not be sent
      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeUndefined();
    });
  });

  // NOTE: {waitFor} is currently stubbed to resolve immediately (true).
  // When real drain/ack tracking is implemented, these tests should be updated to:
  // 1. Verify actual buffer drain behavior
  // 2. Test signal abort after enqueue (not just before)
  // 3. Test backpressure scenarios
  describe("{waitFor} option - async confirmation", () => {
    it("returns Promise<boolean> with waitFor", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      let returnValue: any;
      tr.on(PING, async (ctx: any) => {
        returnValue = ctx.send(PONG, { reply: "ok" }, { waitFor: "drain" });
        expect(returnValue).toBeInstanceOf(Promise);
        await returnValue;
      });

      const conn = await tr.connect();
      conn.send("PING");
      await tr.flush();
      await waitForImmediate();

      expect(returnValue).toBeInstanceOf(Promise);
    });

    it("resolves to true after send", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      let result: any;
      tr.on(PING, async (ctx: any) => {
        result = await ctx.send(PONG, { reply: "ok" }, { waitFor: "drain" });
      });

      const conn = await tr.connect();
      conn.send("PING");
      await tr.flush();
      await waitForImmediate();

      expect(result).toBe(true);
      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeDefined();
    });

    it("with {waitFor} + {preserveCorrelation} preserves correlationId", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()),
      });

      tr.on(PING, async (ctx: any) => {
        await ctx.send(
          PONG,
          { reply: "ok" },
          { waitFor: "drain", preserveCorrelation: true },
        );
      });

      const conn = await tr.connect();
      conn.send("PING", { text: "hello" }, { correlationId: "req-789" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const pong = messages.find((m) => m.type === "PONG");
      expect(pong).toBeDefined();
      expect(pong!.meta?.correlationId).toBe("req-789");
    });
  });
});
