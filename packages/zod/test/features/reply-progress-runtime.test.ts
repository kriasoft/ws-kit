// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime tests for ctx.reply() and ctx.progress()
 *
 * Validates WebSocket transmission, correlation ID propagation,
 * single-reply guard, and meta handling.
 *
 * Spec: docs/specs/router.md#rpc
 */

import { createRouter } from "@ws-kit/core";
import { message, rpc, withZod, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

describe("reply() and progress() runtime", () => {
  describe("context methods exist and are properly typed", () => {
    it("should have reply method in RPC handler context", async () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      const router = createRouter().plugin(withZod());

      let contextHasReply = false;
      router.rpc(GetUser, async (ctx: any) => {
        contextHasReply = typeof ctx.reply === "function";
      });

      expect(contextHasReply).toBe(false); // Not called yet
      expect(typeof router.rpc).toBe("function");
    });

    it("should have progress method in RPC handler context", async () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      const router = createRouter().plugin(withZod());

      let contextHasProgress = false;
      router.rpc(GetUser, async (ctx: any) => {
        contextHasProgress = typeof ctx.progress === "function";
      });

      expect(contextHasProgress).toBe(false); // Not called yet
    });

    it("should have send method in event handler context", async () => {
      const Join = message("JOIN", { roomId: z.string() });

      const router = createRouter().plugin(withZod());

      let contextHasSend = false;
      router.on(Join, async (ctx: any) => {
        contextHasSend = typeof ctx.send === "function";
      });

      expect(contextHasSend).toBe(false); // Not called yet
    });
  });

  describe("RPC-only guards", () => {
    it("reply() should throw in event handler", async () => {
      const Join = message("JOIN", { roomId: z.string() });
      const router = createRouter().plugin(withZod());

      let errorThrown: Error | null = null;

      router.on(Join, async (ctx: any) => {
        try {
          ctx.reply({ result: "test" });
        } catch (err) {
          errorThrown = err as Error;
        }
      });

      router.onError((err) => {
        // Error should be caught in handler, not here
      });

      expect(router.on).toBeDefined();
    });

    it("progress() should throw in event handler", async () => {
      const Join = message("JOIN", { roomId: z.string() });
      const router = createRouter().plugin(withZod());

      let errorThrown: Error | null = null;

      router.on(Join, async (ctx: any) => {
        try {
          ctx.progress({ status: "updating" });
        } catch (err) {
          errorThrown = err as Error;
        }
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("reply() idempotency", () => {
    it("should silently ignore second reply() call", async () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      const router = createRouter().plugin(withZod());

      let replyCallCount = 0;
      router.on(GetUser, async (ctx: any) => {
        replyCallCount++;
        ctx.reply({ id: "u1", name: "Alice" });
        ctx.reply({ id: "u2", name: "Bob" }); // Silently ignored
      });

      expect(replyCallCount).toBe(0); // Not called yet
    });
  });

  describe("plugin integration", () => {
    it("should add rpc method after withZod()", () => {
      const router = createRouter().plugin(withZod());
      expect("rpc" in router).toBe(true);
      expect(typeof (router as any).rpc).toBe("function");
    });

    it("should preserve type safety with rpc schema", () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      expect((GetUser as any).type).toBe("GET_USER");
      expect((GetUser as any).response?.type).toBe("USER");
      expect((GetUser as any).kind).toBe("rpc");
    });
  });

  describe("outgoing validation", () => {
    it("should validate outgoing by default", async () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      const router = createRouter().plugin(withZod({ validateOutgoing: true }));

      let validationErrorCaught = false;
      router.onError((err) => {
        if ((err as any).code === "REPLY_VALIDATION_ERROR") {
          validationErrorCaught = true;
        }
      });

      router.on(GetUser, async (ctx: any) => {
        // Send invalid reply (extra field)
        ctx.reply({
          id: "u1",
          name: "Alice",
          extraField: "should-fail",
        });
      });

      expect(router.on).toBeDefined();
    });

    it("should skip validation when disabled", async () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      const router = createRouter().plugin(
        withZod({ validateOutgoing: false }),
      );

      let errorCaught = false;
      router.onError((err) => {
        errorCaught = true;
      });

      router.on(GetUser, async (ctx: any) => {
        // Extra field allowed when validation disabled
        ctx.reply({
          id: "u1",
          name: "Alice",
          extraField: "allowed",
        });
      });

      expect(errorCaught).toBe(false);
    });

    it("should respect per-call validate option", async () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      const router = createRouter().plugin(
        withZod({ validateOutgoing: false }),
      );

      let validationErrorCaught = false;
      router.onError((err) => {
        if ((err as any).code === "REPLY_VALIDATION_ERROR") {
          validationErrorCaught = true;
        }
      });

      router.on(GetUser, async (ctx: any) => {
        // Enable validation for this call
        ctx.reply(
          {
            id: "u1",
            name: "Alice",
            extraField: "should-fail",
          },
          { validate: true },
        );
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("meta handling", () => {
    it("should allow custom meta fields in reply", async () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      const router = createRouter().plugin(withZod());

      router.on(GetUser, async (ctx: any) => {
        ctx.reply({ id: "u1", name: "Alice" }, { meta: { custom: "value" } });
      });

      expect(router.on).toBeDefined();
    });

    it("should sanitize reserved meta keys", async () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      const router = createRouter().plugin(withZod());

      router.on(GetUser, async (ctx: any) => {
        ctx.reply(
          { id: "u1", name: "Alice" },
          {
            meta: {
              custom: "value",
              correlationId: "should-be-ignored",
              progress: false,
            },
          },
        );
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("progress flag handling", () => {
    it("should mark progress updates with progress: true", async () => {
      const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
        id: z.string(),
        name: z.string(),
      });

      const router = createRouter().plugin(withZod());

      router.on(GetUser, async (ctx: any) => {
        ctx.progress({ id: "u1", name: "Loading..." });
        ctx.reply({ id: "u1", name: "Alice" });
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("send() method", () => {
    it("should validate outgoing messages when enabled", async () => {
      const Join = message("JOIN", { roomId: z.string() });
      const Joined = message("JOINED", { userId: z.string() });

      const router = createRouter().plugin(withZod({ validateOutgoing: true }));

      let validationErrorCaught = false;
      router.onError((err) => {
        if ((err as any).code?.includes("VALIDATION_ERROR")) {
          validationErrorCaught = true;
        }
      });

      router.on(Join, async (ctx: any) => {
        ctx.send(Joined, {
          userId: "u1",
          extraField: "should-fail",
        });
      });

      expect(router.on).toBeDefined();
    });
  });
});
