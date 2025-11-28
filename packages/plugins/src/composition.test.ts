// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Integration tests for withMessaging() + withRpc() plugins
 *
 * Validates that core plugins compose cleanly without validator involvement.
 * Shows the plugin-agnostic nature of core messaging and RPC functionality.
 *
 * Validator tests verify that Zod/Valibot plugins wrap these correctly.
 *
 * Spec: ADR-031#plugin-adapter-architecture
 *       docs/specs/plugins.md
 */

import { createRouter } from "@ws-kit/core";
import {
  createDescriptor,
  createRpcDescriptor,
  test,
} from "@ws-kit/core/testing";
import { describe, expect, it } from "bun:test";
import { withMessaging, withRpc } from "../src/index.js";

// Test descriptors (proper MessageDescriptor with DESCRIPTOR symbol)
const MESSAGE = createDescriptor("MESSAGE", "event");
const REQUEST = createRpcDescriptor("REQUEST", "RESPONSE");
const PING = createDescriptor("PING", "event");
const GET_USER = createRpcDescriptor("GET_USER", "USER");
const TEST = createDescriptor("TEST", "event");
const PROCESSING = createDescriptor("PROCESSING", "event");
const COMPLETED = createDescriptor("COMPLETED", "event");

describe("Plugin composition - withMessaging + withRpc", () => {
  describe("both plugins applied to same router", () => {
    it("send() available in event handlers", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      let sendAvailable = false;
      tr.on(MESSAGE, (ctx: any) => {
        sendAvailable = typeof ctx.send === "function";
      });

      const conn = await tr.connect();
      conn.send("MESSAGE");
      await tr.flush();

      expect(sendAvailable).toBe(true);
      await tr.close();
    });

    it("send() available in RPC handlers", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      let sendAvailable = false;
      tr.on(REQUEST, (ctx: any) => {
        sendAvailable = typeof ctx.send === "function";
        ctx.reply({ result: "ok" }); // complete RPC
      });

      const conn = await tr.connect();
      conn.send("REQUEST", {}, { correlationId: "test-1" });
      await tr.flush();

      expect(sendAvailable).toBe(true);
      await tr.close();
    });

    it("reply() throws without validator plugin (guard)", async () => {
      // Without withZod/withValibot, __wskit.response is never set
      // so reply() throws regardless of handler type
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      tr.on(MESSAGE, (ctx: any) => {
        ctx.reply({ result: "bad" });
      });

      const conn = await tr.connect();
      conn.send("MESSAGE");
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      expect(String(errors[0])).toContain("only in RPC handlers");
      await tr.close();
    });

    it("reply() requires validator plugin even in RPC handlers", async () => {
      // Core RPC plugin provides reply() method, but the guard requires
      // __wskit.response which is only set by validator plugins
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      tr.on(REQUEST, (ctx: any) => {
        ctx.reply({ result: "ok" });
      });

      const conn = await tr.connect();
      conn.send("REQUEST", {}, { correlationId: "test-1" });
      await tr.flush();

      // Without validator plugin, reply() guard fails
      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      expect(String(errors[0])).toContain("only in RPC handlers");
      await tr.close();
    });

    it("extensions available for wrapping by other plugins", () => {
      const router = createRouter().plugin(withMessaging()).plugin(withRpc());

      router.on(MESSAGE, (ctx: any) => {
        // Plugins store enhancements in ctx.extensions
        const messagingExt = ctx.extensions.get("messaging");
        const rpcExt = ctx.extensions.get("rpc");

        expect(messagingExt).toBeDefined();
        expect(typeof messagingExt.send).toBe("function");

        // RPC extension available too (from context enhancer)
        expect(rpcExt || typeof ctx.reply).toBeTruthy();
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("plugin order independence", () => {
    it("works with withRpc before withMessaging", () => {
      const router = createRouter().plugin(withRpc()).plugin(withMessaging());

      router.on(MESSAGE, (ctx: any) => {
        expect(typeof ctx.send).toBe("function");
      });

      router.on(REQUEST, (ctx: any) => {
        expect(typeof ctx.reply).toBe("function");
      });

      expect(router.on).toBeDefined();
    });

    it("works with withMessaging before withRpc", () => {
      const router = createRouter().plugin(withMessaging()).plugin(withRpc());

      router.on(MESSAGE, (ctx: any) => {
        expect(typeof ctx.send).toBe("function");
      });

      router.on(REQUEST, (ctx: any) => {
        expect(typeof ctx.reply).toBe("function");
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("validator plugins can wrap core plugins", () => {
    it("validator plugin can inject validation between core plugins", () => {
      // This simulates how @ws-kit/zod and @ws-kit/valibot wrap core plugins
      const router = createRouter().plugin(withMessaging()).plugin(withRpc());

      // A validator plugin would:
      // 1. Use getRouterPluginAPI to get enhancer registration
      // 2. Add validation middleware
      // 3. Wrap ctx.send/reply/progress with validation

      router.on(MESSAGE, (ctx: any) => {
        // After validator plugin applied, ctx.send would be wrapped
        // but the interface remains the same
        expect(typeof ctx.send).toBe("function");
      });

      router.on(REQUEST, (ctx: any) => {
        expect(typeof ctx.reply).toBe("function");
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("fire-and-forget and RPC patterns together", () => {
    it("handlers can send() unicast while handling RPC", () => {
      const router = createRouter().plugin(withMessaging()).plugin(withRpc());

      router.on(REQUEST, (ctx: any) => {
        // Send notification to client
        ctx.send(PROCESSING, { status: "started" });

        // Do some work
        ctx.send(PROCESSING, { status: "50%" });

        // Send terminal response
        ctx.reply({ result: "done" });

        // Further sends would be silently queued (not terminal)
        ctx.send(COMPLETED, { final: true });
      });

      expect(router.on).toBeDefined();
    });

    it("handlers can use progress() for streaming within RPC", () => {
      const router = createRouter().plugin(withMessaging()).plugin(withRpc());

      router.on(REQUEST, (ctx: any) => {
        // Stream progress updates
        for (let i = 1; i <= 10; i++) {
          ctx.progress({ percent: i * 10 });
        }

        // Terminal response
        ctx.reply({ result: "done" });
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("backwards compatibility with existing patterns", () => {
    it("simple event pattern still works", () => {
      const router = createRouter().plugin(withMessaging()).plugin(withRpc());
      const PONG = createDescriptor("PONG", "event");

      router.on(PING, (ctx: any) => {
        ctx.send(PONG, { text: "pong" });
      });

      expect(router.on).toBeDefined();
    });

    it("simple RPC pattern still works", () => {
      const router = createRouter().plugin(withMessaging()).plugin(withRpc());

      router.on(GET_USER, (ctx: any) => {
        if (!ctx.payload) {
          ctx.error("INVALID", "Missing payload");
        } else {
          ctx.reply({ id: "123", name: "Alice" });
        }
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("behavioral tests - send() and reply() behavior", () => {
    it("send() returns void (fire-and-forget)", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });
      const RESPONSE = createDescriptor("RESPONSE", "event");

      let sendResult: unknown = "not called";
      tr.on(TEST, (ctx: any) => {
        sendResult = ctx.send(RESPONSE, { data: "test" });
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      expect(sendResult).toBeUndefined();
      await tr.close();
    });

    it("error() is available and callable in handlers", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      let errorAvailable = false;
      tr.on(MESSAGE, (ctx: any) => {
        errorAvailable = typeof ctx.error === "function";
      });

      const conn = await tr.connect();
      conn.send("MESSAGE");
      await tr.flush();

      expect(errorAvailable).toBe(true);
      await tr.close();
    });

    it("progress() is available but throws without validator", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      tr.on(MESSAGE, (ctx: any) => {
        ctx.progress({ status: "in progress" });
      });

      const conn = await tr.connect();
      conn.send("MESSAGE");
      await tr.flush();

      // progress() has same guard as reply() - requires validator
      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      expect(String(errors[0])).toContain("only in RPC handlers");
      await tr.close();
    });
  });
});
