// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Integration tests for withMessaging() + withRpc() plugins
 *
 * Validates that core plugins compose cleanly without validator involvement.
 * Tests only fire-and-forget messaging patterns here; RPC functionality
 * (reply/progress) requires validator plugins and is tested there.
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
const PONG = createDescriptor("PONG", "event");
const GET_USER = createRpcDescriptor("GET_USER", "USER");
const TEST = createDescriptor("TEST", "event");
const RESPONSE = createDescriptor("RESPONSE", "event");

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

    it("progress() throws without validator plugin (guard)", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      tr.on(MESSAGE, (ctx: any) => {
        ctx.progress({ status: "in progress" });
      });

      const conn = await tr.connect();
      conn.send("MESSAGE");
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      expect(String(errors[0])).toContain("only in RPC handlers");
      await tr.close();
    });

    it("extensions available for wrapping by other plugins", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      let messagingExtDefined = false;
      let sendIsFn = false;
      tr.on(MESSAGE, (ctx: any) => {
        const messagingExt = ctx.extensions?.get?.("messaging");
        messagingExtDefined = messagingExt !== undefined;
        sendIsFn = typeof messagingExt?.send === "function";
      });

      const conn = await tr.connect();
      conn.send("MESSAGE");
      await tr.flush();

      expect(messagingExtDefined).toBe(true);
      expect(sendIsFn).toBe(true);
      await tr.close();
    });
  });

  describe("plugin order independence", () => {
    it("works with withRpc before withMessaging", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withRpc()).plugin(withMessaging()),
      });

      let sendAvailable = false;
      let replyAvailable = false;

      tr.on(MESSAGE, (ctx: any) => {
        sendAvailable = typeof ctx.send === "function";
        replyAvailable = typeof ctx.reply === "function";
      });

      const conn = await tr.connect();
      conn.send("MESSAGE");
      await tr.flush();

      expect(sendAvailable).toBe(true);
      expect(replyAvailable).toBe(true);
      await tr.close();
    });

    it("works with withMessaging before withRpc", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      let sendAvailable = false;
      let replyAvailable = false;

      tr.on(MESSAGE, (ctx: any) => {
        sendAvailable = typeof ctx.send === "function";
        replyAvailable = typeof ctx.reply === "function";
      });

      const conn = await tr.connect();
      conn.send("MESSAGE");
      await tr.flush();

      expect(sendAvailable).toBe(true);
      expect(replyAvailable).toBe(true);
      await tr.close();
    });
  });

  describe("fire-and-forget messaging", () => {
    it("handlers can send() multiple messages", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      let sendCount = 0;
      tr.on(MESSAGE, (ctx: any) => {
        ctx.send(RESPONSE, { status: "first" });
        sendCount++;
        ctx.send(RESPONSE, { status: "second" });
        sendCount++;
        ctx.send(RESPONSE, { status: "third" });
        sendCount++;
      });

      const conn = await tr.connect();
      conn.send("MESSAGE");
      await tr.flush();

      expect(sendCount).toBe(3);
      await tr.close();
    });

    it("simple ping-pong pattern works", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

      let handlerCalled = false;
      let sendCalled = false;
      tr.on(PING, (ctx: any) => {
        handlerCalled = true;
        ctx.send(PONG, { text: "pong" });
        sendCalled = true;
      });

      const conn = await tr.connect();
      conn.send("PING");
      await tr.flush();

      expect(handlerCalled).toBe(true);
      expect(sendCalled).toBe(true);
      await tr.close();
    });

    it("send() returns void (fire-and-forget)", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter().plugin(withMessaging()).plugin(withRpc()),
      });

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
  });
});
