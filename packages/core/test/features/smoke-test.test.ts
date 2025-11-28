// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Smoke Test - Validates the quick-start example works end-to-end.
 *
 * This test verifies that the fundamental WS-Kit setup from the README works:
 * - Create router with plugins
 * - Register message handlers
 * - Send and receive messages
 * - Middleware execution
 * - Error handling
 */

import { createRouter } from "@ws-kit/core";
import { createDescriptor, test } from "@ws-kit/core/testing";
import { memoryPubSub } from "@ws-kit/memory";
import { withPubSub } from "@ws-kit/pubsub";
import { withZod } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

const Message1 = createDescriptor("MSG1", "event");
const Message2 = createDescriptor("MSG2", "event");
const BasicMessage = createDescriptor("MSG", "event");

describe("smoke test - quick-start example with plugins", () => {
  it("should create and configure router with Zod and PubSub plugins", () => {
    // Verify router can be created with recommended plugins
    const router = createRouter()
      .plugin(withZod())
      .plugin(withPubSub({ adapter: memoryPubSub() }));

    expect(router).toBeDefined();
  });

  it("should handle multiple message handlers with plugins", async () => {
    const calls: string[] = [];

    const tr = test.createTestRouter({
      create: () =>
        createRouter()
          .plugin(withZod())
          .plugin(withPubSub({ adapter: memoryPubSub() }))
          .on(Message1, () => {
            calls.push("msg1");
          })
          .on(Message2, () => {
            calls.push("msg2");
          }),
    });

    const conn = await tr.connect();
    conn.send("MSG1", { data: "test" });
    conn.send("MSG2", { data: "test" });
    await tr.flush();

    expect(calls).toEqual(["msg1", "msg2"]);
    await tr.close();
  });

  it("should support middleware chains with plugins", async () => {
    const calls: string[] = [];

    const tr = test.createTestRouter({
      create: () =>
        createRouter()
          .plugin(withZod())
          .plugin(withPubSub({ adapter: memoryPubSub() }))
          .use((ctx, next) => {
            calls.push("middleware");
            return next();
          })
          .on(BasicMessage, (ctx) => {
            calls.push("handler");
          }),
    });

    const conn = await tr.connect();
    conn.send("MSG", { text: "test" });
    await tr.flush();

    expect(calls).toEqual(["middleware", "handler"]);
    await tr.close();
  });

  it("should capture handler errors with plugins", async () => {
    const tr = test.createTestRouter({
      create: () =>
        createRouter()
          .plugin(withZod())
          .plugin(withPubSub({ adapter: memoryPubSub() }))
          .on(BasicMessage, () => {
            throw new Error("Test error");
          }),
    });

    const conn = await tr.connect();
    conn.send("MSG", { text: "test" });
    await tr.flush();

    const errors = tr.capture.errors();
    expect(errors.length).toBeGreaterThan(0);
    expect((errors[0] as Error).message).toBe("Test error");
    await tr.close();
  });
});
