// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Basic functionality tests for handler routing.
 *
 * Tests handler registration and routing using TestRouter
 * (deterministic, no mocks, no external dependencies).
 */

import type { MessageDescriptor } from "@ws-kit/core";
import { createRouter } from "@ws-kit/core";
import { createDescriptor, test } from "@ws-kit/core/testing";
import { describe, expect, it } from "bun:test";

describe("Handler routing integration", () => {
  describe("Handler registration and execution", () => {
    it("should execute handler when message is sent", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Message: MessageDescriptor = createDescriptor("TEST", "event");

      let handlerExecuted = false;

      tr.on(Message, () => {
        handlerExecuted = true;
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      expect(handlerExecuted).toBe(true);
    });

    it("should route different message types to correct handlers", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Msg1: MessageDescriptor = createDescriptor("MSG1", "event");
      const Msg2: MessageDescriptor = createDescriptor("MSG2", "event");

      let msg1Count = 0;
      let msg2Count = 0;

      tr.on(Msg1, () => {
        msg1Count++;
      });

      tr.on(Msg2, () => {
        msg2Count++;
      });

      const conn = await tr.connect();

      conn.send("MSG1");
      conn.send("MSG2");
      conn.send("MSG1");
      await tr.flush();

      expect(msg1Count).toBe(2);
      expect(msg2Count).toBe(1);
    });

    it("should handle multiple concurrent message handlers", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Request: MessageDescriptor = createDescriptor("REQ", "event");

      let callCount = 0;

      tr.on(Request, () => {
        callCount++;
      });

      const conn = await tr.connect();

      // Send multiple requests
      for (let i = 0; i < 5; i++) {
        conn.send("REQ");
      }
      await tr.flush();

      expect(callCount).toBe(5);
    });
  });

  describe("error handling", () => {
    it("should capture errors in handlers", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Message: MessageDescriptor = createDescriptor("TEST", "event");

      tr.on(Message, () => {
        throw new Error("Handler failed");
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      expect((errors[0] as Error).message).toBe("Handler failed");
    });

    it("should handle unregistered message types", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const conn = await tr.connect();
      conn.send("UNKNOWN");
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("handler context", () => {
    it("should provide message type in handler context", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const Message: MessageDescriptor = createDescriptor("MY_MSG", "event");

      let capturedType: string | undefined;

      tr.on(Message, (ctx: any) => {
        capturedType = ctx.type;
      });

      const conn = await tr.connect();
      conn.send("MY_MSG");
      await tr.flush();

      expect(capturedType).toBe("MY_MSG");
    });
  });
});
