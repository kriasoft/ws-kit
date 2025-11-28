// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Basic functionality tests for messaging patterns.
 *
 * Tests fire-and-forget messaging and handler registration using TestRouter
 * (deterministic, no mocks, no external dependencies).
 */

import type { MessageDescriptor } from "@ws-kit/core";
import { createRouter } from "@ws-kit/core";
import { createDescriptor, test } from "@ws-kit/core/testing";
import { describe, expect, it } from "bun:test";

describe("messaging patterns integration", () => {
  describe("fire-and-forget messaging", () => {
    it("should execute handler for sent message", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Message: MessageDescriptor = createDescriptor("MSG", "event");

      let handlerExecuted = false;

      tr.on(Message, (ctx: any) => {
        handlerExecuted = true;
      });

      const conn = await tr.connect();
      conn.send("MSG", { text: "Hello" });
      await tr.flush();

      expect(handlerExecuted).toBe(true);
    });

    it("should handle multiple fire-and-forget messages", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Message: MessageDescriptor = createDescriptor("MSG", "event");

      const executedMessages: unknown[] = [];

      tr.on(Message, (ctx: any) => {
        executedMessages.push(ctx.payload);
      });

      const conn = await tr.connect();

      // Send multiple messages
      for (let i = 0; i < 5; i++) {
        conn.send("MSG", { id: i });
      }
      await tr.flush();

      expect(executedMessages.length).toBe(5);
    });

    it("should execute handlers for different message types", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Msg1: MessageDescriptor = createDescriptor("CHAT", "event");
      const Msg2: MessageDescriptor = createDescriptor("NOTIFY", "event");

      let chatCount = 0;
      let notifyCount = 0;

      tr.on(Msg1, () => {
        chatCount++;
      });

      tr.on(Msg2, () => {
        notifyCount++;
      });

      const conn = await tr.connect();

      conn.send("CHAT", { text: "Hello" });
      conn.send("NOTIFY", { msg: "Alert" });
      conn.send("CHAT", { text: "Hi" });
      await tr.flush();

      expect(chatCount).toBe(2);
      expect(notifyCount).toBe(1);
    });
  });

  describe("multiple connections", () => {
    it("should handle messages from multiple connections", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Message: MessageDescriptor = createDescriptor("MSG", "event");

      let messageCount = 0;

      tr.on(Message, () => {
        messageCount++;
      });

      const conn1 = await tr.connect();
      const conn2 = await tr.connect();

      conn1.send("MSG");
      conn2.send("MSG");
      conn1.send("MSG");
      await tr.flush();

      expect(messageCount).toBe(3);
    });
  });

  describe("error capture", () => {
    it("should capture handler errors", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Message: MessageDescriptor = createDescriptor("MSG", "event");

      tr.on(Message, () => {
        throw new Error("Test error");
      });

      const conn = await tr.connect();
      conn.send("MSG");
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      expect((errors[0] as Error).message).toBe("Test error");
    });
  });
});
